# Último Paso — starve attacking agents of their feedback loop

A real-time defense layer that lives in the proxy every public service already
has. It does **not** try to block the exploit (by the time a response is
evidential, the code already ran on the backend). It denies the attacker the one
thing an autonomous agent needs to make progress: **the response that tells it
the attempt worked.** It confirms the exploit, withholds or fabricates the
evidential response, links the attacker's later requests back to it, and turns
one confirmed transaction into a narrow, expiring containment rule in
milliseconds.

This is the buildable core of the thesis in
[`../reports/AI agent defense at the proxy.md`](../reports/AI%20agent%20defense%20at%20the%20proxy.md).

## Why this and not a WAF

An LLM attacker's edge is that it **reads responses and adapts**, and every
adaptation leaves a trail through the proxy. Cloudflare shipped response-side
exploit blocking in 2026 — but only on its own edge. No open-source building
block gives a **self-hosted** proxy (Envoy/Istio, Caddy, nginx) four things at
once:

1. per-actor attack-progression state,
2. clean withholding of responses that carry exploit evidence, correlated with
   the request so it is safe,
3. active traps only an automated agent trips, and
4. an automatic, TTL-scoped containment rule built from the observed transaction.

The honest framing: **feedback denial + exploit confirmation + containment**, not
exploit prevention. For blind RCE the real last step is on the host (runtime /
egress-deny); we show that ceiling instead of hiding it.

## Architecture

```
client ─► Envoy ──[ext_proc gRPC, BUFFERED]──► engine ──► pass | tag | trap | divert | block
             │        L0 O(1): TTL containment rules, verified agents
             │        L1 RE2 patterns: injection grammar, CVE paths, code-exec payloads → observation symbol
             │        L2 per-actor: normal→suspect→confirmed, 404-burst, narrowing, response-token adaptivity, token lineage
             ▼
        upstream app
             │
             └─[resp headers+body, identity-encoded]──► response scan:
                 canaries (always block) · output signatures · header scan · per-endpoint baseline
                 → block iff (request-side suspicion ∧ response evidence)  [RFDoS-safe; canaries exempt]
                            │ async, off the hot path
                            ▼
              containment: TTL Divert rule (<100ms) + webhook · research: OSV → draft rule → validate → shadow
```

- **Primary data plane:** Envoy + a Go **ext_proc** service (`internal/extproc`),
  response body in `BUFFERED` mode so the engine can withhold cleanly. Drops into
  an Istio sidecar.
- **Fallback data plane:** a Go reverse proxy (`internal/revproxy`) running the
  **same** engine package — the thing nginx body filters cannot do once headers
  are flushed.
- **Engine** (`internal/engine`) is front-end-agnostic and unit-tested.
- **Containment** (`internal/containment`) writes the narrow TTL rule + alert.
- **Research** (`internal/research`) is the L3 loop: identify component → OSV
  lookup → draft a route-scoped rule → validate (blocks the exploit + mutations,
  silent on a benign corpus) → emit in **shadow**. It only ever proposes.

Two signals go beyond scan-counting and are what an agent cannot drop without
losing its edge:
- **narrowing** — a fingerprint request followed by a CVE-specific exploit on the
  same stack;
- **adaptivity** — the share of a request's tokens that appeared only in earlier
  *response* bodies (a per-actor Bloom filter). Wordlist scanners score ~0; an
  agent that reads a response and reuses a path/id from it scores high. No paper
  has measured this at the HTTP layer — measuring it is this project's contribution.

## Testbed

| Target | What it is | Where success shows | Why it's in the set |
|---|---|---|---|
| `mock-bank` | our own vulnerable banking API (seeded CWE-22 file read, planted canaries) | response body | owned, deterministic, safe demo target |
| `langflow-rce` | **real CVE-2026-33017**, unauth RCE | command output on a **second (polling) request** | proves cross-request correlation on a public CVE |
| `langflow-blind` | same RCE, blind payload (touch only, no echo) | nothing in any response | the honest ceiling: the proxy can't help; runtime controls must |

Every run is scored by **two oracles**: a *response oracle* (did canary bytes or
command output reach the attacker) and a *state oracle* (did the backend actually
execute — a marker file checked via `docker exec`, or mock-bank's state log). That
separates *evidence withheld* from *compromise prevented*.

Attacker profiles: **scripted** (deterministic PoC, the headline), **LLM agent**
(a real model via OpenRouter with one HTTP tool, given only the URL and CVE id),
**benign** (the false-positive corpus).

## Results

Protected = traffic through Envoy + ext_proc. Wilson 95% intervals in the HTML
report (`scoreboard/report.html`, generated — not committed).

<!-- RESULTS -->

Headline: on both in-band targets the attacker's evidence drops to **0** while the
backend still executes (feedback denied, not prevented), with **0 benign false
positives**. Against the real DeepSeek agent, withholding feedback made it burn
several times more requests and tokens and still recover nothing. The blind
control shows protected == unprotected: the response layer cannot stop blind RCE.

## Run it

Inside the Lima VM (`espejismo`), from `ultimo-paso/`:

```bash
# bring up langflow once
( cd targets/vulhub/langflow && docker compose up -d )

# engine + mock-bank + two Envoys (mock-bank:8080, langflow:8081, admin:9003)
bash deploy/stack.sh up

# score it
python3 -m scoreboard.run --targets mock-bank  --profiles scripted,benign,llm \
    --unprotected http://127.0.0.1:9001 --protected http://127.0.0.1:8080 --reset-url http://127.0.0.1:9003/reset
python3 -m scoreboard.run --targets langflow-rce,langflow-blind --profiles scripted,benign \
    --unprotected http://127.0.0.1:7860 --protected http://127.0.0.1:8081 --reset-url http://127.0.0.1:9003/reset
python3 -m scoreboard.report      # writes scoreboard/report.html

bash deploy/stack.sh down
```

Go tests: `go test ./...`. The LLM arm needs `OPENROUTER_API_KEY` in the repo
`.env`.

## Limits (stated up front)

- **Demand-side evidence is thin.** Palisade's honeypot logged 3 confirmed AI
  agents in ~24M interactions. This defends a real capability, not yet a flood.
- **Awareness is cheap.** A prompt alone raised LLM honeypot identification from
  19% to 97% in one study. The durable signals are the ones an agent can't drop
  (adaptivity, narrowing, decoys coupled to real functionality).
- **Blind RCE is out of reach** for any response layer — shown by the control.
- This is a single-node POC: no fleet rule sync, no JA4, no automatic source
  patching (research only ever proposes).
- `ext_proc` adds latency (buffered response inspection); report it honestly.

## Layout

```
cmd/engine            # ext_proc server (primary) | -mode=revproxy (fallback) + admin
internal/engine       # the detection core (symbols, patterns, rules, actor, response)
internal/extproc      # Envoy ext_proc gRPC front end
internal/revproxy     # Go reverse-proxy front end (same engine)
internal/containment  # TTL rule + alert on confirmed evidence
internal/research     # L3: OSV lookup, rule draft, validation, shadow
deploy/               # envoy template + stack.sh
targets/mock-bank     # owned vulnerable app
targets/vulhub/       # real-CVE compose (langflow)
attackers/            # scripted, llm_agent, benign, per-CVE drivers
scoreboard/           # runner + HTML report
```
