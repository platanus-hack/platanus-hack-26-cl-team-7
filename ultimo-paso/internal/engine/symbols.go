// Package engine is the data-plane-agnostic core of the Último Paso
// feedback-denial proxy. It inspects a request, keeps per-actor attack-
// progression state, inspects the paired response for exploit evidence, and
// decides whether to pass, tag, trap, divert or block.
//
// The same engine is driven by two front ends: an Envoy ext_proc gRPC server
// (primary) and a Go reverse proxy (fallback). Neither front end holds any
// detection logic; they only translate HTTP into Request/Response structs and
// apply the returned Decision.
package engine

// Level is where an actor sits on the normal -> suspect -> confirmed ladder.
type Level int

const (
	// Normal is an actor with nothing held against it yet.
	Normal Level = iota
	// Suspect has shown attack grammar or scanning behaviour but nothing has
	// been confirmed. Suspects get traps, never fabricated content.
	Suspect
	// Confirmed has tripped a honeytoken, sent an exploit-shaped request on a
	// high-risk route, or produced response-side evidence. Only confirmed
	// actors are deceived or diverted.
	Confirmed
)

func (l Level) String() string {
	switch l {
	case Suspect:
		return "suspect"
	case Confirmed:
		return "confirmed"
	default:
		return "normal"
	}
}

// Symbol is the observation symbol attached to a single request. It is the
// alphabet the per-actor kill-chain state machine reads.
type Symbol int

const (
	// SymBrowse is ordinary traffic: a known route, benign method, no payload.
	SymBrowse Symbol = iota
	// SymEnumerate is breadth: many distinct routes or a 404 burst.
	SymEnumerate
	// SymFingerprint is a version/stack probe (/.git, /package.json, headers).
	SymFingerprint
	// SymProbe is attack grammar that is not yet a known exploit shape.
	SymProbe
	// SymExploit is a request that matches a known exploit path/payload.
	SymExploit
	// SymConfirm is a request carrying a planted trap/canary token back to us.
	SymConfirm
)

func (s Symbol) String() string {
	switch s {
	case SymEnumerate:
		return "enumerate"
	case SymFingerprint:
		return "fingerprint"
	case SymProbe:
		return "probe"
	case SymExploit:
		return "exploit"
	case SymConfirm:
		return "confirm"
	default:
		return "browse"
	}
}

// Action is what the front end should do with a request or response.
type Action int

const (
	// Pass forwards unchanged.
	Pass Action = iota
	// Tag forwards but records the actor as worth watching (observation only).
	Tag
	// Trap forwards but injects a honeytoken/sentinel link into the response
	// so an attacker reveals intent. Applied to suspects.
	Trap
	// Divert sends a confirmed actor to the decoy upstream instead of the real
	// app, or returns fabricated content. Confirmed actors only.
	Divert
	// Block replaces the response with a 403 or a believable fake error and
	// withholds the evidential body.
	Block
)

func (a Action) String() string {
	switch a {
	case Tag:
		return "tag"
	case Trap:
		return "trap"
	case Divert:
		return "divert"
	case Block:
		return "block"
	default:
		return "pass"
	}
}

// RequestDecision is returned from Engine.OnRequest.
type RequestDecision struct {
	Action  Action
	Symbol  Symbol
	Level   Level
	ActorID string
	Reason  string
	// RuleID is set when a standing containment rule (L0) drove the decision.
	RuleID string
}

// RespAction is the narrower set of things that can be done to a response.
type RespAction int

const (
	// RespPass sends the real response.
	RespPass RespAction = iota
	// RespReplace swaps the whole response for a 403 or fake error. This is the
	// feedback-denial action: the body never reaches the attacker.
	RespReplace
	// RespTruncate cuts a streaming body at the point evidence appeared.
	RespTruncate
)

func (a RespAction) String() string {
	switch a {
	case RespReplace:
		return "replace"
	case RespTruncate:
		return "truncate"
	default:
		return "pass"
	}
}

// ResponseDecision is returned from Engine.OnResponse.
type ResponseDecision struct {
	Action RespAction
	// Evidence lists the evidence kinds that fired (canary, output-signature,
	// header, baseline). Empty when nothing fired.
	Evidence []string
	Reason   string
	// Status and Body are the replacement response when Action != RespPass.
	Status int
	Body   []byte
	// Contain is true when this response should trigger a containment rule and
	// alert (set whenever real evidence coincides with request-side suspicion).
	Contain bool
	ActorID string
}
