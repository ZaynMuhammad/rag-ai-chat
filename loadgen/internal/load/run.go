package load

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Outcome int

const (
	OutcomeOK Outcome = iota
	OutcomeHTTPStatus
	OutcomeFailedEvent
	OutcomeTimeout
	OutcomeTransport
	OutcomeProtocol
	OutcomeSession
	OutcomeCancelled
)

type Config struct {
	BaseURL       string
	Plan          []Request
	Timeout       time.Duration
	MaxInFlight   int
	Client        *http.Client
	SessionBudget int
	SessionWindow time.Duration
}

type Sample struct {
	at         time.Duration
	sent       time.Duration
	firstDelta time.Duration
	done       time.Duration
	wasSent    bool
	hasDelta   bool
	status     int
	outcome    Outcome
	model      string
}

type Result struct {
	Planned  []Request
	Samples  []Sample
	Sessions int
}

type runner struct {
	Config
	start    time.Time
	sessions *sessionPool
	inFlight chan struct{}
}

var errSessionStatus = errors.New("session endpoint refused")

func Run(ctx context.Context, config *Config) (Result, error) {
	r := &runner{Config: *config}
	r.sessions = newSessionPool(r.mint, config.SessionBudget, config.SessionWindow)
	needed := sessionsNeeded(config.Plan, config.SessionBudget, config.SessionWindow)
	if err := r.sessions.prefill(ctx, needed); err != nil {
		return Result{}, fmt.Errorf("mint sessions: %w", err)
	}
	if config.MaxInFlight > 0 {
		r.inFlight = make(chan struct{}, config.MaxInFlight)
	}
	samples := make([]Sample, len(config.Plan))
	dispatched := 0
	var requests sync.WaitGroup
	r.start = time.Now()
	for index, request := range config.Plan {
		if !sleepUntil(ctx, r.start.Add(request.At)) {
			break
		}
		dispatched++
		requests.Go(func() {
			samples[index] = r.send(ctx, request)
		})
	}
	requests.Wait()
	return Result{Planned: config.Plan, Samples: samples[:dispatched], Sessions: r.sessions.mintedCount()}, nil
}

func sleepUntil(ctx context.Context, due time.Time) bool {
	timer := time.NewTimer(time.Until(due))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (r *runner) send(parent context.Context, request Request) Sample {
	sample := Sample{at: request.At}
	ctx, cancel := context.WithDeadline(parent, r.start.Add(request.At+r.Timeout))
	defer cancel()
	if r.inFlight != nil {
		select {
		case r.inFlight <- struct{}{}:
			defer func() { <-r.inFlight }()
		case <-ctx.Done():
			return r.finish(sample, contextOutcome(ctx, OutcomeTransport))
		}
	}
	token, err := r.sessions.acquire(ctx)
	if err != nil {
		return r.finish(sample, contextOutcome(ctx, OutcomeSession))
	}
	sample.sent, sample.wasSent = r.since(), true
	response, err := r.post(ctx, token, request.Question)
	if err != nil {
		return r.finish(sample, contextOutcome(ctx, OutcomeTransport))
	}
	defer func() { _ = response.Body.Close() }()
	sample.status = response.StatusCode
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, response.Body)
		return r.finish(sample, OutcomeHTTPStatus)
	}
	return r.finish(sample, r.readStream(ctx, response.Body, &sample))
}

type sseEvent struct {
	Tag   string  `json:"_tag"`
	Model *string `json:"model"`
}

func (r *runner) readStream(ctx context.Context, body io.Reader, sample *Sample) Outcome {
	events := newSSEReader(body)
	failed, done := false, false
	for {
		payload, err := events.next()
		if errors.Is(err, io.EOF) {
			return streamOutcome(failed, done)
		}
		if err != nil {
			return contextOutcome(ctx, OutcomeProtocol)
		}
		var event sseEvent
		if err := json.Unmarshal(payload, &event); err != nil {
			return OutcomeProtocol
		}
		failed = failed || event.Tag == "Failed"
		done = done || event.Tag == "Done"
		r.record(sample, &event)
	}
}

func (r *runner) record(sample *Sample, event *sseEvent) {
	switch event.Tag {
	case "Delta":
		if !sample.hasDelta {
			sample.firstDelta, sample.hasDelta = r.since(), true
		}
	case "Done":
		if event.Model != nil {
			sample.model = *event.Model
		}
	}
}

func streamOutcome(failed, done bool) Outcome {
	switch {
	case failed:
		return OutcomeFailedEvent
	case !done:
		return OutcomeProtocol
	default:
		return OutcomeOK
	}
}

func (r *runner) finish(sample Sample, outcome Outcome) Sample {
	sample.done = r.since()
	sample.outcome = outcome
	return sample
}

func (r *runner) since() time.Duration {
	return time.Since(r.start)
}

func contextOutcome(ctx context.Context, otherwise Outcome) Outcome {
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		return OutcomeTimeout
	case errors.Is(ctx.Err(), context.Canceled):
		return OutcomeCancelled
	default:
		return otherwise
	}
}

type issuedSession struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expiresAt"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatScope struct{}

type chatRequest struct {
	Messages []chatMessage `json:"messages"`
	Scope    chatScope     `json:"scope"`
}

func (r *runner) post(ctx context.Context, token, question string) (*http.Response, error) {
	body, err := json.Marshal(chatRequest{Messages: []chatMessage{{Role: "user", Content: question}}})
	if err != nil {
		return nil, fmt.Errorf("encode chat request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, r.BaseURL+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build chat request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := r.Client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("send chat request: %w", err)
	}
	return response, nil
}

func (r *runner) mint(ctx context.Context) (token string, expiresAt time.Time, err error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, r.BaseURL+"/api/session", strings.NewReader(""))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("build session request: %w", err)
	}
	response, err := r.Client.Do(request)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("request session: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return "", time.Time{}, fmt.Errorf("%w: status %d", errSessionStatus, response.StatusCode)
	}
	var issued issuedSession
	if err := json.NewDecoder(response.Body).Decode(&issued); err != nil {
		return "", time.Time{}, fmt.Errorf("decode session: %w", err)
	}
	return issued.Token, time.UnixMilli(issued.ExpiresAt), nil
}
