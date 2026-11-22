// Package research is the asynchronous L3 loop. When a transaction is
// confirmed, it: identifies the affected component, looks it up in a
// vulnerability feed (OSV), drafts a narrow route-scoped rule from the observed
// exploit, and validates that rule two ways — it must block the captured
// request plus mutated variants, and stay silent on a benign corpus — before
// emitting it in SHADOW stage. It never auto-enforces and never patches source;
// it only proposes.
//
// In production the replay runs against an ephemeral sandbox of the app at the
// deployed commit, with synthetic data and egress denied. In the POC the
// validation corpus stands in for that sandbox so the loop is deterministic and
// demo-safe; the Drafter interface lets an LLM refine the rule when configured.
package research

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/platanus/ultimo-paso/internal/engine"
)

// Drafter proposes a regular expression that matches the exploit and nothing
// benign. The default is deterministic; an OpenRouter-backed drafter can be
// swapped in.
type Drafter interface {
	Draft(in engine.ContainInput) (routeRegex string, rationale string)
}

// Feed looks up a component in a vulnerability database. OSVFeed hits osv.dev;
// an offline stub returns "" so the loop still runs without egress.
type Feed interface {
	Lookup(component string) (id string, summary string)
}

// Loop is the research loop. It implements containment.Researcher.
type Loop struct {
	rules   *engine.RuleStore
	events  engine.EventSink
	drafter Drafter
	feed    Feed

	mu    sync.Mutex
	seq   int
	Drafts []Draft // kept for the scoreboard
}

// Draft is a proposed rule plus its validation outcome.
type Draft struct {
	TS          time.Time `json:"ts"`
	RuleID      string    `json:"rule_id"`
	Route       string    `json:"route"`
	Regex       string    `json:"regex"`
	Rationale   string    `json:"rationale"`
	VulnID      string    `json:"vuln_id,omitempty"`
	BlockedMut  int       `json:"blocked_mutations"`
	TotalMut    int       `json:"total_mutations"`
	BenignFalse int       `json:"benign_false_positives"`
	Valid       bool      `json:"valid"`
}

// New builds a Loop with the deterministic drafter and offline feed. Callers may
// override Drafter/Feed.
func New(rules *engine.RuleStore, events engine.EventSink) *Loop {
	return &Loop{rules: rules, events: events, drafter: deterministicDrafter{}, feed: offlineFeed{}}
}

// WithDrafter overrides the rule drafter (e.g. an LLM).
func (l *Loop) WithDrafter(d Drafter) *Loop { l.drafter = d; return l }

// WithFeed overrides the vulnerability feed.
func (l *Loop) WithFeed(f Feed) *Loop { l.feed = f; return l }

// Investigate runs the loop for one confirmed transaction.
func (l *Loop) Investigate(in engine.ContainInput) {
	l.mu.Lock()
	l.seq++
	id := fmt.Sprintf("research-%d", l.seq)
	l.mu.Unlock()

	component := identifyComponent(in)
	vulnID, summary := l.feed.Lookup(component)

	regexStr, rationale := l.drafter.Draft(in)
	re, err := regexp.Compile("(?i)" + regexStr)
	if err != nil {
		l.emit("research", id, in.Route, "rule draft failed to compile: "+err.Error())
		return
	}

	// Validate: the rule must match the exploit and mutated variants, and must
	// NOT match a benign corpus for the same route.
	muts := mutate(in.Request)
	blocked := 0
	for _, m := range muts {
		if re.MatchString(signature(m)) {
			blocked++
		}
	}
	benign := benignCorpus(in.Route)
	fp := 0
	for _, b := range benign {
		if re.MatchString(signature(b)) {
			fp++
		}
	}
	valid := blocked == len(muts) && fp == 0

	d := Draft{TS: time.Now(), RuleID: id, Route: in.Route, Regex: regexStr, Rationale: rationale,
		VulnID: vulnID, BlockedMut: blocked, TotalMut: len(muts), BenignFalse: fp, Valid: valid}
	l.mu.Lock()
	l.Drafts = append(l.Drafts, d)
	l.mu.Unlock()

	if valid {
		// Emit in SHADOW: proposes, does not enforce.
		l.rules.Add(&engine.Rule{ID: id, Route: in.Route, Action: engine.Block,
			Origin: "research", Stage: engine.Shadow, ExpiresAt: time.Now().Add(24 * time.Hour)})
		l.emit("research", id, in.Route,
			fmt.Sprintf("shadow rule proposed (vuln=%s %s): blocks %d/%d mutations, %d benign FPs; %s",
				vulnID, summary, blocked, len(muts), fp, rationale))
	} else {
		l.emit("research", id, in.Route,
			fmt.Sprintf("rule rejected: blocks %d/%d mutations, %d benign FPs", blocked, len(muts), fp))
	}
}

func (l *Loop) emit(kind, id, route, reason string) {
	l.events.Emit(engine.Event{TS: time.Now(), Kind: kind, Route: route, RuleID: id, Reason: reason})
}

// signature renders a request into the string the rule regex matches against —
// the same shape PatternSet.Classify builds.
func signature(r *engine.Request) string {
	s := r.Method + " " + r.Path + "?" + r.RawQuery + "\n" + string(r.Body)
	for k, v := range r.Headers {
		s += "\n" + k + ": " + v
	}
	return s
}

// mutate produces equivalent exploit variants an attacker might try.
func mutate(r *engine.Request) []*engine.Request {
	if r == nil {
		return nil
	}
	out := []*engine.Request{r}
	// Upper/lower-cased path.
	up := clone(r)
	up.Path = strings.ToUpper(r.Path)
	out = append(out, up)
	// URL-encoded traversal variant.
	enc := clone(r)
	enc.RawQuery = strings.ReplaceAll(r.RawQuery, "../", "%2e%2e/")
	enc.Path = strings.ReplaceAll(r.Path, "../", "%2e%2e/")
	out = append(out, enc)
	// Extra padding in the query.
	pad := clone(r)
	if pad.RawQuery == "" {
		pad.RawQuery = "x=1"
	} else {
		pad.RawQuery += "&x=1"
	}
	out = append(out, pad)
	return out
}

func clone(r *engine.Request) *engine.Request {
	c := *r
	c.Headers = map[string]string{}
	for k, v := range r.Headers {
		c.Headers[k] = v
	}
	return &c
}

// benignCorpus is a small set of legitimate requests for the same route that a
// good rule must not match.
func benignCorpus(route string) []*engine.Request {
	mk := func(path, q string) *engine.Request {
		return &engine.Request{Method: "GET", Path: path, RawQuery: q, Headers: map[string]string{}}
	}
	return []*engine.Request{
		mk(route, ""),
		mk(route, "file=logo.txt"),
		mk(route, "file=statement-2026.pdf"),
		mk("/", ""),
		mk("/accounts/42", ""),
	}
}

func identifyComponent(in engine.ContainInput) string {
	if in.Response != nil {
		if s := in.Response.Headers["server"]; s != "" {
			return s
		}
		if s := in.Response.Headers["x-powered-by"]; s != "" {
			return s
		}
	}
	// Fall back to the first path segment.
	if in.Request != nil {
		seg := strings.SplitN(strings.TrimPrefix(in.Request.Path, "/"), "/", 2)
		if len(seg) > 0 && seg[0] != "" {
			return seg[0]
		}
	}
	return "unknown"
}

// deterministicDrafter builds a conservative rule from the observed exploit: it
// anchors on the route and, when present, the traversal/exploit grammar in the
// request, so it is narrow enough to avoid benign traffic.
type deterministicDrafter struct{}

func (deterministicDrafter) Draft(in engine.ContainInput) (string, string) {
	r := in.Request
	if r == nil {
		return `$^`, "no request captured"
	}
	// Prefer a grammar anchor over a bare route so the rule generalises across
	// the actor's later attempts but stays off benign traffic.
	q, _ := url.QueryUnescape(r.RawQuery)
	blob := r.Path + "?" + q + " " + string(r.Body)
	switch {
	case strings.Contains(blob, "..") || strings.Contains(strings.ToLower(blob), "%2e%2e"):
		return `(\.\.(/|\\)|%2e%2e)`, "path-traversal grammar observed in confirmed transaction"
	case strings.Contains(strings.ToLower(blob), "/@fs/"):
		return `/@fs/`, "Vite @fs file-read path observed"
	case hasHeader(r, "next-action"):
		return `next-action`, "React Server Components action header observed"
	default:
		return regexp.QuoteMeta(r.Path), "route-scoped rule from confirmed transaction"
	}
}

func hasHeader(r *engine.Request, key string) bool {
	_, ok := r.Headers[key]
	return ok
}

// offlineFeed returns no match but lets the loop run without egress. OSVFeed
// (osv.dev) can be swapped in when the engine host has egress.
type offlineFeed struct{}

func (offlineFeed) Lookup(component string) (string, string) {
	return "", "offline-feed:no-lookup"
}
