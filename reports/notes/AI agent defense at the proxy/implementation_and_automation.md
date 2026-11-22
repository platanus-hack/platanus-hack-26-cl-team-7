# Implementing an inline defense layer in a reverse proxy, with dynamic containment and automated vulnerability response

Research date: 2026-11-21. Method: primary docs (Envoy, Istio, nginx/njs, OpenResty, Caddy, Coraza, HAProxy, CrowdSec), vendor engineering blogs (Cloudflare, Fastly, Tetrate, Solo.io), GitHub issues/PRs, arXiv. Firecrawl CLI returned HTTP 429 for every call, so WebSearch/WebFetch were used instead. Several facts come from search-result summaries rather than a full read of the page; these are marked "(search summary)". Anything not backed by a source is in Inferences or Gaps.

## 1. Insertion points that can read and withhold response bodies (nginx, Caddy, Envoy/Istio, HAProxy), and their overhead

### Takeaway
Every major proxy can inspect response bodies, but you can only block a response after the backend produced it if the layer buffers the response headers and body before sending anything downstream. Envoy ext_proc (BUFFERED / FULL_DUPLEX_STREAMED), Envoy Wasm, HAProxy `http-response wait-for-body` + SPOE, Coraza with `SecResponseBodyAccess On` and a custom Caddy `ResponseWriter` wrapper can all do this. Streaming body filters (nginx njs `js_body_filter`, OpenResty `body_filter_by_lua`, the ModSecurity-nginx connector's phase 4) run after headers have gone out, so they can only rewrite or truncate the body. They cannot change the status to a clean 403. Expect roughly 1 to 10+ ms added per request for out-of-process or Wasm WAFs running the full CRS, and hundreds of MiB of extra memory for Wasm WAFs. Holding a response body for inspection rules out true streaming.

### Cited Findings

**Envoy ext_proc (out-of-process gRPC)**
- ext_proc lets an external service examine "and modify the headers, body, and trailers of each message, or ... return a brand-new response." It runs over a bidirectional gRPC stream. The processor can pick which request/response events it receives and can change this "on a message-by-message basis." — [Envoy ext_proc filter docs](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_proc_filter)
- Body send modes ([ProcessingMode proto](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/http/ext_proc/v3/processing_mode.proto)):
  - `NONE` is the default.
  - `STREAMED` sends "pieces as they are seen."
  - `BUFFERED` holds the whole body; if it exceeds the buffer limit, "the downstream system will receive an error."
  - `BUFFERED_PARTIAL` sends the body up to the limit.
  - `FULL_DUPLEX_STREAMED` lets the server hold any number of chunks and return any number of chunks. Response chunks are "recommended to be no greater than 64K bytes," trailer mode must be `SEND`, and the server replies with `StreamedBodyResponse`.
  - When the body is mutated, Envoy drops `content-length` unless `allow_content_length_header` is set.
- Failure and timeout semantics ([ext_proc proto](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/http/ext_proc/v3/ext_proc.proto)):
  - `message_timeout` "If not configured, default is 200 milliseconds." No timeout applies in observability mode or with FULL_DUPLEX_STREAMED.
  - Without `failure_mode_allow`, errors or timeouts produce a local reply of 504 (timeout) or 500. With it set to true, processing continues (fail-open). `status_on_error` defaults to 500.
  - `observability_mode` is "Send and Go": it supports only STREAMED/GRPC/NONE, and the processor's responses are ignored. This is a native shadow mode.
  - `deferred_close_timeout` defaults to 5000 ms.
  - Per-route `ExtProcPerRoute` can disable the filter or override its processing mode.
  - `mutation_rules` protect `host`, `:authority`, `:scheme` and `:method` by default.
  - `allow_mode_override` lets the processor escalate from headers-only to body inspection per request. It is not supported with FULL_DUPLEX_STREAMED.
- Observability: the `envoy.filters.http.ext_proc` filter state exposes per-phase gRPC latencies in µs (e.g. `request_header_latency_us`, `response_body_max_latency_us`) for access logs. — [Envoy ext_proc filter docs](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_proc_filter)
- Measured overhead (single vendor test, simple header mutation):
  - ext_proc throughput was 55% lower than a native Envoy filter (3213 vs 7140 rps).
  - Average latency was +122% (15.1 vs 6.8 ms) and p99 +146% (33.5 vs 13.6 ms).
  - Source: [Solo.io blog](https://www.solo.io/blog/solving-an-information-leakage-problem-with-the-envoy-extproc-filter-and-kube-gateway-api) (search summary). The post also covers using ext_proc to stop response-side information leakage, which is the exact "withhold response" use case.
- An old envoy-dev thread estimated about 60 µs of gRPC processing per request in one configuration. It also found that the choice of open- vs closed-loop load generator swung measured p50 between about 2 ms and about 10 ms. — [envoy-dev group](https://groups.google.com/g/envoy-dev/c/55j2PF18K1g) (search summary, about 5 years old)

**Envoy Wasm / Istio WasmPlugin / native modules**
- Istio `WasmPlugin` (`extensions.istio.io/v1alpha1`, docs v1.32) ([Istio WasmPlugin reference](https://istio.io/latest/docs/reference/config/proxy_extensions/wasm-plugin/)):
  - Phases are AUTHN, AUTHZ and STATS. If unset, the plugin goes "right before the Router." Priority orders plugins within a phase.
  - `url` defaults to `oci://`, with optional `sha256` pinning.
  - `failStrategy` is FAIL_CLOSE (default: a fatal error makes all later requests 5xx), FAIL_OPEN ("not recommended" for authn/authz), or FAIL_RELOAD.
  - `targetRefs` attaches the plugin to a Gateway, Service or ServiceEntry.
  - `imagePullPolicy` `Always` re-pulls on any plugin change. The docs do not explicitly state that updates apply without a proxy restart.
- coraza-proxy-wasm benchmarks:
  - An informal figure of about 3 ms overhead for small payloads. — [Envoy Gateway issue #671](https://github.com/envoyproxy/gateway/issues/671) (search summary)
  - A February 2026 user report in the same issue called Wasm "a non-starter." Their numbers: gRPC-Coraza did about 1200 rps per core at about 80 Mi peak memory; the Wasm WAF did about 86 rps per CPU and added about 230 Mi per Gateway. — [Envoy Gateway issue #671](https://github.com/envoyproxy/gateway/issues/671) (search summary)
- Wasm vs native Envoy dynamic module, pinned CRS: startup 3.30 s vs 1.35 s; benign p50 18.0 ms vs 14.1 ms; large-body throughput 5.7 vs 9.9 rps; peak RSS 325/367 MiB vs 123/171 MiB. The PR attributes the Wasm cost to VM startup, per-worker configure, WASI limits and copy-heavy hostcalls, and notes Envoy labels the Wasm HTTP filter experimental. — [coraza-rs PR #145](https://github.com/networking-incubator/coraza-rs/pull/145) (search summary)
- Envoy runs one Wasm VM per worker thread, and each holds the full ruleset. In a lab with 4 workers, attaching a coraza-proxy-wasm 0.6.0 / CRS 4.14 policy grew allocated memory from 6 to 93 MiB and heap from 12 to about 285 MiB. — [h2security guide](https://h2security.io/secure/coraza-waf-owasp-crs-v4-envoy/) (search summary)
- Tetrate compared pure-Go Coraza, TEG WAF and the Coraza Golang Envoy filter (full CRS, header-only traffic) — [Tetrate benchmarks](https://tetrate.io/blog/envoy-waf-performance-benchmarks) (search summary):
  - Throughput was about 3,900 to 4,000 rps, with p99 of 2.5 to 3.6 ms at 1,000 rps.
  - Added p99 over plain Envoy ranged from 0 to 12.39 ms, and peak memory from 36 to 76 MB.
  - Their conclusion: "Your performance budget is spent on the rules."
- With coraza-proxy-wasm, CRS rule 920420 rejected every request carrying a Content-Type, so all POSTs got 403. This shows how ruleset/connector interactions can cause sweeping false positives. — [Dimss/coraza-perf](https://github.com/Dimss/coraza-perf) (search summary)
- In the coraza-rs Envoy test policy, `SecResponseBodyAccess` is left off, which disables CRS response rules 950 to 956. — [coraza-rs issue #127](https://github.com/networking-incubator/coraza-rs/issues/127) (title only)

**nginx njs**
- `js_body_filter` (njs 0.5.2+) ([ngx_http_js_module](https://nginx.org/en/docs/http/ngx_http_js_module.html)):
  - It is called per chunk with `flags.last`. Modified data goes on via `r.sendBuffer()`, and `r.done()` stops filtering.
  - If the body length changes, Content-Length must be cleared in `js_header_filter`.
  - The docs say it "supports only synchronous operations ... r.subrequest() or setTimeout() are not supported," so a filter cannot call out to a classifier mid-response.
  - Since 0.8.5, data is converted to a UTF-8 string by default; binary data needs `buffer_type=buffer`.

**OpenResty Lua**
- `body_filter_by_lua*` ([OpenResty directives](https://openresty-reference.readthedocs.io/en/latest/Directives/)):
  - The chunk arrives in `ngx.arg[1]` and EOF in `ngx.arg[2]`. Setting `ngx.arg[1]` to an empty value suppresses output, which allows "truncated but still valid responses."
  - `return ngx.ERROR` truncates the body into an invalid response.
  - Output, control (`ngx.exit`), subrequest and cosocket APIs are disabled in both header and body filters. There are no network calls (e.g. to Redis) in the body filter.

**ModSecurity v3 (nginx connector)**
- Phase 4 deny frequently fails because headers are already sent. Users see "Headers are already sent. Cannot perform the redirection at this point" while the client still gets a 200. — [ModSecurity-nginx issue #254](https://github.com/owasp-modsecurity/ModSecurity-nginx/issues/254) (search summary)
- PR #84 shows the same: the client got 200, the audit log said 403 and nginx logged 500. — [ModSecurity-nginx PR #84](https://github.com/owasp-modsecurity/ModSecurity-nginx/pull/84) (search summary)
- Open PR #377 makes late phase:4 behavior explicit "instead of pretending deny works after headers are sent." — [PR #377](https://github.com/owasp-modsecurity/ModSecurity-nginx/pull/377) (search summary)
- PR #395 says the connector forces every response body into memory wherever modsecurity is on, regardless of `SecResponseBodyAccess`. — [PR #395](https://github.com/owasp-modsecurity/ModSecurity-nginx/pull/395) (search summary)
- The `responseBodyAccess`/`responseBodyLimit` ctl actions are listed as "Not supported in ModSecurity v3." — [ModSecurity v3 Reference Manual](https://github.com/owasp-modsecurity/ModSecurity/wiki/Reference-Manual-(v3.x)) (search summary)

**Caddy / Coraza**
- Coraza is Go, SecLang-compatible and claims 100% OWASP CRS compatibility. Connector status: Caddy is "stable, needs a maintainer"; Envoy proxy-wasm is "stable, still under development"; HAProxy SPOE is "preview"; nginx and Apache are experimental. — [Coraza introduction](https://coraza.io/docs/tutorials/introduction/)
- `SecResponseBodyAccess` defaults to Off and is "required if you plan to inspect HTML responses and implement response blocking." Bodies are buffered only for matching `SecResponseBodyMimeType`. When over the limit, the default is reject; `ProcessPartial` inspects only the prefix. — [Coraza directives](https://www.coraza.io/docs/seclang/directives/) (search summary)
- coraza-caddy with `SecResponseBodyAccess On` + `ProcessPartial` + a 128 KiB limit produced short-write/incomplete responses on `reverse_proxy` (Coraza 3.3.3, Caddy 2.10.0). Disabling response body access fixed it. — [coraza-caddy issue #128](https://github.com/corazawaf/coraza-caddy/issues/128) (search summary)
- coraza-apache held response headers until end-of-stream or a 1 MiB cap even when the body would not be inspected, which stalled NDJSON/chunked streams. The fix streams non-inspected responses, but "Responses requiring inspection remain buffered until inspection completes." — [coraza-apache PR #61](https://github.com/corazawaf/coraza-apache/pull/61); same design in [coraza-nginx PR #142](https://github.com/corazawaf/coraza-nginx/pull/142) (search summary)

**HAProxy SPOE**
- `http-response wait-for-body time <t> [at-least <bytes>]` exists (2.4+). Newer versions add `use-large-buffer` and `no-fail`. After it, `http-response send-spoe-group` can ship `res.body` to an agent; the body is bounded by `tune.bufsize`. — [HAProxy 2.4 manual](https://docs.haproxy.org/2.4/configuration.html), [3.5-dev manual](https://docs.haproxy.org/dev/configuration.html) (search summary)
- A production SPOE integration uses `http-response wait-for-body time 10s at-least 128k` then `http-response send-spoe-group`. — [Traceable HAProxy docs](https://docs.traceable.ai/docs/haproxy) (search summary)

**Commercial reference point**
- Fastly Next-Gen WAF agent: median decision time is under 1 ms, an average of 1.43 ms for requests over 7 KB, using about 40 MB RAM. These figures exclude module overhead. The module fails open if the agent does not answer in time. — [Fastly NGWAF agent benchmarks](https://www.fastly.com/resources/datasheets/fastly-ngwaf-agent-performance-benchmarks) (search summary)

### Inferences
- Where each layer can stop an already-produced response:

  | Layer | Can block the response cleanly? | Why |
  |---|---|---|
  | Envoy ext_proc in BUFFERED mode | Yes | Response headers and body are held before forwarding, so an `immediate_response` can replace them with a clean 403 or 451 |
  | Envoy ext_proc in FULL_DUPLEX_STREAMED mode, processor holds all chunks | Yes | Same effect as buffering, with no default 200 ms timeout |
  | Wasm filter that pauses on `onResponseHeaders` until end-of-body | Yes | Same idea; inferred from the general proxy-wasm model, not confirmed in a fetched doc |
  | HAProxy `wait-for-body` + SPOE | Yes | The body is held before the decision |
  | Coraza phase 4 (Caddy, or Envoy Go filter) | Yes | Needs a MIME-type match and a size limit |
  | njs `js_body_filter` | Rewrite or truncate only | Headers have already gone out |
  | OpenResty `body_filter_by_lua` | Rewrite or truncate only | Headers have already gone out |
  | ModSecurity-nginx phase 4 | Rewrite or truncate only | Headers have already gone out |

  The closest nginx workaround is to set `proxy_buffering` and let OpenResty or njs collect the body in a content handler (`ngx.location.capture` or `r.subrequest` to an internal upstream location) and decide before sending. That moves the logic out of a filter into a handler. This approach is unverified; benchmark it.
- A Caddy Go middleware can wrap `http.ResponseWriter`, hold `WriteHeader` and buffer `Write` until a decision. This is the standard Go pattern and is what Coraza-Caddy does internally. Caddy docs for this were not fetched.
- Streaming (SSE, chunked LLM output, gRPC streams) and response-blocking pull against each other. Practical policy:
  1. Buffer and fully inspect only small, risky MIME types (JSON/HTML under N KB).
  2. For large or streaming bodies, inspect per chunk with a sliding window and truncate or terminate on a hit (cut the stream or send an RST). Accept that the client may already have received part of the body.
  3. Skip binary and media types.
- Compression: inspecting gzip/br bodies needs decompression before the inspector. In Envoy, put a decompressor filter before the inspection filter and a compressor after it. In nginx, use `gunzip`, or request identity encoding upstream (strip or force `Accept-Encoding`). This costs CPU and memory per response; an explicit size cap is needed to avoid decompression bombs. This is not verified against fetched docs.
- For per-request latency, in-process native code (Envoy C++/Rust dynamic module, Go filter, OpenResty Lua) beats ext_proc and Wasm. ext_proc costs a gRPC hop per phase used, so enable only the phases you need with `processing_mode` and `allow_mode_override`. Its benefit is isolation and independent deploys.

### Gaps
- No official Envoy benchmark of ext_proc per-call µs overhead, and no first-hand measurement of FULL_DUPLEX_STREAMED with large bodies.
- No published latency numbers found for njs `js_body_filter` or OpenResty `body_filter_by_lua` on large bodies.
- Did not fetch Caddy's `reverse_proxy` streaming/flush docs or the coraza-caddy README to confirm SSE behavior.
- HAProxy `doc/SPOE.txt` (event names, max frame size) was not read directly.
- Exact semantics of an ext_proc `immediate_response` sent during the response-body phase (e.g. after partial streaming) were not confirmed in the docs.

## 2. Fast inline matching and per-session state; per-request budgets; cascade designs

### Takeaway
Production edges keep inline work in the tens to hundreds of microseconds. Cloudflare's WAF ML runs at about 275 µs average per request after optimization. Its threat-intel lookups are O(1) "measured in microseconds." Engines that guarantee linear time (RE2/Rust regex, Hyperscan/Vectorscan) are mandatory for attacker-controlled input, since a single backtracking regex took Cloudflare down in 2019. Caching repeated inputs removes much of the cost; Cloudflare saw a 70% hit rate. A cascade fits these budgets: a cheap rule, sketch and ML screen on every request, and an expensive LLM run asynchronously on flagged sessions.

### Cited Findings
- Cloudflare WAF ML average per-request latency fell from 1519 µs to 275 µs (5.5x) — [Cloudflare blog](https://blog.cloudflare.com/making-waf-ai-models-go-brr/):
  - SIMD dropped it to 884 µs.
  - TFLite upgrade + XNNPack dropped it to 552 µs.
  - An LRU cache (lua-resty-mlcache, shared across nginx workers, about 70% hit rate, skipping pre-processing and inference on hits) dropped it to 275 µs.
  - Inference on a 1 KB body went from 246 to 56 µs. Branchless pre-processing on a 9.5 KB body went from 248 to 21.5 µs.
  - About 9.5M req/s pass through WAF ML.
- Cloudflare's WAF has "thousands of rules." It uses memoization and the wirefilter engine. — [Making the WAF 40% faster](https://blog.cloudflare.com/making-the-waf-40-faster/) (search summary)
- Threat-intel WAF rules use O(1) lookups against local datasets, so overhead "stays effectively zero (measured in microseconds)" whether there are 10 or 10 million indicators. — [Cloudflare threat intel rules](https://blog.cloudflare.com/realtime-threat-intel-waf-rules/) (search summary)
- The 2019 Cloudflare outage came from PCRE catastrophic backtracking in the Lua WAF. The remediation moved to linear-time engines (RE2 family). — [postmortem study guide](https://cloud.noblerworks.com/resources/postmortem-cloudflare-regex-2019/) (secondary; primary is Cloudflare's July 2019 postmortem, not fetched)
- Hyperscan (NSDI '19) decomposes regexes into string matching plus finite-automata matching with SIMD. It "improves the performance of Snort by a factor of 8.7 for a real traffic trace." — [USENIX NSDI '19](https://www.usenix.org/conference/nsdi19/presentation/wang-xiang)
- Hyperscan licensing: Intel moved to a proprietary license from 5.5. The last BSD release is 5.4.x (reported May 2024). Vectorscan is the BSD fork, API/ABI-compatible with 5.4, and adds ARM NEON and Power VSX. Fedora retired Hyperscan in favor of Vectorscan. — [Phoronix](https://www.phoronix.com/news/Intel-Hyperscan-Now-Proprietary), [Vectorscan GitHub](https://github.com/Vectorcamp/vectorscan) (search summary)
- nginx njs offers `js_shared_dict_zone` (0.8.0+): shared memory across workers, with per-key `timeout`, `evict` (drop oldest when full), `type=number` with `incr`, and `state=file` persistence (0.9.1). — [ngx_http_js_module](https://nginx.org/en/docs/http/ngx_http_js_module.html)
- The CrowdSec nginx bouncer uses `lua_shared_dict` to share its decision cache between workers. — [CrowdSec nginx bouncer docs](https://docs.crowdsec.net/u/bouncers/nginx/) (search summary)
- VibeWAF (Virginia Tech, AgenticOS '26 workshop) is a hybrid: a fast Coraza v3.2.1 rule engine handles known patterns, and an LLM (Claude Sonnet 4.5) analyzes unmatched traffic and generates new rules. The authors say "LLM inference latency precludes direct real-time deployment" and that static LLM rules do not generalize to unseen attacks. Evaluation used only 40 malicious requests (SR-BH 2020). — [VibeWAF paper PDF](https://people.cs.vt.edu/djwillia/papers/agenticos26-vibewaf.pdf) (search summary)

### Inferences
- Proposed budget per request on the hot path: header and URI checks under 50 µs; body scanning about 1 µs per KB with Vectorscan literals or RE2; ML scoring 50 to 300 µs (Cloudflare's numbers). Anything needing a network round trip goes off-path, as shadow work or flagged-only.
- Per-session state: keep counters local (njs `js_shared_dict_zone`, `lua_shared_dict`, or Envoy per-worker state) with TTLs, and sync asynchronously to Redis for fleet-wide views. Sketches keep memory bounded under high key churn (IPs, JA3/JA4 fingerprints, session IDs): count-min for per-key rates and HyperLogLog for distinct-path or distinct-param counts. This is design guidance from general knowledge and not verified against a fetched benchmark.
- Cascade pattern (inferred from VibeWAF and Cloudflare):
  - **L0:** static allow/deny lists and O(1) reputation lookups.
  - **L1:** multi-pattern literal and regex matching (Vectorscan/RE2), with CRS only on high-risk routes.
  - **L2:** small ML score plus session anomaly sketches.
  - **L3:** an LLM gets only sessions above a threshold, asynchronously. Its output is a containment decision (e.g. a session-scoped rule with a TTL) pushed back into L0/L1, never a synchronous per-request verdict.
- Caching verdicts on normalized inputs (Cloudflare's 70% hit rate) is the cheapest optimization. Cache keys must include rule-version IDs so cached verdicts are invalidated on rule pushes.

### Gaps
- No primary source for Redis round-trip budgets inside proxies, or for count-min/HLL use in a named commercial WAF.
- Did not obtain Hyperscan/Vectorscan Gbps vs pattern-count figures (they are in the NSDI paper's evaluation, not read).
- No source confirms whether Cloudflare uses Hyperscan.

## 3. Dynamic rules: hot reload, scoping, TTLs, shadow mode, canary and automatic rollback

### Takeaway
All four proxies can change rules without dropping connections:
- **Envoy:** xDS and runtime, plus ext_proc or Wasm config.
- **Caddy:** admin API `/load` with automatic rollback.
- **nginx/OpenResty:** shared dicts with TTLs (or graceful `nginx -s reload`).
- **CrowdSec:** bouncers polling decisions about every 10 s.

The two Cloudflare outages of late 2025 show the main risk. Rule and config data pushed fleet-wide in seconds without staged rollout is as dangerous as code. Generated config must be validated like untrusted input, rolled out in stages and have a fail-open path.

### Cited Findings
- Caddy `POST /load` "blocks until the reload completes or fails." Changes "incur zero downtime." "If the new config fails for any reason, the old config is rolled back into place without downtime." — [Caddy admin API](https://caddyserver.com/docs/api)
- Caddy's `/config/` paths support granular POST/PUT/PATCH/DELETE edits. Individual requests have ACID guarantees, but there are no multi-request transactions. Use `Etag`/`If-Match` for optimistic concurrency (412 on conflict; marked experimental). `--resume` persists the last config. — [Caddy admin API](https://caddyserver.com/docs/api)
- Envoy local rate limit uses `filter_enabled` (evaluate) and `filter_enforced` (enforce), each a RuntimeFractionalPercent defaulting to 0%. Enabled-but-not-enforced gives a dry run, and `request_headers_to_add_when_not_enforced` tags would-be-limited requests. Percentages can be driven by runtime keys without new config. Limits are per Envoy instance. — [Envoy local rate limit docs](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/local_rate_limit_filter) (search summary)
- Envoy RBAC has `shadow_rules` with `shadow_allowed`/`shadow_denied` stats. This came from the search tool's memory and was not verified against the RBAC proto docs.
- ext_proc `observability_mode` gives shadow inspection with responses ignored. Per-route `ExtProcPerRoute` scopes it. — [ext_proc proto](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/http/ext_proc/v3/ext_proc.proto)
- CrowdSec bouncers ([CrowdSec nginx bouncer docs](https://docs.crowdsec.net/u/bouncers/nginx/), [lua-bouncer-plugin](https://hub.docker.com/r/crowdsecurity/lua-bouncer-plugin), [Apache bouncer](https://docs.crowdsec.net/u/bouncers/apache_bouncer/); search summary):
  - In stream mode, the bouncer pulls new and expired decisions from the Local API every `UPDATE_FREQUENCY` seconds (default 10 in the Lua plugin image).
  - In live mode, it queries the Local API per new IP and caches the result (`CACHE_EXPIRATION` default 1 s).
  - The Apache bouncer's worst-case propagation is update frequency plus local cache timeout, about 12 s by default.
  - The bouncers also front the CrowdSec AppSec (WAF) component, toggled per location with `crowdsec_enable_appsec`/`crowdsec_disable_appsec`.
- Coraza/ModSecurity `SecRuleEngine DetectionOnly` gives detect-only mode. This is standard SecLang and was not fetched directly.
- Cloudflare outage, 5 Dec 2025 ([Cloudflare postmortem](https://blog.cloudflare.com/5-december-2025-outage/)):
  - Cloudflare was raising the WAF body buffer from 128 KB to 1 MB for React CVE-2025-55182 through its gradual deployment system.
  - A related killswitch disabling an internal WAF test tool went through the global configuration system, which "propagates changes within seconds to the entire fleet." Cloudflare had "never before applied a killswitch to a rule with an action of 'execute'." A nil-index bug in Lua (FL1) then returned 500s.
  - About 28% of HTTP traffic was affected for about 25 minutes (08:47 to 09:12 UTC).
  - Lessons: configuration needs "the same safety and blast mitigation features" as code (staged rollout, health checks, fast rollback); fail-open should "pass traffic without scoring, rather than dropping requests"; and break-glass capabilities need to keep working.
- Cloudflare outage, 18 Nov 2025 ([Cloudflare postmortem](https://blog.cloudflare.com/18-november-2025-outage/)):
  - A ClickHouse permissions change made the Bot Management feature-file query return duplicate rows. The file, regenerated every 5 minutes, doubled in size.
  - It exceeded a 200-feature preallocated limit (normal use was about 60), and the FL2 Rust proxy panicked on `unwrap()`.
  - The outage ran about 11:20 to 17:06 UTC.
  - Remediations include "Hardening ingestion of Cloudflare-generated configuration files in the same way we would for user-generated input" and "Enabling more global kill switches."

### Inferences
- Treat every dynamic rule as a versioned, typed object: id, scope (session ID, IP/CIDR, JA4 fingerprint, route, tenant), action (log, tag, challenge, rate-limit, block, strip-response-field), TTL, origin (human/LLM/feed), and rollout stage.
- Store rules in a local shared dict or xDS resource with TTL expiry enforced at lookup time, so an expired rule is ignored even if a delete fails to propagate.
- Rollout ladder for any machine-generated rule:
  1. Validate against a schema, size limits, regex-complexity checks (RE2-compilable only) and a replay corpus of known-good traffic.
  2. Shadow fleet-wide (log-only, tag header).
  3. Enforce on 1% via a runtime fraction, or on a single canary node or route.
  4. Ramp to 100% with automated SLO gates: 4xx/5xx deltas per route, block rate vs baseline, conversion or health endpoints.
- Roll back automatically when the block rate on a route exceeds k times baseline, or when legitimate-traffic signals (e.g. authenticated sessions blocked) cross a threshold.
- Narrow scopes are safer. A session- or fingerprint-scoped block with a 15 to 60 minute TTL limits blast radius compared with a route-wide or global rule. Global rules should require a human.
- Keep a global kill switch that disables only the dynamic-rule layer (fail-open to the static baseline). Test it regularly, because Cloudflare's December outage was triggered by a rarely exercised killswitch path.
- For nginx, prefer data-plane updates (shared dict via an internal admin endpoint, or CrowdSec decisions) over config reloads for per-session rules. Reserve `nginx -s reload` for structural changes, because reloads spawn new workers and old workers drain.

### Gaps
- Envoy xDS delta propagation latency and Istio WasmPlugin hot-update behavior (whether a module swap drops in-flight requests) were not measured or confirmed.
- RBAC `shadow_rules` details are unverified.
- No public data found on automatic-rollback thresholds used by commercial WAFs.

## 4. Automated virtual patching from CVE disclosures (LLM-generated WAF rules) and advisory feed latency

### Takeaway
Research on LLM-generated WAF rules exists but is small-scale. GenXSS blocked 86% of previously bypassing XSS payloads with 15 GPT-4o rules on one app. VibeWAF was tested on 40 requests. I found no peer-reviewed work generating ModSecurity rules directly from CVE text with measured false-positive rates. Industry virtual patching is still human-researched but fast: Cloudflare shipped emergency rules for SharePoint CVE-2025-53770 within about a day and for React CVE-2025-55182 the same day, then refined it. CVE feeds are slow and incomplete. NVD moved to risk-based enrichment in April 2026 and leaves most CVEs unenriched. CISA KEV lags exploitation, with a median of 239 days from CVE publication to KEV listing in one tracker. A pipeline should key on vendor advisories, GHSA/OSV and exploitation signals rather than NVD.

### Cited Findings
- GenXSS (arXiv 2504.08176) — [arXiv](https://arxiv.org/html/2504.08176) (search summary):
  - It uses LLMs to generate XSS payloads that bypass the WAF, then GPT-4o rules that "effectively blocked 86% of all previously successful attacks which bypassed ModSecurity with only 15 new rules."
  - Scope is narrow: two XSS types, one vulnerable app, ModSecurity and AWS WAF.
- VibeWAF (AgenticOS '26): an LLM generates Coraza SecRules for traffic unmatched by the existing rules. It was evaluated on 40 malicious requests, and the authors note LLM latency prevents real-time use and static rules do not generalize. — [VibeWAF PDF](https://people.cs.vt.edu/djwillia/papers/agenticos26-vibewaf.pdf) (search summary)
- Adversarial SQLi generation with LLMs plus corresponding WAF rule generation was tested against ModSecurity and Coraza at PL1 to PL3 and cloud WAFs. — [arXiv 2605.11188](https://arxiv.org/pdf/2605.11188) (search summary; results not read)
- An evaluation framework for LLM-generated detection rules exists, built for email-security rules (Sublime); its methodology could be reused for WAF rules. — [arXiv 2509.16749](https://arxiv.org/pdf/2509.16749) (search summary)
- gen0sec/mcp-server has a `cve_waf_rule_generation_prompt` that builds a rule from a CVE ID using Nuclei templates and validates against a Wirefilter API. It is an example of CVE → PoC template → rule, not ModSecurity. — [GitHub](https://github.com/gen0sec/mcp-server) (search summary)
- FORGE (arXiv 2606.03453) covers multi-agent graduated exploitation and detection engineering, and cites CVE-Genie as the closest system. — [arXiv](https://arxiv.org/pdf/2606.03453) (search summary; not read in depth)
- Cloudflare emergency rule timelines:
  - SharePoint CVE-2025-53770: research began the evening of 20 July 2025 and the emergency managed rule shipped 21 July. — [Cloudflare blog](https://blog.cloudflare.com/cloudflare-protects-against-critical-sharepoint-vulnerability-cve-2025-53770/)
  - React RSC CVE-2025-55182: a generic deserialization-RCE rule shipped 2 Dec 2025, was relabeled the next day, and coverage for CVE-2025-55183/55184 was added 11 Dec. — [Cloudflare WAF changelog](https://developers.cloudflare.com/changelog/post/2025-12-02-emergency-waf-release/)
  - The changelog also shows Oct–Nov 2025 emergency releases for WSUS CVE-2025-59287, Oracle EBS CVE-2025-61882/61884, and others. — [Cloudflare WAF changelog](https://developers.cloudflare.com/changelog/product/waf/3/) (search summary)
  - The pattern: ship a broad generic rule fast, then narrow it. The buffer increase for that same React CVE fed into the 5 Dec outage. — [Cloudflare postmortem](https://blog.cloudflare.com/5-december-2025-outage/)
  - Unverified third-party claims: shattered.io's "under four hours" figure appears to describe 2022's Confluence CVE-2022-26134, not a 2025 event. A Nanosek "PHP2Shell CVE-2026-109618/109619" claim of rules live 10.5 h before disclosure has unusual CVE IDs and should not be used without confirmation. — [shattered.io](https://shattered.io/cloudflare-wordpress-cve-patch-2026/), [Nanosek](https://www.nanosek.com/blog/php2shell-cloudflare-waf-cve-2026-109618-109619)
- NVD status ([CSA research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-nist-nvd-enrichment-overhaul-20260429-csa/), [Cyber Strategy Institute, Oct 2026](https://cyberstrategyinstitute.com/cve-state-of-risk-october-2026/); search summary):
  - A backlog has existed since early 2024. On 15 April 2026 NIST moved to risk-based enrichment, and about 29,000 CVEs published before 1 March 2026 were marked "Not Scheduled"/Deferred.
  - NIST commits to enriching KEV-listed CVEs within one business day.
  - One tracker reports 75,242 CVEs in the first 9 months of 2026, with NVD enriching only 8.4% in Q3 2026. These are secondary figures and conflict with other counts, such as "32% of CVE-2025 fully enriched by early 2026."
- CISA KEV: entries are added on a rolling basis. One tracker computes a median of 239 days from CVE publication to KEV listing across 1,748 entries, with 25% listed within 7 days. — [CVEDaily KEV lag tracker](https://cvedaily.io/kev/) (third-party, search summary)
- EPSS: FIRST has published daily EPSS scores (30-day exploitation probability) since January 2021. — [Wikipedia: EPSS](https://en.wikipedia.org/wiki/Exploit_Prediction_Scoring_System) (secondary)
- OSV.dev aggregates GHSA, PyPA, RustSec and other ecosystem advisories. — [senserva tracker](https://senserva.com/open-source-patch-tracker.html) (secondary; no official latency figure found)

### Inferences
- A realistic "CVE → virtual patch" loop:
  1. **Ingest:** vendor advisories, GHSA/OSV (package-level, often with fix commits), KEV and EPSS as priority signals. Use NVD only for optional enrichment.
  2. **Filter:** keep only CVEs matching your SBOM or stack fingerprint.
  3. **Draft:** an LLM writes a narrowly scoped candidate rule (route, parameter, content-type), using the fix diff, PoC or Nuclei template where available.
  4. **Validate in a sandbox:** the rule must block the reproduced exploit (see Q5) and must not fire on a replay corpus of production traffic.
  5. **Deploy:** go through the shadow → canary → enforce ladder from Q3, with TTL and auto-expiry once the real patch ships.
- The generic-first approach (broad rule, then narrow) works for a CDN with a large research team. For an automated system the false-positive cost is borne by your own app. Prefer narrow, route-scoped rules plus shadow time, and escalate breadth only with human approval.
- Main LLM-rule failure modes:
  - Overly broad regexes that cause false positives, like CRS 920420 blocking every POST under one connector.
  - Non-linear regexes that cause DoS; mitigate by allowing only RE2/Vectorscan-compilable syntax.
  - Rules that match the published PoC string but not trivially mutated variants, which give false confidence.
  - Syntax or phase errors, e.g. phase:4 deny not working in ModSecurity-nginx.
  - Rules that depend on body buffering the connector does not do.
  - Mutation fuzzing of the PoC should be part of validation.

### Gaps
- No peer-reviewed study found measuring false-positive rates of LLM-generated WAF rules on production-like benign traffic.
- No commercial product with published accuracy for fully automated CVE→WAF rule generation was confirmed. Products may exist; I did not find primary sources.
- Official publication-latency figures for GHSA → OSV or CVE → GHSA were not found.

## 5. Automated vulnerability understanding and source patching (AIxCC, Big Sleep, CodeMender, others), and reuse in a "periodic research window"

### Takeaway
LLM cyber reasoning systems can find and patch memory-safety and injection bugs in real codebases at about $152 per task and an average of 45 minutes (AIxCC final, August 2025). All seven finalist systems were committed to open source. CVE-Genie reproduces about 51% of recent CVEs at $2.77 each. Plausible patches, however, are often wrong. PatchIsland's own postmortem found incorrect patches among its validated ones. Repair rates collapse for multi-hunk or multi-file fixes, and Google (Big Sleep, CodeMender) keeps humans reviewing every patch. These tools belong in an isolated, offline reproduction-and-patch loop that outputs proposals (a rule, a patch PR), never in the inline request path.

### Cited Findings
- AIxCC final, DEF CON 33, August 2025 ([DARPA](https://www.darpa.mil/news/2025/aixcc-results)):
  - Systems found 54 of the synthetic vulnerabilities in 63 challenges (86%, up from 37% at semifinals) and patched 43 (68% of those found, up from 25%).
  - They also found 18 real, non-synthetic vulnerabilities (6 in C, 12 in Java) and produced 11 patches for them.
  - Patches took an average of 45 minutes, at about $152 per task, over more than 54M lines of code.
  - Patches ranged from one line to more than 300 lines.
  - All seven systems were to be released under OSI-approved licenses, with four out on announcement day.
- Placings: 1 Team Atlanta ($4M), 2 Trail of Bits ($3M, "Buttercup"), 3 Theori ($1.5M), then Fuzzing Brain, Shellphish, 42-b3yond-6ug and Lacrosse. — [AIxCC winners](https://aicyberchallenge.com/finals-winners-announcement/), [DARPA](https://www.darpa.mil/news/2025/aixcc-results)
- Team Atlanta's ATLANTIS code is at github.com/Team-Atlanta/aixcc-afc-atlantis and its paper is arXiv 2509.14589. Final-round budgets were $85K of Azure compute and $50K of LLM spend per team. — [ATLANTIS arXiv](https://arxiv.org/pdf/2509.14589) (search summary)
- OpenSSF (May 2026) engaged OSTIF to close out AIxCC-found bugs. With OSS-CRS, which runs AIxCC systems locally and is an OpenSSF sandbox project, Team Atlanta found 25 vulnerabilities across 16 projects including PHP, U-Boot and memcached. — [OpenSSF blog, 12 May 2026](https://openssf.org/blog/2026/05/12/hack-to-the-future-the-impact-and-legacy-of-the-darpa-aixcc-challenge/) (search summary)
- Google Big Sleep (DeepMind + Project Zero) found SQLite CVE-2025-6965 (fixed in 3.50.2, CVSS 7.2). Google said the flaw was "known only to threat actors." Kent Walker called it "the first time an AI agent has been used to directly foil efforts to exploit a vulnerability in the wild." — [Google blog, summer 2025](https://blog.google/innovation-and-ai/technology/safety-security/cybersecurity-updates-summer-2025/), [The Hacker News](https://thehackernews.com/2025/07/google-ai-big-sleep-stops-exploitation.html) (search summary)
- Big Sleep's "first 20" vulnerabilities (FFmpeg, ImageMagick, and others), announced August 2025 and each human-checked, appear only in a secondary timeline. — [itlibra timeline](https://history.itlibra.com/en/events/big-sleep-2024) (unverified, secondary)
- Google DeepMind CodeMender (announced 6 October 2025) — [The Hacker News](https://thehackernews.com/2025/10/googles-new-ai-doesnt-just-find.html), [CSO Online](https://www.csoonline.com/article/4068774/google-deepmind-launches-an-ai-agent-to-fix-code-vulnerabilities-automatically.html) (search summary):
  - It runs on Gemini Deep Think, with static and dynamic analysis, differential testing, fuzzing, SMT solvers and an LLM critique tool to catch regressions.
  - It had "upstreamed 72 security fixes to open source projects" in six months, some in codebases of 4.5M lines, all human-reviewed.
  - Proactively, it added `-fbounds-safety` annotations to libwebp (the CVE-2023-4863 target).
  - It was later folded into Google's agent platform. — [CSO Online](https://www.csoonline.com/article/4176164/google-folds-codemender-into-agent-ecosystem-amid-push-for-ai-led-appsec.html) (search summary)
- CVE-Genie (arXiv 2509.01835, September 2025) — [arXiv](https://arxiv.org/abs/2509.01835) (search summary):
  - It is a multi-agent Processor → Builder → Exploiter → CTF Verifier pipeline that rebuilds the vulnerable environment and produces verifiable exploits.
  - It reproduced 428 of 841 (about 51%) CVEs from June 2024 to May 2025 at $2.77 per CVE on average.
  - Failures: 110 setup, 198 time/cost limits, 52 VM/LLM errors.
  - Standalone o3 could not reproduce a single CVE end-to-end. Code is at github.com/BUseclab/cve-genie.
- CVE-Bench, a web-app exploitation benchmark: 13% best-case success on 40 critical web CVEs in the one-day setting. — cited in [FORGE arXiv 2606.03453](https://arxiv.org/pdf/2606.03453) (search summary)
- Patch correctness failure modes:
  - PatchIsland (an AIxCC patching orchestrator) reported a 91.3% plausible-patch rate internally and 31 of 43 (72.1%) officially validated in the final. Its postmortem found only 27 of 33 intended-vulnerability patches correct on manual review, and 10 of 14 plausible patches for unintended vulnerabilities incorrect. — [PatchIsland arXiv 2601.17471](https://pith.science/paper/2601.17471) (search summary)
  - VulnRepairEval (23 Python CVEs, PoC-grounded) found low end-to-end repair across 12 LLMs. Wrong localization accounted for 60 to 78% of attempts. — [arXiv 2509.03331](https://arxiv.org/html/2509.03331) (search summary)
  - PatchEval (ByteDance, 1,000 CVEs, 65 CWEs) found repair rates of 7.7% for fixes over 20 lines, 5.0% for more than 3 hunks and 0% for more than 2 files. A reported leaderboard top of 83.91% Pass@1 on the 230-case verified subset comes from the search summary and the model name was not verified. — [arXiv 2511.11019](https://arxiv.org/html/2511.11019) (search summary)
  - The distinction between "plausible" (passes tests) and "correct" (semantically equivalent fix) is central to this literature. — [arXiv 2507.20977](https://arxiv.org/html/2507.20977) (search summary)

### Inferences
- Proposed "periodic research window" architecture:
  1. On a schedule (e.g. nightly), or when the inline layer flags a novel attack cluster, spin up an isolated sandbox. It should be an ephemeral VM or container, with a snapshot of the service at the deployed commit, synthetic data and no production credentials, and egress denied except to the LLM API.
  2. Feed it the flagged requests and responses (sanitized) plus any matching CVE or advisory.
  3. Use a CVE-Genie-style agent to reproduce the issue against the sandboxed app, and an AIxCC CRS (e.g. via OSS-CRS) or a CodeMender-style agent to propose a source patch with a PoC test.
  4. Emit two artifacts: (a) a narrowly scoped virtual-patch rule validated against the PoC and a benign replay corpus, which goes into the Q3 rollout ladder; (b) a patch PR for human review with the PoC as a regression test.
- Never let the reproduction agent touch production. Test exploits against production would be indistinguishable from an attack and could cause damage. The inline layer only contains; the research window only proposes.
- Given the plausible-vs-correct gap and the weak results on multi-hunk fixes, auto-merge of source patches is not justified today. Auto-deploy of a short-TTL, narrowly scoped containment rule is defensible because it is reversible and time-boxed.
- AIxCC systems target C/Java memory-safety and injection bugs found by fuzzing harnesses. Their applicability to web-app logic flaws (authz, IDOR, business logic) is limited. CVE-Bench's 13% web-CVE success rate supports this.

### Gaps
- Did not read the ATLANTIS or other finalist repos to confirm their license, runtime requirements and supported languages as of November 2026.
- No primary source for Big Sleep's total disclosed-vulnerability count after August 2025.
- No independent evaluation found of CodeMender patch acceptance or false-fix rate.

## 6. Human-in-the-loop alerting for off-hours, auto-containment with expiry, and the risks of fully autonomous blocking

### Takeaway
The strongest evidence on autonomous-change risk comes from Cloudflare's two late-2025 outages: machine-generated or instantly propagated config took down large shares of traffic within minutes. The safe pattern is bounded auto-containment with an automatic expiry and immediate escalation to a human. That means narrow scope, short TTL, rate-capped and reversible, and it is roughly how Fastly (fail-open agent) and CrowdSec (time-limited decisions) behave. Broad or permanent actions should need human approval.

### Cited Findings
- Instantly propagated config caused 28% HTTP failure in about 1 minute (5 Dec 2025). Cloudflare's fixes are staged config rollouts, fail-open "pass traffic without scoring," break-glass tooling and a change freeze. — [Cloudflare 5 Dec postmortem](https://blog.cloudflare.com/5-december-2025-outage/)
- An auto-generated feature file broke the core proxy for about 5¾ hours (18 Nov 2025). The flapping caused by 5-minute regeneration first looked like a DDoS, delaying diagnosis. — [Cloudflare 18 Nov postmortem](https://blog.cloudflare.com/18-november-2025-outage/)
- Fastly's NGWAF module fails open if the agent does not respond within a time limit. — [Fastly benchmarks datasheet](https://www.fastly.com/resources/datasheets/fastly-ngwaf-agent-performance-benchmarks) (search summary)
- Envoy ext_proc defaults to fail-closed (500/504). `failure_mode_allow: true` makes it fail-open. Istio WasmPlugin defaults to FAIL_CLOSE, with FAIL_OPEN "not recommended for authn/authz." — [ext_proc proto](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/http/ext_proc/v3/ext_proc.proto), [Istio WasmPlugin](https://istio.io/latest/docs/reference/config/proxy_extensions/wasm-plugin/)
- CrowdSec decisions propagate to bouncers within about 10 to 12 s in stream mode. This sets the floor for how quickly an automated containment can be applied or lifted fleet-wide with that tool. — [CrowdSec docs](https://docs.crowdsec.net/u/bouncers/nginx/) (search summary)

### Inferences
- Tiered autonomy policy:
  - **Tier A (fully automatic):** session-, token- or fingerprint-scoped actions such as challenge, rate-limit, block or strip a response field. TTL 15 to 60 minutes, a per-hour cap on auto-actions, and auto-expiry. Page on-call only if the cap is hit or a protected class is affected (e.g. authenticated or paying users, health checks).
  - **Tier B (auto-shadow, human-enforce):** route-wide or IP-range rules and any LLM-generated signature. These deploy in shadow automatically and page or notify on-call with a one-click "enforce for N hours" approval.
  - **Tier C (human only):** global rules, fail-closed changes, source patches.
- Off-hours escalation: send a high-urgency page only when containment cannot be applied safely, or when Tier A caps are exceeded. Otherwise post a low-urgency summary that is acknowledged in the morning. Auto-expiry means an unanswered page decays to the baseline state instead of persisting. Every auto-action needs an audit record (what, why, scope, TTL, evidence, rule version) and a one-command revert.
- Risks of fully autonomous blocking:
  - Self-inflicted outages (Cloudflare-style).
  - Attacker-induced false positives: an attacker can make the system block legitimate users by spoofing their fingerprints or poisoning the LLM's inputs. Prompt injection inside request or response content seen by the LLM tier is a concrete vector.
  - Feedback loops, where blocks change traffic in ways that trigger more blocks.
  - Silent data-integrity damage from response rewriting (truncated JSON).
  - Mitigations: Tier caps, shadow time, scope limits, and treating LLM output as untrusted data validated by a schema and a replay corpus.

### Gaps
- No primary source found for PagerDuty/Opsgenie-style patterns specific to auto-containment with expiry. The tiering above is inference.
- No published incident data found specifically on LLM-driven WAF automation causing outages or being manipulated in production.
- Did not find a primary source quantifying false-positive rates from fully autonomous blocking in commercial WAF/CDN products.
