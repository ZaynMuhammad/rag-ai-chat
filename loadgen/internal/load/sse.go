package load

import (
	"bufio"
	"bytes"
	"errors"
	"io"
)

type sseReader struct {
	lines   *bufio.Reader
	data    []byte
	hasData bool
}

func newSSEReader(body io.Reader) *sseReader {
	return &sseReader{lines: bufio.NewReader(body)}
}

func (r *sseReader) next() ([]byte, error) {
	for {
		line, err := r.lines.ReadBytes('\n')
		switch {
		case errors.Is(err, io.EOF) && len(line) == 0 && !r.hasData:
			return nil, io.EOF
		case errors.Is(err, io.EOF):
			return nil, io.ErrUnexpectedEOF
		case err != nil:
			return nil, err
		}
		line = bytes.TrimSuffix(bytes.TrimSuffix(line, []byte("\n")), []byte("\r"))
		if len(line) == 0 {
			if r.hasData {
				event := r.data
				r.data, r.hasData = nil, false
				return event, nil
			}
			continue
		}
		r.appendField(line)
	}
}

func (r *sseReader) appendField(line []byte) {
	field, value, _ := bytes.Cut(line, []byte(":"))
	if !bytes.Equal(field, []byte("data")) {
		return
	}
	if r.hasData {
		r.data = append(r.data, '\n')
	}
	r.data = append(r.data, bytes.TrimPrefix(value, []byte(" "))...)
	r.hasData = true
}
