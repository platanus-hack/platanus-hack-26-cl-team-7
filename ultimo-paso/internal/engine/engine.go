package engine

import (
	"crypto/rand"
	"fmt"
	"strings"
	"sync/atomic"
	"time"
)

// Event is one structured record emitted to the event log for the scoreboard.
type Event struct {
	HasPayload bool            `json:"has_payload,omitempty"`
	Payload    *PayloadCapture `json:"payload_capture,omitempty"`
	RunID      string          `json:"run_id,omitempty"`
	DataPlane  string          `json:"data_plane,omitempty"`
	TraceID    string          `json:"trace_id,omitempty"`
	FixtureID  string          `json:"fixture_id,omitempty"`
	IncidentID string          `json:"incident_id,omitempty"`
	Pattern    string          `json:"pattern,omitempty"`
	Status     int             `json:"status,omitempty"`
	ExpiresAt  *time.Time      `json:"expires_at,omitempty"`
	ElapsedMS  *float64        `json:"elapsed_ms,omitempty"`
	TS         time.Time       `json:"ts"`
	Kind       string          `json:"kind"` // request|response|contain
	ActorID    string          `json:"actor"`
	Level      string          `json:"level"`
	Symbol     string          `json:"symbol,omitempty"`
	Method     string          `json:"method,omitempty"`
	Route      string          `json:"route,omitempty"`
	Path       string          `json:"path,omitempty"`
	Action     string          `json:"action,omitempty"`
	Evidence   []string        `json:"evidence,omitempty"`
	RuleID     string          `json:"rule_id,omitempty"`
	Narrowing  float64         `json:"narrowing,omitempty"`
	Adaptive   float64         `json:"adaptive,omitempty"`
	Reason     string          `json:"reason,omitempty"`
}

// PayloadCapture contains only metadata safe to include in the evidence journal.
type PayloadCapture struct {
	State     string `json:"state"`
	BodyBytes int    `json:"body_bytes"`
	SHA256    string `json:"sha256,omitempty"`
}

// EventSink receives engine events. Implementations must be safe for concurrent
// use and non-blocking.
type EventSink interface{ Emit(Event) }

// nopSink drops events.
type nopSink struct{}

func (nopSink) Emit(Event) {}

// ContainInput is handed to the containment callback when a response confirms
// exploitation. The callback runs asynchronously, off the hot path.
type ContainInput struct {
	IncidentID string
	ObservedAt time.Time
	ActorID    string
	Route      string
	Request    *Request
	Response   *Response
	Evidence   []string
}

// ContainFunc writes a TTL containment rule, alerts, and kicks the research
// loop. It must not block the response path.
type ContainFunc func(ContainInput)

// Engine ties the layers together. It is safe for concurrent use.
type Engine struct {
	Rules    *RuleStore
	Patterns *PatternSet
	Actors   *ActorTable
	Scanner  *ResponseScanner

	now     func() time.Time
	events  EventSink
	contain ContainFunc
	capture func(*Request) *PayloadCapture

	trapSeq uint64
}

// Config configures a new Engine.
type Config struct {
	Clock   func() time.Time
	Events  EventSink
	Contain ContainFunc
	Capture func(*Request) *PayloadCapture
}

// New builds an engine with default pattern/scanner databases.
func New(cfg Config) *Engine {
	clock := cfg.Clock
	if clock == nil {
		clock = time.Now
	}
	ev := cfg.Events
	if ev == nil {
		ev = nopSink{}
	}
	return &Engine{
		Rules:    NewRuleStore(clock),
		Patterns: DefaultPatterns(),
		Actors:   NewActorTable(clock),
		Scanner:  DefaultScanner(),
		now:      clock,
		events:   ev,
		contain:  cfg.Contain,
		capture:  cfg.Capture,
	}
}

// OnRequest classifies a request, updates actor state, and returns a decision.
// Blocking/diverting here is containment of an *already-confirmed* actor via a
// standing rule. New exploits are deliberately allowed through so the engine
// can confirm them and deny feedback at the response.
func (e *Engine) OnRequest(r *Request) RequestDecision {
	r.TraceID = rand.Text()
	if r.Route == "" {
		r.Route = r.Path
	}
	a := e.Actors.Get(r)

	// L0: standing containment rule (already-confirmed actor).
	if rule := e.Rules.Match(a.ID, r.Route); rule != nil {
		d := RequestDecision{Action: rule.Action, Level: a.Level, ActorID: a.ID, RuleID: rule.ID,
			Reason: "containment " + rule.Origin}
		e.emitReq(r, a, SymBrowse, d)
		return d
	}

	sym, high, name := e.Patterns.Classify(r)
	e.Actors.Observe(a, r, sym, high, name)

	// Confirm on a planted token carried back to us.
	if sym == SymConfirm {
		e.Actors.Confirm(a, "honeytoken")
	}

	d := RequestDecision{Symbol: sym, Level: a.Level, ActorID: a.ID}
	d.Pattern = name
	switch {
	case a.Level == Confirmed:
		// Let it proceed but mark; response path will deny feedback. A standing
		// rule (added after first confirmation) is what diverts future requests.
		d.Action = Tag
		d.Reason = "confirmed:" + a.ConfirmedBy
	case a.Level == Suspect:
		d.Action = Trap // inject a honeytoken into the response if it is HTML
		d.Reason = "suspect"
	case sym == SymFingerprint:
		d.Action = Tag
		d.Reason = "fingerprint"
	default:
		d.Action = Pass
	}
	e.emitReq(r, a, sym, d)
	return d
}

// OnResponse inspects the paired response and decides whether to withhold it.
// reqDec is the decision OnRequest returned for the same transaction.
func (e *Engine) OnResponse(r *Request, resp *Response, reqDec RequestDecision) ResponseDecision {
	a := e.Actors.Get(r)

	if resp.Status == 404 {
		e.Actors.NoteNotFound(a)
	}

	evidence, canaryHit := e.Scanner.Scan(r.Route, resp)
	suspicious := a.Level >= Suspect || reqDec.Symbol >= SymProbe

	rd := ResponseDecision{Action: RespPass, Evidence: evidence, ActorID: a.ID}

	switch {
	case canaryHit:
		// A canary never legitimately leaves the app: block unconditionally.
		e.Actors.Confirm(a, "response-evidence")
		rd = e.deny(r, "canary", evidence)
	case len(evidence) > 0 && suspicious:
		// Correlated block: response evidence AND request-side suspicion. This
		// is what makes the layer safe against Response-Filter DoS.
		e.Actors.Confirm(a, "response-evidence")
		rd = e.deny(r, "correlated-evidence", evidence)
	case len(evidence) > 0 && !suspicious:
		// Evidence without suspicion: likely a planted string (RFDoS bait) or a
		// benign false positive. Do not block; log for review.
		rd.Reason = "evidence-without-suspicion:log-only"
	default:
		// Clean response: learn the baseline and feed adaptivity tokens.
		e.Scanner.Learn(r.Route, resp.ContentType, len(resp.Body))
		e.Actors.RecordResponseTokens(a, resp.Body)
		// Inject a honeytoken for suspects browsing HTML.
		if reqDec.Action == Trap && strings.Contains(resp.ContentType, "html") {
			e.injectTrap(a, resp)
		}
	}

	e.emitResp(r, a, rd, resp.Status)
	if rd.Contain && e.contain != nil {
		in := ContainInput{IncidentID: rand.Text(), ObservedAt: e.now(), ActorID: a.ID, Route: r.Route, Request: r, Response: resp, Evidence: evidence}
		e.events.Emit(Event{TS: in.ObservedAt, Kind: "contain", ActorID: a.ID, Level: a.Level.String(),
			TraceID: r.TraceID, FixtureID: r.FixtureID, IncidentID: in.IncidentID, Route: r.Route, Evidence: evidence, Reason: rd.Reason})
		go e.contain(in) // off the hot path
	}

	return rd
}

// deny builds a feedback-denying response: a believable fake error for a
// confirmed actor, withholding the evidential body, and flags containment.
func (e *Engine) deny(r *Request, reason string, evidence []string) ResponseDecision {
	status, body := FakeError(r.Route)
	return ResponseDecision{
		Action:   RespReplace,
		Evidence: evidence,
		Reason:   reason,
		Status:   status,
		Body:     body,
		Contain:  true,
	}
}

// injectTrap adds a unique sentinel link to an HTML body and binds the token to
// the actor so a later request carrying it re-links (even after IP rotation).
func (e *Engine) injectTrap(a *Actor, resp *Response) {
	seq := atomic.AddUint64(&e.trapSeq, 1)
	token := fmt.Sprintf("x7k%d%d", e.now().UnixNano(), seq)
	e.Actors.BindToken(token, a.ID)
	// A link only an automated crawler/agent would follow; disallowed in robots.
	snippet := fmt.Sprintf("\n<!-- session asset --><a href=\"/internal/report-%s\" style=\"display:none\">admin export</a>\n", token)
	if i := strings.LastIndex(string(resp.Body), "</body>"); i >= 0 {
		b := string(resp.Body)
		resp.Body = []byte(b[:i] + snippet + b[i:])
	} else {
		resp.Body = append(resp.Body, []byte(snippet)...)
	}
}

func (e *Engine) emitReq(r *Request, a *Actor, sym Symbol, d RequestDecision) {
	var payload *PayloadCapture
	if e.capture != nil {
		payload = e.capture(r)
	}
	e.events.Emit(Event{TS: e.now(), Kind: "request", ActorID: a.ID, Level: a.Level.String(),
		Payload:    payload,
		HasPayload: len(r.Body) > 0 || r.RawQuery != "" || sym >= SymProbe || r.Headers["x-catalog-note"] != "" || r.Headers["x-middleware-subrequest"] != "" || r.Headers["next-action"] != "",
		TraceID:    r.TraceID, FixtureID: r.FixtureID, Pattern: d.Pattern,
		Symbol: sym.String(), Method: r.Method, Route: r.Route, Path: r.Path, Action: d.Action.String(),
		RuleID: d.RuleID, Narrowing: a.Narrowing, Adaptive: a.Adaptive, Reason: d.Reason})
}

func (e *Engine) emitResp(r *Request, a *Actor, d ResponseDecision, status int) {
	if d.Action == RespReplace {
		status = d.Status
	}
	e.events.Emit(Event{TS: e.now(), Kind: "response", ActorID: a.ID, Level: a.Level.String(),
		TraceID: r.TraceID, FixtureID: r.FixtureID, Status: status,
		Route: r.Route, Action: d.Action.String(), Evidence: d.Evidence, Reason: d.Reason})
}

// Reset clears per-actor state and containment rules in place (preserving the
// pointers that containment/research hold). Used between scoreboard reps so each
// run starts from a clean slate.
func (e *Engine) Reset() {
	e.Actors.Clear()
	e.Rules.Clear()
}
