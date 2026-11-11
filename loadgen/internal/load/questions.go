package load

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"strings"
)

var errNoQuestions = errors.New("no questions found")

type questionLine struct {
	Question string `json:"question"`
}

func LoadQuestions(directory fs.FS) ([]string, error) {
	files, err := fs.Glob(directory, "*.jsonl")
	if err != nil {
		return nil, fmt.Errorf("list question files: %w", err)
	}
	var questions []string
	for _, file := range files {
		content, err := fs.ReadFile(directory, file)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", file, err)
		}
		parsed, err := parseQuestions(content)
		if err != nil {
			return nil, fmt.Errorf("decode %s: %w", file, err)
		}
		questions = append(questions, parsed...)
	}
	if len(questions) == 0 {
		return nil, errNoQuestions
	}
	return questions, nil
}

func parseQuestions(content []byte) ([]string, error) {
	var questions []string
	for line := range bytes.Lines(content) {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var entry questionLine
		if err := json.Unmarshal(line, &entry); err != nil {
			return nil, fmt.Errorf("decode question: %w", err)
		}
		if strings.TrimSpace(entry.Question) != "" {
			questions = append(questions, entry.Question)
		}
	}
	return questions, nil
}
