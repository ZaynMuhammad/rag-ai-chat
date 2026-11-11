package load

import (
	"fmt"
	"math"
	"slices"
	"testing"
	"time"
)

func TestZipfPicksFollowOneOverRankToTheS(t *testing.T) {
	questions := make([]string, 180)
	rankOf := map[string]int{}
	for rank := range questions {
		questions[rank] = fmt.Sprintf("question %d", rank)
		rankOf[questions[rank]] = rank
	}
	const draws = 200_000
	for _, exponent := range []float64{0.8, 1, 1.5} {
		pick := Zipf(questions, exponent, Seeded(7, QuestionStream))
		counts := make([]float64, len(questions))
		for index := range draws {
			counts[rankOf[pick(index)]]++
		}
		weights := make([]float64, len(questions))
		total := 0.0
		for rank := range weights {
			weights[rank] = 1 / math.Pow(float64(rank+1), exponent)
			total += weights[rank]
		}
		chiSquare := 0.0
		for rank, observed := range counts {
			expected := draws * weights[rank] / total
			chiSquare += (observed - expected) * (observed - expected) / expected
		}
		if critical := chiSquareCritical(len(questions)-1, 3.09); chiSquare > critical {
			t.Errorf("s=%g: chi-square %.1f over the p=0.001 critical value %.1f", exponent, chiSquare, critical)
		}
	}
}

func chiSquareCritical(degrees int, z float64) float64 {
	k := float64(degrees)
	return k * math.Pow(1-2/(9*k)+z*math.Sqrt(2/(9*k)), 3)
}

func TestSpikeArrivalsFollowTheShape(t *testing.T) {
	arrivals := Arrivals(Spike(4, 5, 20*time.Second, 10*time.Second, time.Minute), nil)
	inBurst := 0
	for _, at := range arrivals {
		if at >= 20*time.Second && at < 30*time.Second {
			inBurst++
		}
	}
	if len(arrivals) != 400 || inBurst != 200 || !slices.IsSorted(arrivals) {
		t.Fatalf("got %d arrivals, %d in the burst, sorted %t", len(arrivals), inBurst, slices.IsSorted(arrivals))
	}
}

func TestPoissonArrivalsAreSeededAndAverageTheRate(t *testing.T) {
	segments := Steady(4, 10*time.Minute)
	arrivals := Arrivals(segments, Seeded(1, ArrivalStream))
	again := Arrivals(segments, Seeded(1, ArrivalStream))
	if !slices.Equal(arrivals, again) {
		t.Fatal("the same seed gave different arrivals")
	}
	if expected, spread := 2400.0, 5*math.Sqrt(2400); math.Abs(float64(len(arrivals))-expected) > spread {
		t.Fatalf("got %d arrivals, want %.0f ± %.0f", len(arrivals), expected, spread)
	}
}
