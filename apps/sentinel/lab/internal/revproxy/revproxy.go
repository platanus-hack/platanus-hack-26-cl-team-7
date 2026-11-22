// Package revproxy is the fallback data plane: a Go reverse proxy that runs the
// same engine the Envoy ext_proc front end runs. It buffers the response so it
// can withhold or replace an evidential body cleanly — the thing nginx body
// filters cannot do once headers are flushed.
package revproxy

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/platanus/ultimo-paso/internal/engine"
)

// bodyCap is the maximum response body buffered for inspection. Larger bodies
// are streamed through and inspected per-chunk by the ext_proc path; here we
// cap and mark truncated.
const bodyCap = 256 * 1024

type ctxKey int

const (
	keyReq ctxKey = iota
	keyDec
)

// Proxy is an http.Handler that applies the engine in front of an upstream.
type Proxy struct {
	eng     *engine.Engine
	rp      *httputil.ReverseProxy
	decoy   *httputil.ReverseProxy // optional, for Divert
	riskRxp []string
}

// New builds a Proxy for the given upstream. decoyURL may be empty.
func New(eng *engine.Engine, upstreamURL, decoyURL string) (*Proxy, error) {
	u, err := url.Parse(upstreamURL)
	if err != nil {
		return nil, err
	}
	p := &Proxy{eng: eng, riskRxp: []string{"/@fs", "/admin", "/api", "/internal"}}
	p.rp = &httputil.ReverseProxy{
		Director:       p.director(u),
		ModifyResponse: p.modifyResponse,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, `{"error":"bad_gateway"}`, http.StatusBadGateway)
		},
	}
	if decoyURL != "" {
		du, err := url.Parse(decoyURL)
		if err != nil {
			return nil, err
		}
		p.decoy = &httputil.ReverseProxy{Director: p.director(du)}
	}
	return p, nil
}

func (p *Proxy) director(u *url.URL) func(*http.Request) {
	return func(req *http.Request) {
		req.URL.Scheme = u.Scheme
		req.URL.Host = u.Host
		req.Host = u.Host
		// Force identity encoding so the CRS 950020 compressed-body blind spot
		// cannot reappear: we must see the real bytes to find evidence.
		req.Header.Set("Accept-Encoding", "identity")
		// Strip Range on risky routes so a byte-range request cannot slice past
		// the response filter.
		if p.risky(req.URL.Path) {
			req.Header.Del("Range")
		}
	}
}

func (p *Proxy) risky(path string) bool {
	for _, pre := range p.riskRxp {
		if strings.HasPrefix(path, pre) {
			return true
		}
	}
	return false
}

// ServeHTTP applies OnRequest, short-circuits block/divert, else proxies.
func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	er := buildRequest(r)
	dec := p.eng.OnRequest(er)

	switch dec.Action {
	case engine.Block:
		status, body := engine.FakeError(er.Route)
		writeJSON(w, status, body)
		return
	case engine.Divert:
		if p.decoy != nil {
			p.decoy.ServeHTTP(w, r)
			return
		}
		status, body := engine.FakeError(er.Route)
		writeJSON(w, status, body)
		return
	}

	ctx := context.WithValue(r.Context(), keyReq, er)
	ctx = context.WithValue(ctx, keyDec, dec)
	p.rp.ServeHTTP(w, r.WithContext(ctx))
}

func (p *Proxy) modifyResponse(resp *http.Response) error {
	er, _ := resp.Request.Context().Value(keyReq).(*engine.Request)
	dec, _ := resp.Request.Context().Value(keyDec).(engine.RequestDecision)
	if er == nil {
		return nil
	}

	body, truncated := readCapped(resp.Body, bodyCap)
	resp.Body.Close()

	eresp := &engine.Response{
		Status:      resp.StatusCode,
		Headers:     flattenHeaders(resp.Header),
		Body:        body,
		ContentType: resp.Header.Get("Content-Type"),
		Truncated:   truncated,
	}
	sd := p.eng.OnResponse(er, eresp, dec)

	var finalBody []byte
	switch sd.Action {
	case engine.RespReplace:
		finalBody = sd.Body
		resp.StatusCode = sd.Status
		resp.Header = make(http.Header)
		resp.Header.Set("Content-Type", "application/json")
		resp.Trailer = nil
	default:
		// Pass: body may have had a trap injected by the engine.
		finalBody = eresp.Body
	}

	resp.Body = io.NopCloser(bytes.NewReader(finalBody))
	resp.ContentLength = int64(len(finalBody))
	resp.Header.Set("Content-Length", itoa(len(finalBody)))
	resp.Header.Del("Content-Encoding")
	return nil
}

// buildRequest translates an inbound *http.Request into an engine.Request,
// reading and restoring the body so it can still be forwarded.
func buildRequest(r *http.Request) *engine.Request {
	var body []byte
	var truncated bool
	if r.Body != nil {
		body, truncated = readCapped(r.Body, bodyCap)
		r.Body.Close()
		r.Body = io.NopCloser(bytes.NewReader(body))
	}
	cookie := ""
	if c, err := r.Cookie("session"); err == nil {
		cookie = c.Value
	}
	return &engine.Request{
		RawTarget:      r.RequestURI,
		BodyIncomplete: truncated,
		FixtureID:      r.Header.Get("X-Up-Fixture-Id"),
		Method:         r.Method,
		Path:           r.URL.Path,
		RawQuery:       r.URL.RawQuery,
		Headers:        flattenHeaders(r.Header),
		Body:           body,
		RemoteIP:       clientIP(r),
		UserAgent:      r.UserAgent(),
		Cookie:         cookie,
		Route:          r.URL.Path,
	}
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i >= 0 {
		host = host[:i]
	}
	return host
}

func flattenHeaders(h http.Header) map[string]string {
	m := make(map[string]string, len(h))
	for k, v := range h {
		m[strings.ToLower(k)] = strings.Join(v, ",")
	}
	return m
}

func readCapped(r io.Reader, cap int) ([]byte, bool) {
	buf, err := io.ReadAll(io.LimitReader(r, int64(cap)+1))
	if len(buf) > cap {
		return buf[:cap], true
	}
	return buf, err != nil
}

func writeJSON(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
