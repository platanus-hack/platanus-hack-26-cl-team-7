// Package containment turns a confirmed exploit transaction into an immediate,
// time-limited proxy rule, raises an alert, and kicks the asynchronous research
// loop. Everything here runs off the hot path.
package containment

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/platanus/ultimo-paso/internal/engine"
)

// Researcher is the L3 research loop entry point. It is called asynchronously
// with the confirmed transaction and proposes (never auto-deploys) a rule.
type Researcher interface {
	Investigate(engine.ContainInput)
}

// Alert is one notification record (also written to the event log by the proxy).
type Alert struct {
	TS       time.Time `json:"ts"`
	ActorID  string    `json:"actor"`
	Route    string    `json:"route"`
	Method   string    `json:"method"`
	Path     string    `json:"path"`
	Evidence []string  `json:"evidence"`
	RuleID   string    `json:"rule_id"`
}

// Manager implements engine.ContainFunc via Handle.
type Manager struct {
	rules      *engine.RuleStore
	webhookURL string
	researcher Researcher
	ttl        time.Duration
	client     *http.Client

	mu     sync.Mutex
	alerts []Alert
	seq    int
}

// New builds a Manager. ttl<=0 defaults to 30 minutes.
func New(rules *engine.RuleStore, webhookURL string, r Researcher, ttl time.Duration) *Manager {
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	return &Manager{rules: rules, webhookURL: webhookURL, researcher: r, ttl: ttl,
		client: &http.Client{Timeout: 3 * time.Second}}
}

// Handle is the engine.ContainFunc. It writes a narrow enforce rule scoped to
// the exact actor+route, alerts, and queues research. Target: rule active in
// well under 100 ms (it is an in-memory insert).
func (m *Manager) Handle(in engine.ContainInput) {
	m.mu.Lock()
	m.seq++
	id := fmt.Sprintf("contain-%d", m.seq)
	m.mu.Unlock()

	now := time.Now()
	// Divert (not bare block) so the already-confirmed actor keeps getting
	// believable fake errors instead of a detection signal.
	m.rules.Add(&engine.Rule{
		ID: id, ActorID: in.ActorID, Route: in.Route, Action: engine.Divert,
		Origin: "containment", Stage: engine.Enforce,
		CreatedAt: now, ExpiresAt: now.Add(m.ttl),
	})

	al := Alert{TS: now, ActorID: in.ActorID, Route: in.Route, Evidence: in.Evidence, RuleID: id}
	if in.Request != nil {
		al.Method = in.Request.Method
		al.Path = in.Request.Path
	}
	m.mu.Lock()
	m.alerts = append(m.alerts, al)
	m.mu.Unlock()

	log.Printf("[contain] rule=%s actor=%s route=%s evidence=%v ttl=%s", id, in.ActorID, in.Route, in.Evidence, m.ttl)
	m.postWebhook(al)

	if m.researcher != nil {
		go m.researcher.Investigate(in)
	}
}

func (m *Manager) postWebhook(al Alert) {
	if m.webhookURL == "" {
		return
	}
	b, _ := json.Marshal(al)
	req, err := http.NewRequest(http.MethodPost, m.webhookURL, bytes.NewReader(b))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		log.Printf("[contain] webhook error: %v", err)
		return
	}
	resp.Body.Close()
}

// Alerts returns a snapshot (for the admin/scoreboard UI).
func (m *Manager) Alerts() []Alert {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Alert, len(m.alerts))
	copy(out, m.alerts)
	return out
}
