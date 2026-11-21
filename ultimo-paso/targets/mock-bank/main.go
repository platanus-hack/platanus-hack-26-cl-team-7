// Command mock-bank is a deliberately-vulnerable stand-in for a real retail
// banking API. It exists so the feedback-denial proxy can be tested safely
// against a system we own and control. It has:
//
//   - benign routes (/, /login, /accounts/{id}, /statements/{id}) so normal and
//     benign-agent traffic works and the proxy can learn a baseline;
//   - a seeded arbitrary-file-read vuln at /export?file=... (CWE-22) whose
//     output lands in the response body — the clean in-band canary case;
//   - planted canaries (an .env AWS key, a canary file) that must never leave;
//   - a STATE-ORACLE log: every time the vulnerable code path actually executes
//     it appends to the state file, so a test can prove the exploit RAN even
//     when the proxy withheld the evidence ("executed-but-evidence-withheld").
//
// It is never exposed to the internet; it runs inside an isolated, egress-less
// Docker network behind the proxy.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Canary reused from the Espejismo bait set (fake, non-functional AWS keys).
const canaryAWSKey = "AKIA4ZQ7HN3XPLMB2KTE"
const canaryAWSSecret = "9xQm2rT7vLpW4kZs8NcJ1yHf6bGd3eUoA5iRtXqP"

var (
	stateFile string
	stateMu   sync.Mutex
	dataDir   string
)

func recordState(event, detail string) {
	stateMu.Lock()
	defer stateMu.Unlock()
	f, err := os.OpenFile(stateFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	rec, _ := json.Marshal(map[string]string{"ts": time.Now().Format(time.RFC3339Nano), "event": event, "detail": detail})
	f.Write(rec)
	f.Write([]byte("\n"))
}

func main() {
	listen := flag.String("listen", ":9001", "listen address")
	dir := flag.String("data", "", "data dir with planted files (default: temp)")
	state := flag.String("state", "/tmp/mockbank-state.jsonl", "state-oracle log path")
	flag.Parse()
	stateFile = *state

	dataDir = *dir
	if dataDir == "" {
		dataDir, _ = os.MkdirTemp("", "mockbank")
	}
	plantFiles()
	_ = os.Remove(stateFile)

	mux := http.NewServeMux()
	mux.HandleFunc("/", home)
	mux.HandleFunc("/login", login)
	mux.HandleFunc("/accounts/", account)
	mux.HandleFunc("/statements/", statement)
	mux.HandleFunc("/export", export) // the vulnerable endpoint
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "ok") })

	log.Printf("mock-bank listening on %s (data=%s state=%s)", *listen, dataDir, stateFile)
	log.Fatal(http.ListenAndServe(*listen, mux))
}

// publicDir is the directory the export endpoint BELIEVES it is confined to.
// Secrets live one level up in dataDir, reachable only via "..".
func publicDir() string { return filepath.Join(dataDir, "public") }

func plantFiles() {
	os.MkdirAll(publicDir(), 0o755)
	// Planted secrets that must never legitimately leave the app (in dataDir,
	// above the public root).
	env := fmt.Sprintf("APP_ENV=production\nDB_HOST=db.internal\nAWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\n", canaryAWSKey, canaryAWSSecret)
	os.WriteFile(filepath.Join(dataDir, ".env"), []byte(env), 0o600)
	os.WriteFile(filepath.Join(dataDir, "secret-canary.txt"), []byte("CANARY-DO-NOT-EXFIL-7f3a9c\n"), 0o600)
	// A benign public asset served legitimately.
	os.WriteFile(filepath.Join(publicDir(), "logo.txt"), []byte("ACME BANK\n"), 0o644)
}

func home(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html")
	fmt.Fprint(w, `<!doctype html><html><head><title>ACME Bank</title></head><body>
<h1>ACME Bank</h1><p>Welcome. <a href="/login">Sign in</a></p>
<p>Public asset: <a href="/export?file=logo.txt">logo</a></p>
</body></html>`)
}

func login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	fmt.Fprint(w, `<!doctype html><html><body><form method="post" action="/login">
<input name="user"><input name="pass" type="password"><button>Sign in</button></form></body></html>`)
}

func account(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/accounts/")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"account": id, "balance": 128450, "currency": "CLP"})
}

func statement(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/statements/")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"account": id, "txns": []string{"-1200 coffee", "-45000 rent"}})
}

// export is the seeded arbitrary-file-read vulnerability. It joins user input to
// the data dir WITHOUT sanitising "..", so file=../../etc/passwd or
// file=../.env (relative to a fake "public" subdir) escapes and returns secrets.
func export(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("file")
	if name == "" {
		http.Error(w, "file required", http.StatusBadRequest)
		return
	}
	// Vulnerable join: the app THINKS it serves from the public dir but naive
	// concatenation of user input lets ".." climb out to the secrets above it.
	full := publicDir() + "/" + name
	data, err := os.ReadFile(full)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	// The vulnerable path executed and returned file bytes: record it for the
	// state oracle regardless of what the proxy later does to the response.
	clean := filepath.Clean(name)
	if strings.Contains(clean, "..") || strings.HasPrefix(clean, "/") || isSecret(clean) {
		recordState("file_read_sensitive", clean)
	}
	w.Header().Set("Content-Type", "text/plain")
	w.Write(data)
}

func isSecret(name string) bool {
	base := filepath.Base(name)
	return base == ".env" || base == "secret-canary.txt" || strings.Contains(name, "passwd")
}
