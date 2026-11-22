package eventlog

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/platanus/ultimo-paso/internal/engine"
)

func TestArchivePreservesPayloadAndReportsPartialCapture(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "private")
	path := filepath.Join(dir, "payloads.jsonl")
	archive, err := OpenArchive(path)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte{0, 255, '\n', 'x'}
	r := &engine.Request{TraceID: "fixture-1", Method: "POST", RawTarget: "/catalog?text=%2f%20",
		Headers: map[string]string{"Content-Type": "application/octet-stream", "Authorization": "hidden"},
		Body:    payload, BodyIncomplete: true}
	meta := archive.Record(r)
	if meta.State != "partial" || meta.BodyBytes != len(payload) || len(meta.SHA256) != 64 {
		t.Fatalf("bad capture metadata: %+v", meta)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var saved archiveRecord
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(saved.Body, payload) || saved.Target != r.RawTarget || saved.TraceID != "fixture-1" || saved.Complete {
		t.Fatalf("payload or provenance changed: %+v", saved)
	}
	if _, leaked := saved.Headers["Authorization"]; leaked {
		t.Fatal("authorization header entered archive")
	}
	stat, err := os.Stat(path)
	if err != nil || stat.Mode().Perm() != 0o600 {
		t.Fatalf("archive file is not private: %v %v", stat, err)
	}
	if _, err := OpenArchive(path); err == nil {
		t.Fatal("archive was overwritten")
	}
}
