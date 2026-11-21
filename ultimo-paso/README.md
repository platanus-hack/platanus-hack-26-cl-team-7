# Último Paso — starve attacking agents of their feedback loop

Último Paso studies how an agent uses a service’s HTTP responses to decide
what to do next. A self-hosted proxy inspects the request and response together.
When the response carries evidence of exploitation, the proxy can withhold it,
return a plausible error, and apply an expiring containment rule to later
requests from the same actor on that route. Independent checks record what
reached the client and what already happened on the backend.

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

The engine records two candidate measures of attack progression.

- **Narrowing** records whether an exploit-shaped request followed an earlier
  fingerprint request in the actor’s recent history.
- **Adaptivity** measures the fraction of request tokens found in a Bloom filter
  populated from earlier response bodies. A legitimate client following a link
  can also score highly. The saved trials do not establish how well this signal
  distinguishes client populations.

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

Protected traffic passed through Envoy and the ext_proc engine. The HTML report
(`scoreboard/report.html`) shows Wilson 95% intervals for attack-run rates.

| Saved trials | Evidence reached client, direct → protected | Backend executed, direct → protected |
|---|---:|---:|
| Mock bank, scripted | 5/5 → 0/5 | 5/5 → 5/5 |
| Langflow in-band, scripted | 3/3 → 0/3 | 3/3 → 3/3 |
| Langflow blind control | Absent by design | 3/3 → 3/3 |
| Mock bank, DeepSeek agent | 2/2 → 0/2 | 2/2 → 2/2 |

The proxy blocked 0 of 34 benign requests across the two in-band targets.
Across two DeepSeek runs per arm, requests increased from 74 to 80 and
completion tokens increased from 9,514 to 26,155. Both response replacement and containment were active. With two trials per arm,
these totals describe the observed sessions. The independent effect of removing
success feedback remains an open question.

Regenerate the report from the saved results by running
`python3 -m scoreboard.report` from `ultimo-paso/`.

## Review the study

From `ultimo-paso/`, run `python3 -m scoreboard.report` and open
`scoreboard/report.html`. The [four-minute walkthrough](deploy/DEMO.md) uses
the recorded trials and runs offline. Run `go test ./...` to check the engine.

The scoreboard reads the consolidated snapshot in `scoreboard/results/`.
Its per-request records retain status, evidence flags, and byte counts where
available. Each new evaluation writes to a fresh directory in
`scoreboard/runs/` by default. To inspect another evaluation, pass its
directory to `scoreboard.report --results` and choose an HTML path with `--out`.

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
