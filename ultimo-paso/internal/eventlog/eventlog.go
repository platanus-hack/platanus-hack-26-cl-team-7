// Package eventlog is a non-blocking JSONL sink for engine events. The
// scoreboard reads this file to build the before/after tables.
package eventlog

import (
	"bufio"
	"encoding/json"
	"os"
	"sync"

	"github.com/platanus/ultimo-paso/internal/engine"
)

// Sink writes engine.Event records as JSON lines.
type Sink struct {
	mu sync.Mutex
	w  *bufio.Writer
	f  *os.File
}

// Open creates/truncates path and returns a Sink. If path is "", events go to
// stdout.
func Open(path string) (*Sink, error) {
	if path == "" {
		return &Sink{w: bufio.NewWriter(os.Stdout)}, nil
	}
	f, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	return &Sink{w: bufio.NewWriter(f), f: f}, nil
}

// Emit writes one event. Errors are dropped (the proxy must not block on logs).
func (s *Sink) Emit(e engine.Event) {
	b, err := json.Marshal(e)
	if err != nil {
		return
	}
	s.mu.Lock()
	s.w.Write(b)
	s.w.WriteByte('\n')
	s.w.Flush()
	s.mu.Unlock()
}

// Close flushes and closes the file.
func (s *Sink) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.w.Flush()
	if s.f != nil {
		return s.f.Close()
	}
	return nil
}
