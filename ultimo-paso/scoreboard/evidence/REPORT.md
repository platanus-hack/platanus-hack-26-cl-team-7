# Último Paso proxy defense evaluation

**Status.** The bounded feedback-denial scenario passes on both proxy implementations. The prototype has not been validated as a production security boundary. The first protected request still reaches the upstream. A clean error status alone is insufficient to prove that disclosure stopped.

Run date: 21 November 2026. Original engine: `0668137`. Patched engine: this working tree. Both ran in the same Lima Linux ARM64 VM. The primary path used Envoy 1.36.2 and the real ext_proc gRPC service. The fallback used the Go reverse proxy. [Before traces](defense-before.json) · [After traces and model outputs](defense-after.json) · [Go checks](go-tests.txt)

## Businesses and advisory mapping

The fictional sites have standalone public catalogs, business-specific service records and a visible research disclosure. Headless Chrome rendered all three pages at mobile width and verified the record links and disclosure. Each upstream emits a fixed response for the scenario using ordinary GET requests. The fixture server handles ordinary catalog reads and returns only synthetic data. The vendor comparisons motivate which observable outcome to simulate.

| Business | Service | Vendor advisory | Outcome tested |
|---|---|---|---|
| Bruma Print Works | Exhibition proof collection | Vite CVE-2026-118662 | A synthetic internal document reference appears in the body |
| Litoral Freight | Chilled pallet collection | React Server Components CVE-2025-55182 | A synthetic receipt reference appears in a header, including a separate duplicate-header test |
| Surco Rooms | Rehearsal studio reservation | Next.js CVE-2025-29927 | A normal-looking 200 contains a reservation reference. An unlabelled record provides a negative control |

The Vite advisory describes exposure of file contents. React describes unauthenticated server-side execution, and the existing Último Paso research identifies header evidence as one possible observation. The Next.js postmortem describes an authorization bypass in applications relying on Middleware. The tests use the advisory effects as analogues and do not establish mitigation of those CVEs. [Vite advisory](https://github.com/advisories/GHSA-8g5g-mxqh-grgj) · [React advisory](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components) · [Vercel postmortem](https://vercel.com/blog/postmortem-on-next-js-middleware-bypass)

## Result across both proxy paths

The client checked every header value and the complete response body for a registered fixture reference. The upstream counted actual requests independently of the client. The runner polled the local rules endpoint to confirm that containment was active before sending the repeat request.

| Check | Original engine | Patched engine |
|---|---:|---:|
| Direct positive controls carrying evidence | 6/6 | 6/6 |
| First protected receipts carrying evidence | 2/6 | 0/6 |
| First protected receipts reaching upstream | 6/6 | 6/6 |
| Contained same-actor repeats reaching upstream | 0/6 | 0/6 |
| Same-actor requests to another route returning their public record | 6/6 | 6/6 |
| Different actors reaching the original route once | 6/6 | 6/6 |
| Protected duplicate-header trials carrying evidence | 2/2 | 0/2 |
| Unlabelled synthetic record reaching client | 2/2 | 2/2 |

The original engine leaked Litoral's header on both paths even though both responses had status 500. For the repeated-header variant, the Go fallback detected the evidence and still returned it, while Envoy's adapter only inspected the last header value and returned status 200. The patched fallback drops upstream headers and trailers when replacing the response. The patched Envoy adapter combines repeated values for inspection and instructs Envoy to generate a local response. [Go fallback](../../internal/revproxy/revproxy.go) · [Envoy adapter](../../internal/extproc/extproc.go)

The six patched containment rules were visible in the admin API 0.55–21.91 ms after the corresponding client request began. Those timings include a loopback API read and describe six observations on one VM. They do not estimate production latency percentiles.

## Request detection and controls

Each row was executed on both paths using independent actors and inert data. The traces contain the engine's observed symbol and action alongside the wire outcome.

| Input | Engine action on both paths | Client outcome |
|---|---|---|
| Known middleware header indicator with a fixture value | `exploit` / `tag` | Public record, HTTP 200 |
| Script-shaped or SQL-shaped text in inert catalog headers | `probe` / `trap` | Public JSON record, HTTP 200 |
| Path-traversal-shaped text in an inert catalog header | `exploit` / `tag` | Public JSON record, HTTP 200 |
| Clean catalog request | `browse` / `pass` | Public record, HTTP 200 |
| Ordinary request to a fixed response with fresh, registered synthetic evidence | `browse` at ingress, `replace` on response | Local HTTP 500, first upstream hit still observed |
| Ordinary request to the unlabelled business record | `browse` / `pass` | The reference reaches the client |

The known indicator measures recognition of an existing request signature. The script-, SQL- and path-shaped cases exercise generic grammar independent of CVE-specific request rules. The registered evidence case measures coverage when a request lacks a known indicator. It requires a known sensitive marker on the response side and provides no detection guarantee for arbitrary zero-days. The engine's existing blind Langflow control supplies a separate recorded result for execution without in-band evidence. [Historical blind result](../results/langflow-blind.json)

## OpenRouter customer evaluation

GPT-4o-mini read the public service JSON from the direct endpoint or Envoy and answered a customer asking for the service reference. The six calls used temperature zero and tool-free prompts. Correctness was an exact comparison to the public reference. The model received only public fixture data.

| Arm | Correct references | Prompt tokens | Completion tokens |
|---|---:|---:|---:|
| Direct | 3/3 | 223 | 9 |
| Through Envoy | 3/3 | 223 | 9 |

This measures task completion for legitimate model traffic on a small set of public reads. The historical DeepSeek runs remain a distinct experiment with containment and response replacement enabled together. [Model](https://openrouter.ai/openai/gpt-4o-mini) · [Historical DeepSeek trials](../results/mock-bank.json)

## Remaining validation

- The fixtures cover registered response evidence and representative request observations. A sensitive record with no configured marker or matching signature passed through both paths.
- A tag can identify a known or suspicious-looking request while letting it reach the backend. The host and application still own execution, access control and side effects.
- This suite did not establish coverage for compressed or streaming responses, upgrades, larger bodies, varied transport encodings, actor attribution under shared client identities, or concurrent traffic. A code review also found that the fallback reconstructs oversized bodies from its capped buffer, which can change legitimate traffic. Production readiness remains open.
- The Go race suite was blocked in the VM because cgo had no C compiler available. Standard Go tests, vet, and the two-path HTTP regression suite passed.

## Reproduce the defensive checks

Run from `ultimo-paso/` in the Linux VM with Go, Python and Docker host networking. Add `--openrouter` to rerun the public customer tasks with a configured key.

```sh
go vet ./...
go test -v -count=1 ./...
go build -o /tmp/ultimo-paso-defense ./cmd/engine
python3 -m scoreboard.defense_eval --engine /tmp/ultimo-paso-defense --out /tmp/ultimo-paso-defense.json
```

To view the three catalogs independently, run `python3 -m targets.businesses.service` and open `http://127.0.0.1:9120/`.
