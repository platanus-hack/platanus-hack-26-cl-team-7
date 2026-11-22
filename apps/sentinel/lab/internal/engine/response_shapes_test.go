package engine

import (
	"strings"
	"testing"
)

// Reaper recognises the proof of an attack with NO canary planted: the shape of
// the leaked data is enough. One sample per class; none of these values is known
// to the scanner in advance. Every value is a made-up example, assembled in
// pieces so secret scanners do not mistake this file for a leak.
func TestEvidenceWithoutCanary(t *testing.T) {
	cases := map[string]string{
		"cmd-id":        "uid=33(www-data) gid=33(www-data) groups=33(www-data)",
		"etc-passwd":    "root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:",
		"pem-key":       "-----BEGIN RSA PRIVATE KEY-----\nMIIEow",
		"aws-akid":      `{"key":"` + "AKIA" + strings.Repeat("EXAMPLE0", 2) + `"}`,
		"jwt":           `{"token":"` + strings.Join([]string{"eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiJlamVtcGxvIn0", "firma-de-ejemplo"}, ".") + `"}`,
		"password-hash": `{"user":"ana","hash":"` + "$2b$" + "12$" + strings.Repeat("ejemplo.", 6) + "ejemp" + `"}`,
		"db-url":        "DATABASE=postgres://" + "app:" + "clave-de-ejemplo" + "@db.internal:5432/payroll",
		"dotenv-secret": "PORT=8080\nJWT_" + "SECRET=" + "valor-de-ejemplo\nDEBUG=false",
		"vendor-key":    "token: " + "ghp_" + strings.Repeat("ejemplo0", 4) + "abcd",
		"sql-error":     "sqlite3.OperationalError: near \"OR\": syntax error",
		"stack-trace":   "Traceback (most recent call last):\n  File \"/srv/app/auth.py\", line 53",
	}
	s := DefaultScanner() // no AddCanary: nothing is known in advance
	for name, body := range cases {
		ev, canary := s.Scan("/x", &Response{Status: 200, Body: []byte(body), ContentType: "text/plain"})
		if canary {
			t.Errorf("%s: canary hit with no canary planted", name)
		}
		if !hasPrefix(ev, "sig:"+name+":") {
			t.Errorf("%s: not recognised, evidence=%v", name, ev)
		}
	}
}

// Ordinary responses carry none of those shapes.
func TestOrdinaryResponsesAreClean(t *testing.T) {
	clean := []string{
		`{"service":"Liquidación de sueldo","status":"ready","reference":"BP-425"}`,
		`<!doctype html><html><head><title>Tienda</title></head><body><h1>Jugo de manzana</h1><p>$1.990 CLP</p></body></html>`,
		`{"items":[{"id":1,"name":"Apple Juice","price_cents":199}],"total":1}`,
		`{"error":"not_found","message":"El producto no existe."}`,
		"Usuario o contraseña incorrectos. Intenta de nuevo.",
		`{"user":{"name":"Camila Rojas","email":"camila@example.com","days":30}}`,
	}
	s := DefaultScanner()
	for _, body := range clean {
		if ev, _ := s.Scan("/x", &Response{Status: 200, Body: []byte(body), ContentType: "application/json"}); len(ev) > 0 {
			t.Errorf("clean response flagged %v: %s", ev, body)
		}
	}
}

// End to end, with no canary: a confirmed attacker does not receive the dump,
// and a normal visitor who happens to get the same bytes is not blocked.
func TestShapeEvidenceNeedsSuspicion(t *testing.T) {
	dump := &Response{Status: 200, Body: []byte("JWT_" + "SECRET=" + "valor-de-ejemplo\nDB_" + "PASSWORD=" + "otro-valor-de-ejemplo"), ContentType: "text/plain"}

	e, _, _ := newTestEngine(t)
	attack := req("GET", "/@fs/app/.env", "raw??")
	if rd := e.OnResponse(attack, dump, e.OnRequest(attack)); rd.Action != RespReplace {
		t.Fatalf("attacker: got %v, want the dump withheld (evidence %v)", rd.Action, rd.Evidence)
	}

	e2, _, _ := newTestEngine(t)
	visitor := req("GET", "/docs/setup", "")
	if rd := e2.OnResponse(visitor, dump, e2.OnRequest(visitor)); rd.Action != RespPass {
		t.Fatalf("visitor: got %v, want pass (log only)", rd.Action)
	}
}

func hasPrefix(ev []string, prefix string) bool {
	for _, e := range ev {
		if len(e) >= len(prefix) && e[:len(prefix)] == prefix {
			return true
		}
	}
	return false
}
