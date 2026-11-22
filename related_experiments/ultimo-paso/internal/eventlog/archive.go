package eventlog

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/platanus/ultimo-paso/internal/engine"
)

const maxArchiveSize = 64 << 20

// Archive stores original request payloads locally, separately from the public
// evidence journal. One archive belongs to one engine process.
type Archive struct {
	mu     sync.Mutex
	file   *os.File
	size   int
	failed bool
}

func OpenArchive(path string) (*Archive, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	info, err := os.Stat(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("payload archive directory must be private (chmod 700)")
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	return &Archive{file: f}, nil
}

type archiveRecord struct {
	TraceID  string            `json:"trace_id"`
	Method   string            `json:"method"`
	Target   string            `json:"raw_target"`
	Headers  map[string]string `json:"headers"`
	Body     []byte            `json:"body_base64"`
	Complete bool              `json:"body_complete"`
}

func (a *Archive) Record(r *engine.Request) *engine.PayloadCapture {
	result := &engine.PayloadCapture{State: "recorded", BodyBytes: len(r.Body)}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.failed {
		result.State = "write-failed"
		return result
	}
	if a.size >= maxArchiveSize {
		result.State = "archive-full"
		return result
	}
	headers := make(map[string]string, len(r.Headers))
	for name, value := range r.Headers {
		switch strings.ToLower(name) {
		case "authorization", "proxy-authorization", "cookie", "x-api-key":
		default:
			headers[name] = value
		}
	}
	body := r.Body
	if body == nil {
		body = []byte{}
	}
	record := archiveRecord{TraceID: r.TraceID, Method: r.Method, Target: r.RawTarget,
		Headers: headers, Body: body, Complete: !r.BodyIncomplete}
	encoded, err := json.Marshal(record)
	if err != nil {
		result.State = "write-failed"
		return result
	}
	if a.size+len(encoded)+1 > maxArchiveSize {
		result.State = "archive-full"
		return result
	}
	n, err := a.file.Write(append(encoded, '\n'))
	a.size += n
	if err != nil {
		a.failed = true
		result.State = "write-failed"
		return result
	}
	if r.BodyIncomplete {
		result.State = "partial"
	}
	digest := sha256.Sum256(r.Body)
	result.SHA256 = hex.EncodeToString(digest[:])
	return result
}

func (a *Archive) Close() error { return a.file.Close() }
