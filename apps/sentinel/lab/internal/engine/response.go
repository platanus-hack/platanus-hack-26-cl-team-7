package engine

import (
	"regexp"
	"strings"
	"sync"
)

// Canary is a planted secret that must never legitimately leave the app. A
// canary match in a response is proof of compromise on its own, regardless of
// request-side suspicion.
type Canary struct {
	Name  string
	Value string // exact string to look for in responses
}

// outputSig is an exploit-output signature: command output or file content that
// only appears when code/file-read ran. Lower precision than a canary, so it
// must coincide with request-side suspicion before it blocks.
type outputSig struct {
	name string
	re   *regexp.Regexp
}

// ResponseScanner inspects a response for evidence of exploitation.
type ResponseScanner struct {
	mu       sync.RWMutex
	canaries []Canary
	sigs     []outputSig
	// baseline per route: content types and a rough max size seen on benign
	// traffic. A response that violates the baseline is weak evidence.
	baseline map[string]*routeBaseline
}

type routeBaseline struct {
	seenTypes map[string]bool
	maxSize   int
}

// DefaultScanner returns a scanner seeded with class-based exploit-output
// signatures. Canaries are added per deployment via AddCanary.
func DefaultScanner() *ResponseScanner {
	sig := func(name, expr string) outputSig {
		return outputSig{name: name, re: regexp.MustCompile(expr)}
	}
	return &ResponseScanner{
		baseline: map[string]*routeBaseline{},
		sigs: []outputSig{
			// Unix id/whoami output.
			sig("cmd-id", `uid=\d+\([a-z0-9_-]+\)\s+gid=\d+`),
			// /etc/passwd contents.
			sig("etc-passwd", `root:.*:0:0:`),
			// Private key material.
			sig("pem-key", `-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----`),
			// AWS access key id shape.
			sig("aws-akid", `AKIA[0-9A-Z]{16}`),
			// Windows directory listing / cmd output.
			sig("win-dir", `Directory of [A-Z]:\\`),
			// PHP/Java stack traces that leak source or paths.
			sig("php-warning", `(Fatal error|Warning):.*in\s+/.*\.php on line \d+`),
		},
	}
}

// AddCanary registers a planted secret.
func (s *ResponseScanner) AddCanary(name, value string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.canaries = append(s.canaries, Canary{Name: name, Value: value})
}

// Learn records a benign response into the per-route baseline.
func (s *ResponseScanner) Learn(route, contentType string, size int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b := s.baseline[route]
	if b == nil {
		b = &routeBaseline{seenTypes: map[string]bool{}}
		s.baseline[route] = b
	}
	if contentType != "" {
		b.seenTypes[contentType] = true
	}
	if size > b.maxSize {
		b.maxSize = size
	}
}

// Scan inspects response headers and body for evidence. It returns the list of
// evidence kinds found and whether any of them is a canary (always-block).
func (s *ResponseScanner) Scan(route string, resp *Response) (evidence []string, canaryHit bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Build the haystack: headers plus body. React2Shell returns command output
	// in the x-action-redirect *header*, so headers must be scanned too.
	var hb strings.Builder
	for k, v := range resp.Headers {
		hb.WriteString(k)
		hb.WriteString(": ")
		hb.WriteString(v)
		hb.WriteByte('\n')
	}
	headerHay := hb.String()
	bodyHay := string(resp.Body)
	full := headerHay + bodyHay

	// Canaries: highest precision, block on their own.
	for _, c := range s.canaries {
		if c.Value != "" && strings.Contains(full, c.Value) {
			evidence = append(evidence, "canary:"+c.Name)
			canaryHit = true
		}
	}
	// Output signatures.
	for _, sg := range s.sigs {
		if sg.re.MatchString(full) {
			loc := "body"
			if sg.re.MatchString(headerHay) {
				loc = "header"
			}
			evidence = append(evidence, "sig:"+sg.name+":"+loc)
		}
	}
	// Per-route baseline violation (weak evidence).
	if b := s.baseline[route]; b != nil {
		if resp.ContentType != "" && len(b.seenTypes) > 0 && !b.seenTypes[resp.ContentType] {
			evidence = append(evidence, "baseline:content-type")
		}
	}
	return evidence, canaryHit
}
