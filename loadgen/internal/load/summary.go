package load

import (
	"math"
	"slices"
	"time"
)

type Percentiles struct {
	Count int     `json:"count"`
	P50   float64 `json:"p50Ms"`
	P95   float64 `json:"p95Ms"`
	P99   float64 `json:"p99Ms"`
	Max   float64 `json:"maxMs"`
}

type Latency struct {
	Corrected Percentiles `json:"corrected"`
	Naive     Percentiles `json:"naive"`
}

type Errors struct {
	HTTP        map[int]int `json:"http"`
	FailedEvent int         `json:"failedEvent"`
	Timeout     int         `json:"timeout"`
	Transport   int         `json:"transport"`
	Protocol    int         `json:"protocol"`
	Session     int         `json:"session"`
	Cancelled   int         `json:"cancelled"`
}

type Rates struct {
	Scheduled float64 `json:"scheduledPerSecond"`
	Sent      float64 `json:"sentPerSecond"`
	Completed float64 `json:"completedPerSecond"`
}

type Bucket struct {
	StartSeconds float64     `json:"startSeconds"`
	Scheduled    int         `json:"scheduled"`
	OK           int         `json:"ok"`
	Errors       int         `json:"errors"`
	TTFT         Percentiles `json:"ttft"`
}

type Summary struct {
	Scenario  string         `json:"scenario"`
	Planned   int            `json:"planned"`
	Sent      int            `json:"sent"`
	OK        int            `json:"ok"`
	Errors    Errors         `json:"errors"`
	Rates     Rates          `json:"rates"`
	SendLag   Percentiles    `json:"sendLag"`
	TTFT      Latency        `json:"ttft"`
	Total     Latency        `json:"total"`
	Sessions  int            `json:"sessions"`
	Models    map[string]int `json:"models"`
	BucketSec float64        `json:"bucketSeconds"`
	Buckets   []Bucket       `json:"buckets"`
}

func Summarize(scenario string, result *Result, bucket time.Duration) *Summary {
	summary := &Summary{
		Scenario:  scenario,
		Planned:   len(result.Planned),
		Errors:    Errors{HTTP: map[int]int{}},
		Sessions:  result.Sessions,
		Models:    map[string]int{},
		BucketSec: bucket.Seconds(),
	}
	size := len(result.Samples)
	ttft, ttftNaive := make([]time.Duration, 0, size), make([]time.Duration, 0, size)
	total, totalNaive := make([]time.Duration, 0, size), make([]time.Duration, 0, size)
	lag, sent, done := make([]time.Duration, 0, size), make([]time.Duration, 0, size), make([]time.Duration, 0, size)
	for _, sample := range result.Samples {
		if sample.wasSent {
			summary.Sent++
			sent = append(sent, sample.sent)
			lag = append(lag, sample.sent-sample.at)
		}
		summary.Errors.count(sample)
		if sample.outcome != OutcomeOK {
			continue
		}
		summary.OK++
		summary.Models[modelName(sample.model)]++
		done = append(done, sample.done)
		total = append(total, sample.done-sample.at)
		totalNaive = append(totalNaive, sample.done-sample.sent)
		if sample.hasDelta {
			ttft = append(ttft, sample.firstDelta-sample.at)
			ttftNaive = append(ttftNaive, sample.firstDelta-sample.sent)
		}
	}
	scheduled := make([]time.Duration, len(result.Planned))
	for index, request := range result.Planned {
		scheduled[index] = request.At
	}
	summary.Rates = Rates{
		Scheduled: spanRate(scheduled),
		Sent:      spanRate(sent),
		Completed: completedRate(done),
	}
	summary.SendLag = percentiles(lag)
	summary.TTFT = Latency{Corrected: percentiles(ttft), Naive: percentiles(ttftNaive)}
	summary.Total = Latency{Corrected: percentiles(total), Naive: percentiles(totalNaive)}
	summary.Buckets = buckets(result, bucket)
	return summary
}

func (e *Errors) count(sample Sample) {
	switch sample.outcome {
	case OutcomeOK:
	case OutcomeHTTPStatus:
		e.HTTP[sample.status]++
	case OutcomeFailedEvent:
		e.FailedEvent++
	case OutcomeTimeout:
		e.Timeout++
	case OutcomeTransport:
		e.Transport++
	case OutcomeProtocol:
		e.Protocol++
	case OutcomeSession:
		e.Session++
	case OutcomeCancelled:
		e.Cancelled++
	}
}

func modelName(model string) string {
	if model == "" {
		return "none"
	}
	return model
}

func buckets(result *Result, width time.Duration) []Bucket {
	if len(result.Planned) == 0 || width <= 0 {
		return nil
	}
	count := int(result.Planned[len(result.Planned)-1].At/width) + 1
	all := make([]Bucket, count)
	ttfts := make([][]time.Duration, count)
	for index := range all {
		all[index].StartSeconds = (time.Duration(index) * width).Seconds()
	}
	for _, request := range result.Planned {
		all[request.At/width].Scheduled++
	}
	for _, sample := range result.Samples {
		index := sample.at / width
		if sample.outcome != OutcomeOK {
			all[index].Errors++
			continue
		}
		all[index].OK++
		if sample.hasDelta {
			ttfts[index] = append(ttfts[index], sample.firstDelta-sample.at)
		}
	}
	for index := range all {
		all[index].TTFT = percentiles(ttfts[index])
	}
	return all
}

func percentiles(values []time.Duration) Percentiles {
	if len(values) == 0 {
		return Percentiles{}
	}
	sorted := slices.Sorted(slices.Values(values))
	at := func(p float64) float64 {
		return milliseconds(sorted[min(len(sorted)-1, int(math.Floor(p*float64(len(sorted)))))])
	}
	return Percentiles{
		Count: len(sorted),
		P50:   at(0.50),
		P95:   at(0.95),
		P99:   at(0.99),
		Max:   milliseconds(sorted[len(sorted)-1]),
	}
}

func milliseconds(value time.Duration) float64 {
	return float64(value) / float64(time.Millisecond)
}

func spanRate(offsets []time.Duration) float64 {
	if len(offsets) < 2 {
		return 0
	}
	first, last := slices.Min(offsets), slices.Max(offsets)
	if last <= first {
		return 0
	}
	return float64(len(offsets)-1) / (last - first).Seconds()
}

func completedRate(done []time.Duration) float64 {
	if len(done) == 0 {
		return 0
	}
	last := slices.Max(done)
	if last <= 0 {
		return 0
	}
	return float64(len(done)) / last.Seconds()
}
