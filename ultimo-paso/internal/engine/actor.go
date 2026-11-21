package engine

import (
	"hash/fnv"
	"regexp"
	"strings"
	"sync"
	"time"
)

// bloom is a tiny fixed-size Bloom filter used per actor to remember tokens
// that appeared in earlier *response* bodies. Adaptivity = the share of a
// request's tokens that were previously only seen in responses. Wordlist
// scanners score ~0; an LLM agent that reads a response and reuses a path,
// parameter name or id from it scores high. This is the signal an attacker
// cannot drop without losing its edge.
type bloom struct {
	bits [1024]uint64 // 65536 bits
}

func (b *bloom) idx(tok string, salt uint32) uint {
	h := fnv.New32a()
	h.Write([]byte(tok))
	v := h.Sum32() ^ salt
	return uint(v % 65536)
}

func (b *bloom) add(tok string) {
	for _, salt := range []uint32{0, 0x9e3779b1, 0x85ebca77} {
		i := b.idx(tok, salt)
		b.bits[i/64] |= 1 << (i % 64)
	}
}

func (b *bloom) has(tok string) bool {
	for _, salt := range []uint32{0, 0x9e3779b1, 0x85ebca77} {
		i := b.idx(tok, salt)
		if b.bits[i/64]&(1<<(i%64)) == 0 {
			return false
		}
	}
	return true
}

var tokenRe = regexp.MustCompile(`[A-Za-z0-9_\-./]{4,}`)

func tokenize(s string) []string {
	return tokenRe.FindAllString(s, -1)
}

// Actor is the per-attacker progression state. A few hundred bytes each.
type Actor struct {
	ID        string
	Level     Level
	FirstSeen time.Time
	LastSeen  time.Time
	Requests  int
	Notfounds int // 404s in the sliding window
	windowAt  time.Time

	symbols      []Symbol // recent observation symbols (bounded)
	fingerprints map[string]bool

	respTokens *bloom // tokens seen in responses to this actor
	// scores, recomputed on each request
	Narrowing float64 // 1.0 if a fingerprint preceded an exploit on same stack
	Adaptive  float64 // share of request tokens that came from prior responses

	ConfirmedBy string // "honeytoken", "exploit", "response-evidence"
}

// ActorTable maps actor keys and planted-token lineage to Actor state.
type ActorTable struct {
	mu      sync.Mutex
	actors  map[string]*Actor
	lineage map[string]string // planted token value -> actor ID
	now     func() time.Time
}

// NewActorTable builds an empty table. clock may be nil.
func NewActorTable(clock func() time.Time) *ActorTable {
	if clock == nil {
		clock = time.Now
	}
	return &ActorTable{
		actors:  map[string]*Actor{},
		lineage: map[string]string{},
		now:     clock,
	}
}

// key derives the actor key from stable request identity.
func actorKey(r *Request) string {
	ua := r.UserAgent
	if len(ua) > 40 {
		ua = ua[:40]
	}
	return r.RemoteIP + "|" + ua + "|" + r.Cookie
}

// BindToken records that a planted token value belongs to an actor, so a later
// request carrying it re-links to the same actor even after IP rotation.
func (t *ActorTable) BindToken(token, actorID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.lineage[token] = actorID
}

// resolve finds the actor for a request, following planted-token lineage first.
func (t *ActorTable) resolve(r *Request) *Actor {
	// Lineage: any planted token anywhere in the request re-links the actor.
	blob := r.Path + "?" + r.RawQuery + " " + r.Cookie + " " + string(r.Body)
	for tok, aid := range t.lineage {
		if strings.Contains(blob, tok) {
			if a := t.actors[aid]; a != nil {
				return a
			}
		}
	}
	k := actorKey(r)
	a := t.actors[k]
	if a == nil {
		a = &Actor{ID: k, Level: Normal, FirstSeen: t.now(), fingerprints: map[string]bool{}, respTokens: &bloom{}}
		t.actors[k] = a
	}
	return a
}

// windowReset clears sliding-window counters every 60s.
func (a *Actor) windowReset(now time.Time) {
	if now.Sub(a.windowAt) > 60*time.Second {
		a.windowAt = now
		a.Notfounds = 0
	}
}

// Observe updates actor state from a classified request and returns the level.
// sym/high come from PatternSet.Classify.
func (t *ActorTable) Observe(a *Actor, r *Request, sym Symbol, high bool, name string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now()
	a.LastSeen = now
	a.Requests++
	a.windowReset(now)

	if sym == SymFingerprint {
		a.fingerprints[name] = true
	}
	a.symbols = append(a.symbols, sym)
	if len(a.symbols) > 32 {
		a.symbols = a.symbols[len(a.symbols)-32:]
	}

	// Adaptivity: fraction of request tokens previously seen only in responses.
	toks := tokenize(r.Path + " " + r.RawQuery + " " + string(r.Body))
	if len(toks) > 0 {
		hit := 0
		for _, tk := range toks {
			if a.respTokens.has(tk) {
				hit++
			}
		}
		a.Adaptive = float64(hit) / float64(len(toks))
	}

	// Narrowing: an exploit symbol with a prior fingerprint in the history.
	if sym == SymExploit {
		sawFP := false
		for _, s := range a.symbols {
			if s == SymFingerprint {
				sawFP = true
				break
			}
		}
		if sawFP {
			a.Narrowing = 1.0
		}
	}

	// Promotion rules.
	switch {
	case sym == SymExploit && high:
		if a.Level < Suspect {
			a.Level = Suspect
		}
		// A high-severity exploit shape on its own makes an actor confirmed.
		a.Level = Confirmed
		if a.ConfirmedBy == "" {
			a.ConfirmedBy = "exploit"
		}
	case sym == SymProbe || sym == SymEnumerate:
		if a.Level < Suspect {
			a.Level = Suspect
		}
	}
	if a.Notfounds >= 5 && a.Level < Suspect {
		a.Level = Suspect
	}
}

// NoteNotFound increments the 404 counter in the sliding window.
func (t *ActorTable) NoteNotFound(a *Actor) {
	t.mu.Lock()
	defer t.mu.Unlock()
	a.windowReset(t.now())
	a.Notfounds++
	if a.Notfounds >= 5 && a.Level < Suspect {
		a.Level = Suspect
	}
}

// Confirm forces an actor to confirmed with a reason (honeytoken or response
// evidence). Returns true if this is a new confirmation.
func (t *ActorTable) Confirm(a *Actor, reason string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	was := a.Level
	a.Level = Confirmed
	if a.ConfirmedBy == "" {
		a.ConfirmedBy = reason
	}
	return was != Confirmed
}

// RecordResponseTokens feeds response-body tokens into the actor's Bloom filter
// so future requests can be scored for adaptivity.
func (t *ActorTable) RecordResponseTokens(a *Actor, body []byte) {
	if a == nil || len(body) == 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, tk := range tokenize(string(body)) {
		a.respTokens.add(tk)
	}
}

// Get returns the actor for a request, creating it if needed.
func (t *ActorTable) Get(r *Request) *Actor {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.resolve(r)
}

// Clear removes all actor state and token lineage in place.
func (t *ActorTable) Clear() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.actors = map[string]*Actor{}
	t.lineage = map[string]string{}
}
