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
	"strconv"
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
	TraceID    string    `json:"trace_id,omitempty"`
	IncidentID string    `json:"incident_id,omitempty"`
	TS         time.Time `json:"ts"`
	ActorID    string    `json:"actor"`
	Route      string    `json:"route"`
	Method     string    `json:"method"`
	Path       string    `json:"path"`
	Evidence   []string  `json:"evidence"`
	RuleID     string    `json:"rule_id"`
}

// Manager implements engine.ContainFunc via Handle.
type Manager struct {
	rules      *engine.RuleStore
	webhookURL string
	researcher Researcher
	ttl        time.Duration
	client     *http.Client
	events     engine.EventSink

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

func (m *Manager) WithEvents(events engine.EventSink) *Manager {
	m.events = events
	return m
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
	expiresAt := now.Add(m.ttl)
	m.rules.Add(&engine.Rule{
		ID: id, ActorID: in.ActorID, Route: in.Route, Action: engine.Divert,
		Origin: "containment", Stage: engine.Enforce,
		CreatedAt: now, ExpiresAt: expiresAt,
	})

	event := engine.Event{TS: now, ActorID: in.ActorID, Route: in.Route, Evidence: in.Evidence,
		RuleID: id, IncidentID: in.IncidentID, ExpiresAt: &expiresAt}
	if !in.ObservedAt.IsZero() {
		elapsed := float64(now.Sub(in.ObservedAt)) / float64(time.Millisecond)
		event.ElapsedMS = &elapsed
	}
	al := Alert{TS: now, ActorID: in.ActorID, Route: in.Route, Evidence: in.Evidence, RuleID: id, IncidentID: in.IncidentID}
	if in.Request != nil {
		al.Method = in.Request.Method
		al.Path = in.Request.Path
		al.TraceID = in.Request.TraceID
		event.TraceID = al.TraceID
		event.FixtureID = in.Request.FixtureID
	}
	m.emit(event, "rule_installed", "actor-and-route")
	m.mu.Lock()
	m.alerts = append(m.alerts, al)
	m.mu.Unlock()

	log.Printf("[contain] rule=%s actor=%s route=%s evidence=%v ttl=%s", id, in.ActorID, in.Route, in.Evidence, m.ttl)
	m.emit(event, "alert_created", "local-alert")

	if m.researcher != nil {
		go m.researcher.Investigate(in)
	}
	m.emit(event, "alert_delivery", m.postWebhook(al))
}

func (m *Manager) emit(event engine.Event, kind, reason string) {
	if m.events != nil {
		event.TS = time.Now()
		event.Kind = kind
		event.Reason = reason
		m.events.Emit(event)
	}
}

func (m *Manager) postWebhook(al Alert) string {
	if m.webhookURL == "" {
		return "not-configured"
	}
	b, _ := json.Marshal(al)
	req, err := http.NewRequest(http.MethodPost, m.webhookURL, bytes.NewReader(b))
	if err != nil {
		return "failed"
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		log.Printf("[contain] webhook error: %v", err)
		return "failed"
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "failed-http-" + strconv.Itoa(resp.StatusCode)
	}
	return "delivered-http-" + strconv.Itoa(resp.StatusCode)
}

// Alerts returns a snapshot (for the admin/scoreboard UI).
func (m *Manager) Alerts() []Alert {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Alert, len(m.alerts))
	copy(out, m.alerts)
	return out
}
