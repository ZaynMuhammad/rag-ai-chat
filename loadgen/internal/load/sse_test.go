package load

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"slices"
	"testing"
	"testing/iotest"
)

const sseStream = "data: {\"_tag\":\"Delta\",\"text\":\"Pokémon ポケモン 🎮\"}\n\n" +
	": keep-alive\n\n" +
	"data: first line\ndata: second line\n\n" +
	"event: ignored\r\ndata: {\"_tag\":\"Done\",\"model\":null}\r\n\r\n"

var sseEvents = []string{
	"{\"_tag\":\"Delta\",\"text\":\"Pokémon ポケモン 🎮\"}",
	"first line\nsecond line",
	"{\"_tag\":\"Done\",\"model\":null}",
}

func TestSSEFramesSplitAcrossReads(t *testing.T) {
	stream := []byte(sseStream)
	readers := map[string]io.Reader{"one byte at a time": iotest.OneByteReader(bytes.NewReader(stream))}
	for cut := 1; cut < len(stream); cut++ {
		halves := io.MultiReader(bytes.NewReader(stream[:cut]), bytes.NewReader(stream[cut:]))
		readers[fmt.Sprintf("cut at byte %d", cut)] = halves
	}
	for name, reader := range readers {
		if got := readAll(t, reader); !slices.Equal(got, sseEvents) {
			t.Fatalf("split %q: got %q", name, got)
		}
	}
}

func TestSSEStreamCutMidFrameIsUnexpected(t *testing.T) {
	events := newSSEReader(bytes.NewReader([]byte("data: {\"_tag\":\"Delta\",\"text\":\"Pok\xc3")))
	if _, err := events.next(); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("got %v, want an unexpected EOF", err)
	}
}

func readAll(t *testing.T, reader io.Reader) []string {
	t.Helper()
	events := newSSEReader(reader)
	var all []string
	for {
		event, err := events.next()
		if errors.Is(err, io.EOF) {
			return all
		}
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, string(event))
	}
}
