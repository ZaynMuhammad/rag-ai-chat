package load

import (
	"context"
	"net/http"
	"runtime"
	"slices"
	"strconv"
	"testing"
	"testing/synctest"
	"time"
)

func TestFirstTokenIsTheFirstDeltaNotTheCitations(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		gateway := newFakeGateway(t, func(w http.ResponseWriter, _ *http.Request) {
			writeEvent(w, `{"_tag":"Citations","passages":[{"text":"not a \"_tag\":\"Delta\" event"}]}`)
			time.Sleep(400 * time.Millisecond)
			writeEvent(w, `{"_tag":"Delta","text":"Alexey "}`)
			time.Sleep(100 * time.Millisecond)
			writeEvent(w, `{"_tag":"Delta","text":"Pajitnov"}`)
			writeEvent(w, `{"_tag":"Done","model":"mock"}`)
		})
		result, err := Run(t.Context(), gateway.config(everyInterval(1, time.Second)))
		if err != nil {
			t.Fatal(err)
		}
		sample := result.Samples[0]
		if sample.outcome != OutcomeOK || sample.firstDelta != 400*time.Millisecond ||
			sample.done != 500*time.Millisecond {
			t.Fatalf("got outcome %d, first delta %s, done %s", sample.outcome, sample.firstDelta, sample.done)
		}
		if models := Summarize("", &result, time.Second).Models; models["mock"] != 1 {
			t.Fatalf("got models %v", models)
		}
	})
}

func TestCoordinatedOmission(t *testing.T) {
	t.Run("an open model keeps its schedule, so both timings agree", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			checkStalledServer(t, 0, durations(1000, 1000, 1000, 1000, 1000))
		})
	})
	t.Run("a one-slot pool queues behind the stall, which only corrected timing sees", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			checkStalledServer(t, 1, durations(1000, 1900, 2800, 3700, 4600))
		})
	})
}

func checkStalledServer(t *testing.T, maxInFlight int, corrected []time.Duration) {
	t.Helper()
	config := newFakeGateway(t, func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(time.Second)
		answer(w)
	}).config(everyInterval(5, 100*time.Millisecond))
	config.MaxInFlight = maxInFlight
	result, err := Run(t.Context(), config)
	if err != nil {
		t.Fatal(err)
	}
	for index, sample := range result.Samples {
		fromSchedule, fromSend := sample.firstDelta-sample.at, sample.firstDelta-sample.sent
		if fromSchedule != corrected[index] || fromSend != time.Second {
			t.Errorf("request %d: %s from schedule, %s from send, want %s and 1s",
				index, fromSchedule, fromSend, corrected[index])
		}
	}
	ttft := Summarize("", &result, time.Second).TTFT
	if want := milliseconds(corrected[len(corrected)-1]); ttft.Corrected.P99 != want || ttft.Naive.P99 != 1000 {
		t.Errorf("p99 corrected %v naive %v, want %v and 1000", ttft.Corrected.P99, ttft.Naive.P99, want)
	}
}

func TestTimeoutsAreCountedAndLeaveNoGoroutines(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		before := runtime.NumGoroutine()
		gateway := newFakeGateway(t, func(w http.ResponseWriter, r *http.Request) {
			writeEvent(w, `{"_tag":"Citations","passages":[]}`)
			<-r.Context().Done()
		})
		config := gateway.config(everyInterval(10, 100*time.Millisecond))
		config.Timeout = 2 * time.Second
		result, err := Run(t.Context(), config)
		if err != nil {
			t.Fatal(err)
		}
		for index, sample := range result.Samples {
			if sample.outcome != OutcomeTimeout || sample.done != sample.at+2*time.Second {
				t.Errorf("request %d: outcome %d done %s", index, sample.outcome, sample.done)
			}
		}
		if timeouts := Summarize("", &result, time.Second).Errors.Timeout; timeouts != 10 {
			t.Errorf("counted %d timeouts, want 10", timeouts)
		}
		assertNoLeak(t, gateway, before)
	})
}

func TestCancellingTheRunStopsSendingAndLeavesNoGoroutines(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		before := runtime.NumGoroutine()
		gateway := newFakeGateway(t, func(_ http.ResponseWriter, r *http.Request) {
			<-r.Context().Done()
		})
		ctx, cancel := context.WithCancel(t.Context())
		time.AfterFunc(450*time.Millisecond, cancel)
		result, err := Run(ctx, gateway.config(everyInterval(10, 100*time.Millisecond)))
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Planned) != 10 || len(result.Samples) != 5 {
			t.Fatalf("planned %d, sent %d, want 10 and 5", len(result.Planned), len(result.Samples))
		}
		for index, sample := range result.Samples {
			if sample.outcome != OutcomeCancelled || sample.done != 450*time.Millisecond {
				t.Errorf("request %d: outcome %d done %s", index, sample.outcome, sample.done)
			}
		}
		assertNoLeak(t, gateway, before)
	})
}

func TestSessionsRotateBeforeTheirPerMinuteBudget(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		gateway := newFakeGateway(t, func(w http.ResponseWriter, _ *http.Request) { answer(w) })
		result, err := Run(t.Context(), gateway.config(everyInterval(600, 250*time.Millisecond)))
		if err != nil {
			t.Fatal(err)
		}
		summary := Summarize("", &result, time.Minute)
		if summary.OK != 600 || len(summary.Errors.HTTP) != 0 {
			t.Fatalf("ok %d, http errors %v", summary.OK, summary.Errors.HTTP)
		}
		if gateway.busiest > 8 || gateway.issued != 30 || summary.Sessions != 30 {
			t.Fatalf("busiest token %d chats a minute, issued %d, minted %d",
				gateway.busiest, gateway.issued, summary.Sessions)
		}
	})
}

func TestSessionPoolMintsOnlyWhenEveryTokenIsSpent(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		minted := 0
		pool := newSessionPool(func(context.Context) (string, time.Time, error) {
			minted++
			return strconv.Itoa(minted), time.Now().Add(time.Hour), nil
		}, 8, time.Minute)
		tokens := make([]string, 0, 21)
		for range 20 {
			tokens = append(tokens, acquire(t, pool))
		}
		time.Sleep(time.Minute)
		tokens = append(tokens, acquire(t, pool))
		want := slices.Concat(slices.Repeat([]string{"1"}, 8), slices.Repeat([]string{"2"}, 8),
			slices.Repeat([]string{"3"}, 4), []string{"1"})
		if !slices.Equal(tokens, want) || minted != 3 {
			t.Fatalf("tokens %v, minted %d", tokens, minted)
		}
	})
}

func acquire(t *testing.T, pool *sessionPool) string {
	t.Helper()
	token, err := pool.acquire(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func assertNoLeak(t *testing.T, gateway *fakeGateway, before int) {
	t.Helper()
	gateway.close()
	synctest.Wait()
	if after := runtime.NumGoroutine(); after != before {
		t.Fatalf("%d goroutines before the run, %d after", before, after)
	}
}

func durations(milliseconds ...int) []time.Duration {
	all := make([]time.Duration, len(milliseconds))
	for index, value := range milliseconds {
		all[index] = time.Duration(value) * time.Millisecond
	}
	return all
}
