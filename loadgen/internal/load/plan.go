package load

import (
	"math"
	"math/rand/v2"
	"sort"
	"time"
)

const (
	ArrivalStream uint64 = iota + 1
	QuestionStream
)

type Segment struct {
	Rate   float64
	Length time.Duration
}

type Request struct {
	At       time.Duration
	Question string
}

func Steady(rate float64, length time.Duration) []Segment {
	return []Segment{{Rate: rate, Length: length}}
}

func Spike(rate, multiplier float64, at, window, length time.Duration) []Segment {
	return []Segment{
		{Rate: rate, Length: at},
		{Rate: rate * multiplier, Length: window},
		{Rate: rate, Length: length - at - window},
	}
}

//nolint:gosec // reproducible traffic needs a seedable PRNG, and nothing it picks is secret
func Seeded(seed, stream uint64) *rand.Rand {
	return rand.New(rand.NewPCG(seed, stream))
}

func Arrivals(segments []Segment, poisson *rand.Rand) []time.Duration {
	expected := 0.0
	for _, segment := range segments {
		expected += segment.Rate * segment.Length.Seconds()
	}
	arrivals := make([]time.Duration, 0, int(expected)+1)
	var offset time.Duration
	for _, segment := range segments {
		arrivals = appendSegment(arrivals, segment, offset, poisson)
		offset += segment.Length
	}
	return arrivals
}

func appendSegment(
	arrivals []time.Duration, segment Segment, offset time.Duration, poisson *rand.Rand,
) []time.Duration {
	if segment.Rate <= 0 {
		return arrivals
	}
	if poisson == nil {
		for i := 0; ; i++ {
			at := seconds(float64(i) / segment.Rate)
			if at >= segment.Length {
				return arrivals
			}
			arrivals = append(arrivals, offset+at)
		}
	}
	gap := func() time.Duration { return seconds(poisson.ExpFloat64() / segment.Rate) }
	for at := gap(); at < segment.Length; at += gap() {
		arrivals = append(arrivals, offset+at)
	}
	return arrivals
}

func seconds(value float64) time.Duration {
	return time.Duration(value * float64(time.Second))
}

func Plan(arrivals []time.Duration, pick func(index int) string) []Request {
	plan := make([]Request, len(arrivals))
	for index, at := range arrivals {
		plan[index] = Request{At: at, Question: pick(index)}
	}
	return plan
}

func RoundRobin(questions []string) func(int) string {
	return func(index int) string {
		return questions[index%len(questions)]
	}
}

func Zipf(questions []string, exponent float64, random *rand.Rand) func(int) string {
	ranks := newZipf(len(questions), exponent)
	return func(int) string {
		return questions[ranks.sample(random)]
	}
}

type zipf struct {
	cumulative []float64
}

func newZipf(size int, exponent float64) zipf {
	cumulative := make([]float64, size)
	total := 0.0
	for rank := range size {
		total += 1 / math.Pow(float64(rank+1), exponent)
		cumulative[rank] = total
	}
	for rank := range cumulative {
		cumulative[rank] /= total
	}
	return zipf{cumulative: cumulative}
}

func (z zipf) sample(random *rand.Rand) int {
	draw := random.Float64()
	rank := sort.Search(len(z.cumulative), func(index int) bool { return z.cumulative[index] > draw })
	return min(rank, len(z.cumulative)-1)
}
