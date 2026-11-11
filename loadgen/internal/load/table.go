package load

import (
	"fmt"
	"io"
	"maps"
	"slices"
	"strings"
	"text/tabwriter"
)

func (s *Summary) WriteTable(w io.Writer) error {
	overview := []string{
		s.Scenario,
		fmt.Sprintf("requests\t%d planned, %d sent, %d ok", s.Planned, s.Sent, s.OK),
		"errors\t" + s.Errors.describe(),
		fmt.Sprintf("rate /s\tscheduled %.2f, sent %.2f, completed %.2f",
			s.Rates.Scheduled, s.Rates.Sent, s.Rates.Completed),
		fmt.Sprintf("sessions\t%d minted", s.Sessions),
		"models\t" + describeCounts(s.Models),
		"",
	}
	latency := []string{
		"ms\tp50\tp95\tp99\tmax\tn\t",
		latencyRow("ttft", s.TTFT.Corrected),
		latencyRow("ttft naive", s.TTFT.Naive),
		latencyRow("total", s.Total.Corrected),
		latencyRow("total naive", s.Total.Naive),
		latencyRow("send lag", s.SendLag),
		"",
	}
	buckets := make([]string, 0, len(s.Buckets)+1)
	buckets = append(buckets, "bucket\tscheduled\tok\terrors\tttft p50\tttft p95\t")
	for _, bucket := range s.Buckets {
		buckets = append(buckets, fmt.Sprintf("%.0fs\t%d\t%d\t%d\t%.0f\t%.0f\t",
			bucket.StartSeconds, bucket.Scheduled, bucket.OK, bucket.Errors, bucket.TTFT.P50, bucket.TTFT.P95))
	}
	if err := writeAligned(w, 0, overview); err != nil {
		return err
	}
	if err := writeAligned(w, tabwriter.AlignRight, latency); err != nil {
		return err
	}
	return writeAligned(w, tabwriter.AlignRight, buckets)
}

func writeAligned(w io.Writer, flags uint, lines []string) error {
	table := tabwriter.NewWriter(w, 0, 0, 2, ' ', flags)
	for _, line := range lines {
		if _, err := fmt.Fprintln(table, line); err != nil {
			return fmt.Errorf("write table: %w", err)
		}
	}
	if err := table.Flush(); err != nil {
		return fmt.Errorf("write table: %w", err)
	}
	return nil
}

func latencyRow(name string, p Percentiles) string {
	return fmt.Sprintf("%s\t%.0f\t%.0f\t%.0f\t%.0f\t%d\t", name, p.P50, p.P95, p.P99, p.Max, p.Count)
}

func (e Errors) describe() string {
	parts := make([]string, 0, len(e.HTTP)+6)
	for _, status := range slices.Sorted(maps.Keys(e.HTTP)) {
		parts = append(parts, fmt.Sprintf("http %d: %d", status, e.HTTP[status]))
	}
	if len(e.HTTP) == 0 {
		parts = append(parts, "http: 0")
	}
	parts = append(parts, fmt.Sprintf("failed event: %d", e.FailedEvent), fmt.Sprintf("timeout: %d", e.Timeout))
	for _, other := range []struct {
		name  string
		count int
	}{{"transport", e.Transport}, {"protocol", e.Protocol}, {"session", e.Session}, {"cancelled", e.Cancelled}} {
		if other.count > 0 {
			parts = append(parts, fmt.Sprintf("%s: %d", other.name, other.count))
		}
	}
	return strings.Join(parts, ", ")
}

func describeCounts(counts map[string]int) string {
	if len(counts) == 0 {
		return "none"
	}
	parts := make([]string, 0, len(counts))
	for _, name := range slices.Sorted(maps.Keys(counts)) {
		parts = append(parts, fmt.Sprintf("%s: %d", name, counts[name]))
	}
	return strings.Join(parts, ", ")
}
