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
			// Classes below need no prior knowledge of the secret: they match the
			// SHAPE of data that only leaves an app when something went wrong. Like
			// every signature, they only block alongside request-side suspicion.
			// Session token (JWT) handed out in a response.
			sig("jwt", `\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`),
			// Password hashes (bcrypt, argon2): a user table leaked.
			sig("password-hash", `\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}|\$argon2(id|i|d)\$v=\d+\$`),
			// Database / broker URL with inline credentials.
			sig("db-url", `(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqps?)://[^\s:/@"']+:[^\s@"']+@`),
			// A dumped .env or config: UPPER_CASE secret assignments.
			sig("dotenv-secret", `(?m)^[A-Z][A-Z0-9_]*(SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*\S{6,}`),
			// Vendor API key shapes (OpenAI/Anthropic-style, GitHub, Slack, Google).
			sig("vendor-key", `\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})`),
			// SQL engine errors: the injection reached the database.
			sig("sql-error", `You have an error in your SQL syntax|sqlite3\.OperationalError|SQLITE_ERROR|ORA-\d{5}|PG::SyntaxError|unterminated quoted string|syntax error at or near`),
			// Python / Java stack traces that leak source paths.
			sig("stack-trace", `Traceback \(most recent call last\):|\bat [A-Za-z0-9_.$]+\([A-Za-z0-9_]+\.java:\d+\)`),
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
