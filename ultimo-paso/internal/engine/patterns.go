package engine

import (
	"regexp"
	"strings"
)

// Request is the front-end-agnostic view of an HTTP request the engine needs.
// Both the ext_proc and reverse-proxy front ends fill this in.
type Request struct {
	Method    string
	Path      string // path only, no query
	RawQuery  string
	Headers   map[string]string // lower-cased keys
	Body      []byte            // may be empty if not buffered
	RemoteIP  string
	UserAgent string
	Cookie    string // value of a session cookie if present
	// Route is the matched route template (e.g. /accounts/{id}); falls back to
	// Path when no template matches. Used for per-endpoint baselines and rules.
	Route string
}

// Response is the front-end-agnostic view of an upstream response.
type Response struct {
	Status      int
	Headers     map[string]string // lower-cased keys
	Body        []byte            // decoded (identity) body, size-capped
	ContentType string
	Truncated   bool // true when Body was cut at the inspection cap
}

// reqPattern binds an RE2 regexp to the observation symbol it implies. All
// patterns are Go regexp (RE2): linear time, no catastrophic backtracking,
// which was the cause of Cloudflare's 2019 WAF outage.
type reqPattern struct {
	name    string
	re      *regexp.Regexp
	symbol  Symbol
	highSev bool // matches a known exploit shape on a high-risk route
}

// PatternSet classifies a request into one observation symbol. The first
// matching high-severity exploit pattern wins; otherwise the strongest symbol
// seen wins (exploit > probe > fingerprint > enumerate > browse).
type PatternSet struct {
	patterns []reqPattern
	// fingerprintPaths are exact/prefix paths that reveal a stack or version.
	fingerprintPaths []string
}

// DefaultPatterns returns a starter rule database covering the injection
// grammar and the specific CVE shapes in the testbed. These are class-based,
// not one-off: they fire in the window before any CVE-specific rule exists,
// which is where 23-29% of KEVs are already exploited.
func DefaultPatterns() *PatternSet {
	p := func(name, expr string, sym Symbol, high bool) reqPattern {
		return reqPattern{name: name, re: regexp.MustCompile("(?i)" + expr), symbol: sym, highSev: high}
	}
	return &PatternSet{
		patterns: []reqPattern{
			// Generic injection grammar (probe-level).
			p("sqli", `('|%27)(\s|\+)*(or|and)(\s|\+)+['"0-9]|union(\s|\+)+select|sleep\(\d`, SymProbe, false),
			p("xss", `<script|onerror\s*=|javascript:`, SymProbe, false),
			p("cmd-injection", `(;|\||&&|\x60|\$\()\s*(id|whoami|uname|cat\s+/etc|curl|wget|nc\s)`, SymProbe, false),
			p("tmpl-injection", `\{\{.*(\*|7\*7|config|self).*\}\}|\$\{.*\}`, SymProbe, false),
			// Path traversal / arbitrary file read (exploit-level on any route).
			p("path-traversal", `(\.\.(/|\\|%2f|%5c)){1,}|/etc/passwd|/proc/self/environ`, SymExploit, true),
			// Vite CVE-2025-30208: @fs arbitrary file read via ?raw?? / ?import&raw??
			p("vite-fs-raw", `/@fs/.*\?(raw|import&raw)\?\?`, SymExploit, true),
			// Next.js CVE-2025-29927: middleware auth bypass header.
			p("nextjs-mw-bypass", `x-middleware-subrequest`, SymExploit, true),
			// React2Shell CVE-2025-55182: RSC/Flight action deserialization marker.
			p("react2shell", `next-action[=:]|__flight__|__next_action__|react\.fragment.*__proto__`, SymExploit, true),
			// CraftCMS CVE-2025-32432: generate-transform RCE entrypoint.
			p("craftcms-transform", `/index\.php\?p=admin/actions/assets/generate-transform|__class__.*php`, SymExploit, true),
			// SSRF to cloud metadata.
			p("ssrf-metadata", `(169\.254\.169\.254|metadata\.google|/latest/meta-data)`, SymExploit, true),
			// Code-execution payloads in a request body (JSON-RPC / eval sinks):
			// Langflow CVE-2026-33017, pgAdmin eval, SSTI-to-RCE, pickle, etc.
			p("code-injection", `__import__\(|os\.popen|subprocess\.(popen|run|call|check_output)|\bexec\(|\beval\(|pickle\.loads|popen\(`, SymExploit, true),
		},
		fingerprintPaths: []string{
			"/.git", "/.env", "/package.json", "/composer.json", "/wp-login",
			"/actuator", "/server-status", "/phpinfo", "/.well-known/security.txt",
			"/api/v1/version", "/version", "/robots.txt",
		},
	}
}

// Classify returns the observation symbol for a request and whether it is a
// high-severity exploit shape. It scans method, path, query and body.
func (ps *PatternSet) Classify(r *Request) (Symbol, bool, string) {
	hay := r.Method + " " + r.Path + "?" + r.RawQuery + "\n" + string(r.Body)
	// Headers can carry the exploit (e.g. React2Shell, Next.js bypass).
	for k, v := range r.Headers {
		hay += "\n" + k + ": " + v
	}
	best := SymBrowse
	high := false
	name := ""
	for i := range ps.patterns {
		pt := &ps.patterns[i]
		if pt.re.MatchString(hay) {
			if pt.symbol > best {
				best, name = pt.symbol, pt.name
			}
			if pt.highSev {
				high = true
			}
		}
	}
	if best >= SymProbe {
		return best, high, name
	}
	// Fingerprint paths (only if no stronger signal).
	lp := strings.ToLower(r.Path)
	for _, fp := range ps.fingerprintPaths {
		if strings.HasPrefix(lp, fp) {
			return SymFingerprint, false, "fingerprint:" + fp
		}
	}
	return SymBrowse, false, ""
}
