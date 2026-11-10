package load

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type pipeListener struct {
	conns  chan net.Conn
	closed chan struct{}
	once   sync.Once
}

func newPipeListener() *pipeListener {
	return &pipeListener{conns: make(chan net.Conn), closed: make(chan struct{})}
}

func (l *pipeListener) Accept() (net.Conn, error) {
	select {
	case conn := <-l.conns:
		return conn, nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}

func (l *pipeListener) Close() error {
	l.once.Do(func() { close(l.closed) })
	return nil
}

func (*pipeListener) Addr() net.Addr {
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 80}
}

func (l *pipeListener) dial(ctx context.Context, _, _ string) (net.Conn, error) {
	server, client := net.Pipe()
	select {
	case l.conns <- server:
		return client, nil
	case <-l.closed:
		return nil, net.ErrClosed
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

type fakeGateway struct {
	server    *httptest.Server
	transport *http.Transport
	chat      http.HandlerFunc
	mu        sync.Mutex
	issued    int
	uses      map[string][]time.Time
	busiest   int
	closeOnce sync.Once
}

func newFakeGateway(t *testing.T, chat http.HandlerFunc) *fakeGateway {
	t.Helper()
	listener := newPipeListener()
	gateway := &fakeGateway{
		chat:      chat,
		uses:      map[string][]time.Time{},
		transport: &http.Transport{DialContext: listener.dial},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/session", gateway.issue)
	mux.HandleFunc("POST /api/chat", gateway.admit)
	gateway.server = httptest.NewUnstartedServer(mux)
	gateway.server.Listener = listener
	gateway.server.Start()
	t.Cleanup(gateway.close)
	return gateway
}

func (g *fakeGateway) close() {
	g.closeOnce.Do(func() {
		g.transport.CloseIdleConnections()
		g.server.Close()
	})
}

func (g *fakeGateway) config(plan []Request) *Config {
	return &Config{
		BaseURL:       g.server.URL,
		Plan:          plan,
		Timeout:       30 * time.Second,
		Client:        &http.Client{Transport: g.transport},
		SessionBudget: 8,
		SessionWindow: time.Minute,
	}
}

func (g *fakeGateway) issue(w http.ResponseWriter, _ *http.Request) {
	g.mu.Lock()
	g.issued++
	token := fmt.Sprintf("token-%d", g.issued)
	g.mu.Unlock()
	writeJSON(w, issuedSession{Token: token, ExpiresAt: time.Now().Add(30 * time.Minute).UnixMilli()})
}

func (g *fakeGateway) admit(w http.ResponseWriter, r *http.Request) {
	_, _ = io.Copy(io.Discard, r.Body)
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !g.consume(token, time.Now()) {
		http.Error(w, "too many requests", http.StatusTooManyRequests)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	g.chat(w, r)
}

func (g *fakeGateway) consume(token string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	recent := []time.Time{now}
	for _, used := range g.uses[token] {
		if used.After(now.Add(-time.Minute)) {
			recent = append(recent, used)
		}
	}
	g.uses[token] = append(g.uses[token], now)
	g.busiest = max(g.busiest, len(recent))
	return len(recent) <= 8
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func writeEvent(w http.ResponseWriter, payload string) {
	_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
	_ = http.NewResponseController(w).Flush()
}

func answer(w http.ResponseWriter) {
	writeEvent(w, `{"_tag":"Citations","passages":[]}`)
	writeEvent(w, `{"_tag":"Delta","text":"Alexey Pajitnov"}`)
	writeEvent(w, `{"_tag":"Done","model":"mock"}`)
}

func everyInterval(count int, interval time.Duration) []Request {
	plan := make([]Request, count)
	for index := range plan {
		plan[index] = Request{At: time.Duration(index) * interval, Question: "Who created Tetris?"}
	}
	return plan
}
