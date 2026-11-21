package engine

import (
	"sync"
	"time"
)

// Stage is the rollout stage of a containment rule.
type Stage int

const (
	// Shadow logs what the rule would have done but does not act.
	Shadow Stage = iota
	// Enforce acts on matches.
	Enforce
)

func (s Stage) String() string {
	if s == Enforce {
		return "enforce"
	}
	return "shadow"
}

// Rule is a narrow, time-limited containment rule (L0). It is generated from an
// exact observed transaction: a specific actor, route and optionally parameter.
// TTL is enforced at lookup time so a failed delete can never leave a rule
// alive past its window.
type Rule struct {
	ID        string
	ActorID   string    // "" means any actor
	Route     string    // "" means any route
	Param     string    // "" means any parameter (reserved for future use)
	Action    Action    // Block or Divert
	Origin    string    // "containment", "research", "manual"
	Stage     Stage
	CreatedAt time.Time
	ExpiresAt time.Time // zero means no expiry
}

func (r *Rule) active(now time.Time) bool {
	return r.ExpiresAt.IsZero() || now.Before(r.ExpiresAt)
}

func (r *Rule) matches(actorID, route string) bool {
	if r.ActorID != "" && r.ActorID != actorID {
		return false
	}
	if r.Route != "" && r.Route != route {
		return false
	}
	return true
}

// RuleStore holds containment rules. It is safe for concurrent use.
type RuleStore struct {
	mu    sync.RWMutex
	rules []*Rule
	now   func() time.Time
}

// NewRuleStore builds an empty store. clock may be nil (defaults to time.Now).
func NewRuleStore(clock func() time.Time) *RuleStore {
	if clock == nil {
		clock = time.Now
	}
	return &RuleStore{now: clock}
}

// Add inserts a rule.
func (s *RuleStore) Add(r *Rule) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.CreatedAt.IsZero() {
		r.CreatedAt = s.now()
	}
	s.rules = append(s.rules, r)
}

// Match returns the first active, enforcing rule for (actorID, route), or nil.
// Shadow rules are returned via MatchShadow for logging only.
func (s *RuleStore) Match(actorID, route string) *Rule {
	now := s.now()
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, r := range s.rules {
		if r.Stage == Enforce && r.active(now) && r.matches(actorID, route) {
			return r
		}
	}
	return nil
}

// MatchShadow returns the first active shadow rule for (actorID, route), or nil.
func (s *RuleStore) MatchShadow(actorID, route string) *Rule {
	now := s.now()
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, r := range s.rules {
		if r.Stage == Shadow && r.active(now) && r.matches(actorID, route) {
			return r
		}
	}
	return nil
}

// Promote moves a shadow rule to enforce.
func (s *RuleStore) Promote(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.rules {
		if r.ID == id {
			r.Stage = Enforce
			return true
		}
	}
	return false
}

// Active returns a snapshot of non-expired rules (for the scoreboard/admin UI).
func (s *RuleStore) Active() []Rule {
	now := s.now()
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Rule, 0, len(s.rules))
	for _, r := range s.rules {
		if r.active(now) {
			out = append(out, *r)
		}
	}
	return out
}
