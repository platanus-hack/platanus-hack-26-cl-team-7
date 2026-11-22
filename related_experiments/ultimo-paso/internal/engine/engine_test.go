package engine

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// capSink collects events for assertions.
type capSink struct {
	mu sync.Mutex
	ev []Event
}

func (c *capSink) Emit(e Event) { c.mu.Lock(); c.ev = append(c.ev, e); c.mu.Unlock() }

func newTestEngine(t *testing.T) (*Engine, *capSink, *[]ContainInput) {
	t.Helper()
	sink := &capSink{}
	var mu sync.Mutex
	var contained []ContainInput
	e := New(Config{
		Events: sink,
		Contain: func(in ContainInput) {
			mu.Lock()
			contained = append(contained, in)
			mu.Unlock()
		},
	})
	return e, sink, &contained
}

func req(method, path, query string) *Request {
	return &Request{Method: method, Path: path, RawQuery: query, Headers: map[string]string{},
		RemoteIP: "10.0.0.5", UserAgent: "scripted/1.0"}
}

// A benign browse passes and stays normal.
func TestBenignPasses(t *testing.T) {
	e, _, _ := newTestEngine(t)
	d := e.OnRequest(req("GET", "/accounts/42", ""))
	if d.Action != Pass {
		t.Fatalf("benign request: got %v, want pass", d.Action)
	}
	if d.Level != Normal {
		t.Fatalf("benign actor level: got %v, want normal", d.Level)
	}
}

// A path-traversal exploit confirms the actor; the canary in the response is
// withheld and containment fires.
func TestCanaryWithheldAndContained(t *testing.T) {
	e, _, contained := newTestEngine(t)
	e.Scanner.AddCanary("aws", "AKIA4ZQ7HN3XPLMB2KTE")

	r := req("GET", "/@fs/etc/passwd", "raw??")
	rd := e.OnRequest(r)
	if rd.Level != Confirmed {
		t.Fatalf("exploit should confirm actor, got level %v", rd.Level)
	}

	resp := &Response{Status: 200, ContentType: "text/plain",
		Headers: map[string]string{}, Body: []byte("AWS_SECRET=AKIA4ZQ7HN3XPLMB2KTE\n")}
	sd := e.OnResponse(r, resp, rd)
	if sd.Action != RespReplace {
		t.Fatalf("canary response: got %v, want replace", sd.Action)
	}
	if strings.Contains(string(sd.Body), "AKIA4ZQ7HN3XPLMB2KTE") {
		t.Fatalf("replacement body leaked the canary")
	}
	if !sd.Contain {
		t.Fatalf("canary hit must trigger containment")
	}
	// Containment callback runs in a goroutine; give it a moment.
	time.Sleep(20 * time.Millisecond)
	if len(*contained) == 0 {
		t.Fatalf("containment callback was not invoked")
	}
}

// RFDoS safety: a planted evidence string from an actor with no request-side
// suspicion must NOT be blocked.
func TestRFDoSSafe(t *testing.T) {
	e, _, _ := newTestEngine(t)
	r := req("GET", "/comments", "") // benign request
	rd := e.OnRequest(r)
	resp := &Response{Status: 200, ContentType: "text/html", Headers: map[string]string{},
		Body: []byte("<p>user said: root:x:0:0: haha</p>")} // bait string in a comment
	sd := e.OnResponse(r, resp, rd)
	if sd.Action != RespPass {
		t.Fatalf("evidence without suspicion must pass (RFDoS safe), got %v", sd.Action)
	}
}

// React2Shell-style command output in a response header is detected.
func TestHeaderEvidence(t *testing.T) {
	e, _, _ := newTestEngine(t)
	r := req("POST", "/", "")
	r.Headers["next-action"] = "x"
	rd := e.OnRequest(r)
	if rd.Symbol != SymExploit {
		t.Fatalf("react2shell marker should classify as exploit, got %v", rd.Symbol)
	}
	resp := &Response{Status: 200, ContentType: "text/html",
		Headers: map[string]string{"x-action-redirect": "uid=0(root) gid=0(root) groups=0(root)"},
		Body:    []byte("ok")}
	sd := e.OnResponse(r, resp, rd)
	if sd.Action != RespReplace {
		t.Fatalf("header command-output should be withheld, got %v", sd.Action)
	}
	found := false
	for _, ev := range sd.Evidence {
		if strings.Contains(ev, "header") {
			found = true
		}
	}
	if !found {
		t.Fatalf("evidence should name the header location, got %v", sd.Evidence)
	}
}

// Containment rule blocks the actor's next request at the proxy.
func TestContainmentRuleBlocks(t *testing.T) {
	e, _, _ := newTestEngine(t)
	r := req("GET", "/@fs/etc/passwd", "raw??")
	r.Route = "/@fs"
	rd := e.OnRequest(r)
	// Simulate the async containment writing a rule for this actor+route.
	e.Rules.Add(&Rule{ID: "c1", ActorID: rd.ActorID, Route: "/@fs", Action: Divert,
		Origin: "containment", Stage: Enforce, ExpiresAt: time.Now().Add(30 * time.Minute)})

	r2 := req("GET", "/@fs/etc/shadow", "raw??")
	r2.Route = "/@fs"
	d2 := e.OnRequest(r2)
	if d2.Action != Divert {
		t.Fatalf("next request from contained actor: got %v, want divert", d2.Action)
	}
	if d2.RuleID != "c1" {
		t.Fatalf("decision should cite the rule, got %q", d2.RuleID)
	}
}

// Adaptivity: a token first seen in a response and then sent in a request
// scores above zero; a wordlist-style request scores zero.
func TestAdaptivity(t *testing.T) {
	e, _, _ := newTestEngine(t)
	r1 := req("GET", "/", "")
	rd := e.OnRequest(r1)
	resp := &Response{Status: 200, ContentType: "text/html", Headers: map[string]string{},
		Body: []byte("<a href=/dashboard/secret-panel-9f3>link</a>")}
	e.OnResponse(r1, resp, rd)

	// Follow-up request reusing a token from the response body.
	r2 := req("GET", "/dashboard/secret-panel-9f3", "")
	e.OnRequest(r2)
	a := e.Actors.Get(r2)
	if a.Adaptive <= 0 {
		t.Fatalf("adaptivity should be >0 after reusing a response token, got %v", a.Adaptive)
	}

	// A wordlist request with no response-derived tokens scores zero.
	r3 := req("GET", "/wp-admin-backup-xyz", "")
	e.OnRequest(r3)
	a3 := e.Actors.Get(r3)
	if a3.Adaptive != 0 {
		t.Fatalf("wordlist request adaptivity should be 0, got %v", a3.Adaptive)
	}
}

// Token lineage: a request carrying a planted token re-links to the origin
// actor even from a different IP.
func TestTokenLineage(t *testing.T) {
	e, _, _ := newTestEngine(t)
	a := e.Actors.Get(req("GET", "/", ""))
	e.Actors.BindToken("x7kTOKEN", a.ID)

	r := &Request{Method: "GET", Path: "/internal/report-x7kTOKEN", Headers: map[string]string{},
		RemoteIP: "203.0.113.9", UserAgent: "different"} // new IP+UA
	got := e.Actors.Get(r)
	if got.ID != a.ID {
		t.Fatalf("planted token should re-link actor: got %q want %q", got.ID, a.ID)
	}
}
