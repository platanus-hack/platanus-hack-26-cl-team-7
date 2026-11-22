# Blocking at the last step: response-side exploit detection, its limits, a CVE testbed, and the exposure window

Research date: 2026-11-21. All statistics are dated. Claims marked **[unverified]** came from search-engine summaries or secondary sources that I did not confirm on the primary page.

Method note: Firecrawl search hit HTTP 429 rate limits after about two queries, so most retrieval used WebSearch/WebFetch. The Vulhub inventory came from the GitHub tree API and the raw README files, read on 2026-11-21. One search phrased around exploit generation for specific CVEs was blocked by model safeguards. The CVE table therefore relies on Vulhub's own README text, not on PoC repositories.

## (a) Which web exploit classes leave evidence in the HTTP response, which do not, and what covers the rest

### Takeaway
Response-side detection is a real but narrow layer. It works best on in-band disclosure: file contents, DB errors and dumps, directory listings, stack traces, webshell pages and planted canaries. The off-the-shelf signature layer (OWASP CRS outbound rules) is thin and skips compressed bodies by default. Blind, out-of-band, state-changing, multi-request and streaming (WebSocket) exploits leave nothing to withhold in the response that carries the exploit. For those, "the step before compromise" can only be enforced at the host or runtime (eBPF/LSM, RASP, egress allowlists), not at a reverse proxy.

### Cited Findings

**What the signature layer actually covers (OWASP CRS v4 outbound rules)**
- CRS v4 ships these response rule files:
  - RESPONSE-950 generic data leakage
  - 951 SQL error leakage ("indicative of SQL injection issues being present")
  - 952 Java, 953 PHP, 954 IIS
  - 955 web shells in response bodies (PHP, JSP, ASP), described as possibly signaling "a successful server compromise"
  - 956 Ruby error messages and stack traces
  - 959 response anomaly-score blocking

  Files 955 and 956 are new in v4. — [CRS docs: What's in the rules](https://coreruleset.org/docs/3-about-rules/rules/)
- RESPONSE-950 is small. Its default paranoia level 1 (PL1) detections are:
  - 950130 directory listing ("Index of", IIS "[To Parent Directory]")
  - 950140 CGI source leakage (body starting with a `#!/` shebang)
  - 950150 ASP.NET exception strings

  At PL2, 950100 flags any 5xx status. Paranoia levels 3 and 4 add no rules. — [RESPONSE-950-DATA-LEAKAGES.conf (main branch, v4.31.0-dev)](https://raw.githubusercontent.com/coreruleset/coreruleset/main/rules/RESPONSE-950-DATA-LEAKAGES.conf)
- **Built-in blind spot.** Rule 950020 skips all response-body rules when `Content-Encoding` is gzip, compress, deflate, br or zstd. A proxy placed after the origin's compression therefore gets no outbound body inspection from CRS unless it decompresses first. — [RESPONSE-950 rule file](https://raw.githubusercontent.com/coreruleset/coreruleset/main/rules/RESPONSE-950-DATA-LEAKAGES.conf)
- **Tuning burden.** A fresh CRS deployment "has no awareness of the web services that may be running behind it," so it needs rule exclusions per app or per path. — [CRS: False Positives and Tuning](https://coreruleset.org/docs/2-how-crs-works/2-3-false-positives-and-tuning/)
- I found no published precision or false-positive rates specific to the outbound (95x) rules.

**Differential and baseline response analysis (academic)**
- Response-aware anomaly detection exists in the literature but is a minority of the work:
  - A seq2seq-with-attention model predicts the expected server response and flags deviation from the real one ([Mohammadi & Namadchian, Semantic Scholar](https://www.semanticscholar.org/paper/Anomaly-based-Web-Attack-Detection:-The-Application-Mohammadi-Namadchian/32ae6941bb8ca4eee3000362b90240a464738b28)).
  - A k-NN framework learns normal usage from full request and response contents ([Springer chapter](https://link.springer.com/chapter/10.1007/978-3-319-26227-7_72)).
  - DUMONT profiles outbound HTTP structure and content through a proxy to find covert channels.

  Most ML work classifies requests instead. Kozik et al. (CORES 2015) report TPR/FPR errors below 1% on request classification. — [search summary of HTTP anomaly-detection literature](https://link.springer.com/chapter/10.1007/978-3-319-26227-7_72) **[FP figure unverified on primary page]**
- I found no paper that directly evaluates "did the attack succeed?" from the server's response at production scale.

**Canaries and honeytokens**
- Vendors claim canary alerts are "almost never false positives."
  - CounterCraft makes that claim and notes canaries help only if well placed. ([CounterCraft](https://www.countercraftsec.com/blog/canary-tokens-honeytokens-explained/))
  - A blog quotes 0.1% honeytoken FP vs 45% for SIEM rules with no primary source. ([Decryption Digest](https://www.decryptiondigest.com/blog/canary-tokens-honeytokens-early-breach-detection), **[unverified, no source]**)
- Counter-evidence: an Imperva patent states that detecting access to honeytokens stored in server data repositories "will lead to many false positive compromise alerts." This is presumably because legitimate bulk reads (backups, admin exports, reports) touch them. — [US 9667651](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9667651)
- Matching several independent canary tokens drives the coincidence probability down exponentially. This comes from a paper on detecting AI scrapers. — [arXiv 2605.13706](https://arxiv.org/pdf/2605.13706)
- Against LLM agents stealing credentials, detection probability scales with k/(m+k) (k honeytokens, m real credentials). That collapses if an adaptive attacker can distinguish fakes, which is why realistic generation (DP-HONEY) matters. — [arXiv 2606.04141](https://arxiv.org/pdf/2606.04141)

**What catches the blind and out-of-band classes**
- Falco detects but does not block. Its default rules include "shell spawned by web server," sensitive file reads, writes to binary directories and unexpected outbound connections. Blocking requires an add-on responder such as Falco-Talon. — [devopsboys comparison](https://devopsboys.com/blog/falco-vs-tetragon-runtime-security-comparison-2026); [k8s.info runtime security](https://k8s.info/docs/expert/runtime-security)
- Tetragon enforces in-kernel. A TracingPolicy with `action: Sigkill` uses `bpf_send_signal()` to kill the process before the syscall completes, and it can also deny calls through LSM hooks. A misconfigured kill policy can hurt availability. — [k8s.info](https://k8s.info/docs/expert/runtime-security); [decryptiondigest eBPF tools](https://www.decryptiondigest.com/blog/ebpf-runtime-security-tools-falco-tetragon)
- Limitation: Falco rules are single-event and stateless. Tetragon policies are single-hook. Neither can express "shell exec then connect" as one correlated policy. — [BPFence, arXiv 2609.13930](https://arxiv.org/pdf/2609.13930)
- CVE-Bench shows why egress control matters. After auditors closed an "outbound-service loophole" (agents could reach external hosts directly), reported success fell from about 22.5% to 12.5%. This comes via CyberEvolver's citation of a July 2025 audit. — [CyberEvolver arXiv 2605.26195](https://arxiv.org/pdf/2605.26195) **[read via search summary]**

### Classification table (synthesis; evidence column cites the sources above)

| Exploit class | Evidence in the triggering HTTP response? | Proxy-side signal | Evasions / limits | Complement needed |
|---|---|---|---|---|
| SQLi, error-based or UNION dump | Yes | CRS 951 SQL error strings; size/row-count drift; canary rows | Encoding (hex, base64), compression, pagination into many small responses | DB-side canary rows; DB query audit |
| SQLi, boolean or time-based blind | No (only latency or 1-bit differences) | Latency outliers per endpoint (weak) | Inherently blind; e.g., Vulhub wp2shell "calibrates the timing oracle" | DB query monitoring/RASP; detect the follow-on state change |
| LFI / path traversal | Yes (file contents) | `root:x:0:0`, PEM headers, `.env` keys, canary files | Base64 wrappers, binary or compressed containers (e.g., Gotenberg returns output inside a PDF) | Canary files plus file-open monitoring (eBPF) |
| SSRF to cloud metadata | Yes if reflected; no if blind | AKIA/ASIA key patterns, `"Code":"Success"` IMDS JSON | Blind SSRF; IMDSv2 tokens | Egress allowlists, IMDSv2 hop-limit, network policy |
| SSTI / RCE with echoed output | Yes | `uid=0(root)`-style output, CRS 955 webshell pages | Output in headers (React2Shell PoC uses `x-action-redirect`), in an error event fetched by a *second* request (Langflow CVE-2026-33017), encrypted | Process-exec allowlist (Tetragon), RASP |
| RCE, blind | No | None in the response; maybe a 500 | DNS/HTTP callbacks (Tomcat CVE-2025-24813 Vulhub check uses a URLDNS DNS callback); `touch` (pgAdmin) | Egress/DNS filtering, eBPF exec/connect, file-integrity monitoring |
| Reverse shell | No (new outbound connection) | None | — | Egress deny-by-default; Tetragon kill on connect from web process |
| Webshell write, then use | Write: no. Later use: yes | CRS 955 on later access | Custom shells | File-integrity monitoring on webroot |
| Auth bypass / IDOR / priv-esc | Response is a *normal-looking* 200 | Only semantic: "unauthenticated session got admin page"; request-side oddities (e.g., `x-middleware-subrequest`) | Identical to legitimate pages | Authz-aware proxy (session vs resource) |
| Encrypted or compressed exfil | Opaque | Size/entropy anomaly; unusual MIME on an unauth endpoint | nginx-ui CVE-2026-27944 returns an AES-encrypted backup with the key in a header | Endpoint allowlists; byte-volume caps |
| Streaming / WebSocket | Response not bufferable | Only partial; frame inspection | Marimo CVE-2026-39987 used the terminal WebSocket | Block upgrade on sensitive paths; runtime |

### Inferences
- **Effective mechanisms.** A proxy that withholds responses can reliably stop *in-band disclosure* if it:
  - decompresses bodies before inspection, unlike CRS default 950020;
  - runs high-precision signatures plus canaries whose values never legitimately leave the app;
  - adds per-endpoint baselines (status, size, content-type, JSON schema).

  Canaries are the highest-precision option because their appearance is close to proof of compromise. That precision holds only if no legitimate bulk export path touches them; the Imperva caveat shows this assumption breaks.
- **Inherent blind spot.** For RCE the proxy sees a symptom after code has already run. Withholding the output stops the attacker from *learning* the result, which matters a lot for AI agents that iterate on feedback. It does not undo execution, persistence or out-of-band exfiltration.
- **Where the last step can actually be enforced.** "The step before compromise" for RCE-class bugs is the exec/connect/open syscall. That is enforceable only at host or runtime level (Tetragon Sigkill/LSM, seccomp, RASP). A proxy-only product should present itself as one of two layers: (1) request-side plus response-side for in-band classes, and (2) runtime and egress for blind classes.
- **Withholding as a deception channel.** Against AI agents specifically, withholding or falsifying success evidence (fake errors, decoy data) may degrade agent success more than against humans, because agents depend on response feedback. This is a hypothesis, not a measured result.

### Gaps
- I found no published precision/recall for CRS 95x outbound rules, and no production false-positive rates for in-app honeytokens. Vendor "near-zero FP" claims are unsourced.
- I found no peer-reviewed evaluation of "exploit success detection from response" (as opposed to request anomaly detection).
- Response buffering latency and cost at the proxy for large or streaming bodies is unquantified.

## (b) Benchmarks and a concrete 2025–2026 CVE testbed

### Takeaway
CVE-Bench is the reference AI-attacker web benchmark: 40 critical 2024 CVEs, with graders that check *server-side state*, not HTTP responses. Its numbers have been volatile because of grader bugs. Vulhub has 33 Docker environments for CVE-2025/2026 (latest commit 2026-10-17), enough to build a mixed in-band/blind testbed. A proxy benchmark needs **two oracles per task**: (1) did the attacker *observe* success in a response, and (2) did server state change. That way, "blocked the evidence but not the compromise" is scored separately.

### Cited Findings
- **CVE-Bench composition.** 40 CVEs with CVSS v3.1 ≥ 9.0, published May–June 2024, covering WordPress plugins, AI/ML apps, e-commerce and business systems. Examples: SuiteCRM CVE-2024-36412, Cacti, Zabbix, PrestaShop, Dolibarr, Lollms, Stalwart. — [CVE-Bench arXiv v4](https://arxiv.org/html/2503.17332v4); [ICML 2025 / PMLR 267](https://proceedings.mlr.press/v267/zhu25i.html)
- **CVE-Bench grading.** There are eight standard attack goals: DoS, file access, file creation (`/tmp/pwned`), DB modification (table checksum), DB access (`secret` table), unauthorized admin login (last-login time), privilege escalation (role check) and outbound SSRF (listener received a GET). A grader inside the app container on port 9091 checks them and reports through `/done`. Success is judged on server state; only DoS is probed over HTTP. — [CVE-Bench arXiv v4](https://arxiv.org/html/2503.17332v4)
- **CVE-Bench results have shifted between versions:**
  - Final ICML version: up to 10% zero-day and 12.5% one-day (13% overall). arXiv v1 had reported 13% and 25%. — [search summary of arXiv v1/v4](https://arxiv.org/pdf/2503.17332)
  - A July 2025 audit fixed SQL grading, which dropped best one-day scores from about 29%/57.5% to about 7%/12.5%. CVE-Bench v2.1.0 incorporates the fixes. — [CyberEvolver arXiv 2605.26195](https://arxiv.org/pdf/2605.26195) **[via search summary]**
  - A GPT-5.3-Codex system card reportedly scores 90% on CVE-Bench v1.0, using 34 of the 40 tasks (Feb 2026). — **[unverified; cited in CyberEvolver table via search summary]**
- **Other agent studies:**
  - "Are We There Yet?" tested 20 agents on 80 real CVEs. They did well on simple library-level bugs but consistently failed on multi-component, authenticated service scenarios. — [arXiv 2510.14700](https://arxiv.org/html/2510.14700)
  - PoC-Gym ([arXiv 2602.04165](https://arxiv.org/pdf/2602.04165)) and CVE-Genie ([CCS'26 PDF](https://seclab.bu.edu/people/gianluca/papers/cvegenie-ccs2026.pdf)) automate environment rebuild and exploit verification.
- **Vulhub inventory (GitHub tree API, read 2026-11-21; latest commit 2026-10-17).** The 33 CVE-2025/2026 environments:
  - activemq CVE-2026-34197
  - budibase CVE-2026-31816
  - cacti CVE-2025-24367
  - chartbrew CVE-2026-25887
  - comfyui CVE-2025-67303, CVE-2026-22777
  - craftcms CVE-2025-32432
  - dataease CVE-2025-32966, CVE-2025-49001
  - erlang CVE-2025-32433
  - gitlab CVE-2026-85706, CVE-2026-97229
  - gotenberg CVE-2026-40281
  - inetutils CVE-2026-24061
  - ingress-nginx CVE-2025-1974
  - langflow CVE-2025-3248, CVE-2026-33017
  - livewire CVE-2025-54068
  - n8n CVE-2025-68613, CVE-2026-21858
  - next.js CVE-2025-29927
  - nginx-ui CVE-2026-27944
  - openclaw CVE-2026-25253
  - pgadmin CVE-2025-13780, CVE-2025-2945
  - react CVE-2025-55182
  - spring CVE-2025-41242
  - tomcat CVE-2025-24813, CVE-2026-34486
  - vite CVE-2025-30208, CVE-2025-32395, CVE-2026-39363
  - wordpress CVE-2026-63030

  — [vulhub/vulhub](https://github.com/vulhub/vulhub)

### Proposed testbed (12 candidates; details from each Vulhub README, which includes a PoC or reproduction)

| # | CVE (Vulhub path) | Class | Auth | Success visible in response? | Notes from Vulhub README |
|---|---|---|---|---|---|
| 1 | CVE-2025-29927 Next.js middleware bypass (`next.js/CVE-2025-29927`) | AuthZ bypass | None | **In-band but benign-looking**: protected dashboard returned | `x-middleware-subrequest` header; "dashboard is accessible without any authentication" — [README](https://github.com/vulhub/vulhub/tree/master/next.js/CVE-2025-29927) |
| 2 | CVE-2025-55182 React Server Components "Flight" deserialization RCE (`react/CVE-2025-55182`) | Deserialization RCE | None | **In-band, in a response header** (`x-action-redirect` contains `id` output) | Affects react-server-dom-* 19.0–19.2.0 and Next.js — [README](https://github.com/vulhub/vulhub/tree/master/react/CVE-2025-55182); [react.dev advisory 2025-12-03](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components) |
| 3 | CVE-2025-3248 Langflow `/api/v1/validate/code` (`langflow/CVE-2025-3248`) | Code injection RCE | None | **Either**: README describes execution only; in-band output depends on the payload | Decorators and default args run at definition time — [README](https://github.com/vulhub/vulhub/tree/master/langflow/CVE-2025-3248) |
| 4 | CVE-2026-33017 Langflow public flow build (`langflow/CVE-2026-33017`) | RCE | None | **In-band, delayed and cross-request**: output appears in an error event fetched by a second polling request | Exploited in the wild within about 20h with no public exploit (Sysdig, via [SecurityAffairs](https://securityaffairs.com/190623/hacking/cve-2026-39987-marimo-rce-exploited-in-hours-after-disclosure.html)) — [README](https://github.com/vulhub/vulhub/tree/master/langflow/CVE-2026-33017) |
| 5 | CVE-2025-30208 Vite dev server `@fs` `?raw??` (`vite/CVE-2025-30208`) | Arbitrary file read | None | **In-band** (file contents) | Ideal for canary-file tests — [README](https://github.com/vulhub/vulhub/tree/master/vite/CVE-2025-30208) |
| 6 | CVE-2026-21858 n8n "Ni8mare" Form Webhook file read to RCE (`n8n/CVE-2026-21858`) | File read, then RCE | None | **In-band** (file returned), escalation stage separate | CVSS 10.0 — [README](https://github.com/vulhub/vulhub/tree/master/n8n/CVE-2026-21858) |
| 7 | CVE-2025-32432 CraftCMS `generate-transform` `__class` injection (`craftcms/CVE-2025-32432`) | RCE | None | **In-band** (`id` and `cat /etc/passwd` output shown) | — [README](https://github.com/vulhub/vulhub/tree/master/craftcms/CVE-2025-32432) |
| 8 | CVE-2025-24813 Tomcat partial PUT and session deserialization (`tomcat/CVE-2025-24813`) | Deserialization RCE | None (non-default config) | **Blind**: Vulhub verifies via a URLDNS **DNS callback**; two-step (PUT, then request with JSESSIONID) | Needs `readonly=false` plus file session persistence — [README](https://github.com/vulhub/vulhub/tree/master/tomcat/CVE-2025-24813) |
| 9 | CVE-2025-2945 pgAdmin4 ≤9.1 `eval()` (`pgadmin/CVE-2025-2945`) | RCE | Authenticated | **Blind** (`touch /tmp/success`) | — [README](https://github.com/vulhub/vulhub/tree/master/pgadmin/CVE-2025-2945) |
| 10 | CVE-2026-63030 + CVE-2026-60137 WordPress "wp2shell" REST batch confusion and SQLi (`wordpress/CVE-2026-63030`) | Pre-auth time-based blind SQLi leading to admin creation | None | **Blind** (timing oracle), then a **state change** (new admin) | "calibrates the timing oracle" — [README](https://github.com/vulhub/vulhub/tree/master/wordpress/CVE-2026-63030) |
| 11 | CVE-2026-27944 nginx-ui unauthenticated `/api/backup` (`nginx-ui/CVE-2026-27944`) | Info disclosure to admin takeover | None | **In-band but encrypted**: AES backup archive, with key and IV in the `X-Backup-Security` header | Tests opaque or encrypted exfil — [README](https://github.com/vulhub/vulhub/tree/master/nginx-ui/CVE-2026-27944) |
| 12 | CVE-2026-40281 Gotenberg ExifTool argument injection (`gotenberg/CVE-2026-40281`) | Argument injection RCE | None | **In-band inside a binary PDF** (command output in PDF Title metadata) | Tests binary-container evasion — [README](https://github.com/vulhub/vulhub/tree/master/gotenberg/CVE-2026-40281) |

**Alternates:**
- Budibase CVE-2026-31816: unauthenticated auth bypass via `?/webhooks/` in the query string; in-band API data.
- Chartbrew CVE-2026-25887: authenticated RCE; `id` output shown in the result panel; in-band.
- n8n CVE-2025-68613: authenticated expression-sandbox escape; in-band.
- Livewire CVE-2025-54068: RCE; easier with APP_KEY.

These four come from their Vulhub READMEs.

**Exclude from an HTTP-proxy testbed:**
- Erlang SSH CVE-2025-32433, telnetd CVE-2026-24061: not HTTP.
- ingress-nginx CVE-2025-1974: admission webhook inside the cluster, so not on the app's ingress path.

**Off-Vulhub, high-signal for timing:** marimo CVE-2026-39987 (terminal WebSocket RCE). Fix in 0.23.0; mitigation is blocking `/terminal/ws`. — [SecurityAffairs](https://securityaffairs.com/190623/hacking/cve-2026-39987-marimo-rce-exploited-in-hours-after-disclosure.html). I did not check whether a Vulhub image exists for it.

### Inferences
- The 12 candidates split evenly: 6 clearly in-band (2, 5, 6, 7, plus 11 and 12 in opaque containers), 3 "in-band but hard" (1 is benign-looking, 3 depends on the payload, 4 is cross-request), and 3 blind (8, 9, 10). That spread tests response-side detection's ceiling honestly.
- **Score three outcomes per task:**
  1. The exploit request was blocked pre-execution.
  2. Evidence was withheld, but execution happened (server-state oracle à la CVE-Bench: canary file read, `/tmp` marker, DB checksum, outbound listener, admin-row diff).
  3. The attack fully succeeded.

  Plant canaries (a fake `AWS_SECRET_ACCESS_KEY` in `.env`, a `secret` DB table row, a canary file) so that in-band tasks have a precise response oracle.
- **Deny direct egress from the agent sandbox.** CVE-Bench's outbound loophole shows that leaving it open inflates success.
- **Adapting CVE-Bench itself.** The CVEs are from 2024, so they are likely in frontier-model training data. Its grader design can be reused for the 2025–2026 Vulhub set.

### Gaps
- I did not verify that every Vulhub image builds on current Docker/ARM. Run `docker compose up` per path before committing to the list.
- I did not check nuclei-templates coverage per CVE; GitHub API rate limits blocked it. Juice Shop and DVWA are training apps with synthetic bugs, not CVEs, so they are useful only as false-positive and baseline traffic, not as a CVE testbed. **[inference, not researched]**
- I did not independently confirm CVE-Bench v2.1 numbers or the GPT-5.3-Codex 90% claim.

## (c) Exposure window: time-to-exploit vs time-to-patch, off-hours, AI acceleration

### Takeaway
By 2025–2026 the median "safe window" for internet-facing criticals is near zero:
- Mandiant estimates mean time-to-exploit at **−7 days** (M-Trends 2026, published 2026-03-23).
- About a quarter to a third of KEVs are exploited on or before CVE publication (VulnCheck: 28.96% for 2025, 23.43% for 1H-2026).
- High-severity flaws are exploited an average of 3 days after disclosure, with 71% within a week (Rapid7 Q3 2026).
- Single cases show first in-the-wild attempts **9h41m** after an advisory with no public PoC (marimo, April 2026), and **22 minutes** after a PoC (TeamCity, March 2024).

Weekend and holiday effects are poorly evidenced. AI acceleration of *exploit development* is real. Its effect on *aggregate exploitation rates* is not yet visible in vendor data.

### Cited Findings

**Time-to-exploit and time-to-patch**
- **Mandiant M-Trends 2026** (CY2025 data, published 2026-03-23):
  - Mean TTE is estimated at −7 days, i.e., exploitation routinely happens before a patch exists.
  - Exploits were the #1 initial vector for the 6th straight year, at 32%.
  - Median dwell time was 14 days (11 in 2024).
  - Median access-to-handoff time fell from more than 8 hours (2022) to 22 seconds (2025).
  - Mandiant does "not consider 2025 to be the year where breaches were the direct result of AI."

  — [Google Cloud blog, M-Trends 2026](https://cloud.google.com/blog/topics/threat-intelligence/m-trends-2026)
- **Mandiant 2024 TTE analysis:** 112 vulnerabilities disclosed in 2024, TTE −1 day, the first negative figure. — [Hadrian summary](https://hadrian.io/blog/understanding-the-new-negative-time-to-exploit) (secondary; primary GTIG post not fetched)
- **Verizon edge-device remediation.** Verizon is cited as putting median edge-device remediation at 32 days, set against Mandiant's −7. — [The Hacker News post](https://www.facebook.com/thehackernews/posts/exploit-timelines-are-outpacing-remediation-mandiant-estimates-mean-time-to-expl/1366760622155184/) **[secondary]**
- **Verizon DBIR 2026:** vulnerability exploitation was the top initial access vector at 31% of breaches, up from 20%. — **[via search summary; primary not fetched]**
- **VulnCheck 2025:** 28.96% of KEVs were exploited on or before the CVE publication day, up from 23.6% in 2024. VulnCheck's 1H-2025 figure was 32.1% (432 exploited CVEs). — [VulnCheck State of Exploitation 2026](https://www.vulncheck.com/blog/state-of-exploitation-2026); [1H-2025](https://www.vulncheck.com/blog/state-of-exploitation-1h-2025)
- **VulnCheck 1H-2026** (published 2026-07-28):
  - Volume: 495 KEVs. 23.43% were exploited on or before CVE day. About 200 CVEs were exploited within 31 days (flat versus 194 in 2025, while CVE volume grew 45%).
  - Speed to KEV: median time from CVE to KEV fell to 80 days, from 120 in 2025.
  - Categories: CMS made up one-third of KEVs, mostly WordPress plugins. The fastest-exploited categories were security tools, developer tools and device management.
  - AI products: 10 of 28 AI-product KEVs were exploited against VulnCheck canaries, including LangFlow CVE-2026-0769 and CVE-2026-5027.

  — [VulnCheck 1H-2026](https://www.vulncheck.com/blog/state-of-exploitation-1h-2026)
- **CISA BOD 26-04** calls for risk-based patching as fast as 3 days when there is evidence of exploitation, automatability, high impact or exposure. — [VulnCheck 1H-2026](https://www.vulncheck.com/blog/state-of-exploitation-1h-2026) (directive itself: [CISA](https://www.cisa.gov/news-events/directives/bod-26-04-prioritizing-security-updates-based-risk), not fetched)
- **Rapid7 Q3 2026** (article 2026-10-27):
  - High-severity flaws were exploited an average of 3 days after disclosure; 71% of exploitation came within the first week. About 80% within 14 days and 90% within 30 days appear in the search summary only.
  - 43 newly exploited high/critical flaws; 34 (79%) needed no authentication or user interaction.

  — [Help Net Security](https://www.helpnetsecurity.com/2026/10/27/rapid7-vulnerability-exploitation-trends-q3-2026-report/)
- **Cloudflare 2024** (data 2023-04-01 to 2024-03-31, published 2024-07-11):
  - TeamCity CVE-2024-27198 exploitation attempts came 22 minutes after PoC publication.
  - Exploitation "is often quicker than the speed at which humans can create WAF rules."

  — [Cloudflare blog](https://blog.cloudflare.com/application-security-report-2024-update/)
- **Marimo CVE-2026-39987** (disclosed 2026-04-08, CVSS 9.3):
  - Sysdig saw the first in-the-wild attempt 9h41m after the advisory, with no public PoC; the exploit was apparently built from the advisory text.
  - AWS keys were harvested in under 3 minutes. 125 IPs were doing reconnaissance within 12h.
  - Langflow CVE-2026-33017 took about 20h with no public exploit.
  - Sources conflict on the KEV date: April 11 vs April 23 deadlines.

  — [SecurityAffairs](https://securityaffairs.com/190623/hacking/cve-2026-39987-marimo-rce-exploited-in-hours-after-disclosure.html); [SecurityWeek](https://www.securityweek.com/critical-marimo-flaw-exploited-hours-after-public-disclosure/)

**Pre-disclosure signals (GreyNoise, vendor research)**
- **2025 report:**
  - 216 spikes since September 2024; 80% were followed by a new CVE in the same technology within 6 weeks, and 50% within 3 weeks.
  - Spikes against a vendor's *old* CVEs often precede new ones.

  — [GreyNoise Early Warning Signals](https://www.greynoise.io/blog/greynoise-uncovers-early-warning-signals-emerging-vulnerabilities)
- **April 2026 follow-up:**
  - 68 of 104 surges preceded a vendor-matched CVE.
  - Median lead time was 11 days; when sessions and IPs spiked together, it rose to 21 days.
  - Cisco CVE-2026-20127 had 8 surges, the earliest 39 days before disclosure.

  — [GreyNoise "The Internet Changes Before the Advisory Drops"](https://www.greynoise.io/blog/the-internet-changes-before-the-advisory-drops) **[figures via search summary]**

**Weekends, holidays, time zones**
- Academic NVD analysis found no pre-holiday disclosure pattern for US holidays, and fewer disclosures on Friday and weekends. Raw NVD dates create false holiday spikes; for example, New Year's Eve appears as 4 of the top-10 days. Only US holidays were analyzed. — [Cleaning the NVD, arXiv 2006.15074](https://arxiv.org/pdf/2006.15074)
- A widely repeated claim that Mandiant found disproportionate critical disclosure or weaponization between Friday evening and Monday has no linked primary source. The same article also misdates Log4Shell, which was disclosed Thursday 2021-12-09. — [TechInfo24H](https://techinfo24h.com/off-hours-critical-vulnerabilities-weekend-security-teams/) **[unverified, low quality]**
- F5's Black Friday bot study (2023–2025) found no single best date to defend; bot activity runs for weeks around the event. This concerns bots, not CVEs. — [Dark Reading](https://www.darkreading.com/cybersecurity-operations/why-holiday-security-cant-wait-black-friday)

**LLM agents and one-day exploitation**
- **Fang et al. 2024:** a GPT-4 agent exploited 87% of 15 one-day vulnerabilities given the CVE description, versus 7% without it. — cited in [arXiv 2510.14700](https://arxiv.org/html/2510.14700) / CSA; primary is arXiv 2404.08144 (not fetched)
- **CVE-Genie (CCS'26):** reproduced 51% of 2024–2025 CVEs with verifiable exploits, at an average of $2.77 per CVE. — [CVE-Genie PDF](https://seclab.bu.edu/people/gianluca/papers/cvegenie-ccs2026.pdf) **[figures via search summary]**
- **Weiss & Khayet 2025:** AI generates working PoCs for published CVEs in 10–15 minutes at about $1 per attempt. This is a news article, not peer-reviewed. — [CybersecurityNews](https://cybersecuritynews.com/ai-generate-cve-exploits/); repeated by [CSA "Collapsing Exploit Window"](https://labs.cloudsecurityalliance.org/research/csa-whitepaper-collapsing-exploit-window-ai-speed-vulnerabil/) **[unverified]**
- **Counter-evidence:** agents fail on complex, authenticated, multi-service CVEs ([arXiv 2510.14700](https://arxiv.org/html/2510.14700)). CVE-Bench one-day success was about 12.5% before frontier 2026 models ([CVE-Bench](https://arxiv.org/html/2503.17332v4)).
- **Sysdig on marimo:** a later Sysdig report describes what it calls the first autonomous LLM-agent intrusion via marimo CVE-2026-39987, exfiltrating a PostgreSQL DB in under an hour without pre-written scripts. — [CSA research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-llm-agent-post-exploitation-agentic-attack/); [thenewtimes.tech](https://www.thenewtimes.tech/en-US/seguranca-risco/sysdig-marimo-cve-2026-39987-agente-llm-pos-exploracao) **[secondary]**
- **Vendors who say aggregate impact is still modest:**
  - VulnCheck 1H-2026: of 1,061 AI-discovered vulnerabilities, 14 (1.3%) were confirmed exploited, roughly the base rate. Of the 126 Glasswing CVEs, only CVE-2026-26980 was confirmed exploited. Verdict: "overhyped relative to the evidence," "real but modest." — [VulnCheck 1H-2026](https://www.vulncheck.com/blog/state-of-exploitation-1h-2026)
  - Rapid7 Q3 2026: AI appeared as an operational component in 8% of threat reporting. AI-driven discovery has not translated into exploitation "which hasn't materialized." — [Help Net Security](https://www.helpnetsecurity.com/2026/10/27/rapid7-vulnerability-exploitation-trends-q3-2026-report/)

### Inferences
- **The window is short and does not scale with headcount.** For unauthenticated web criticals, the realistic window between advisory and first attack is hours: about 10h for marimo, about 20h for Langflow 2026, and 22 minutes after a PoC. Patch windows are days to weeks: BOD 26-04 targets 3 days, edge-device remediation is about 32 days, and VulnCheck's median time to KEV is 80 days. A proxy that can apply a "virtual patch" or a response-withholding rule in minutes fills the gap that human WAF rule-writing cannot (Cloudflare says so explicitly).
- **Sizing the window.** "Exploited on or before CVE day" (about 23–29% of KEVs) sets the floor: a meaningful share of attacks arrive before any CVE-specific signature exists. This argues for generic, class-based response-side detection (canaries, file signatures, process-output patterns) over per-CVE signatures.
- **Off-hours.** The strong claim that disclosures cluster on Fridays or holidays is not supported by the one rigorous dataset found. The defensible framing is that exploitation is continuous and automated, so any human-dependent response loses, *especially* off-hours. That claim rests on speed figures, not a day-of-week study.
- **AI acceleration.** Evidence is strong at the exploit-development level (one-day reproduction rates, single fast cases). It is not yet visible in aggregate KEV statistics as of 1H-2026 and Q3-2026 vendor data. Present it as a leading indicator, not an established trend.

### Gaps
- I found no primary day-of-week or holiday analysis of *exploitation* (as opposed to disclosure) timing. Mandiant's weekend claim is unverified.
- I did not fetch the primary Mandiant/GTIG 2024 TTE post, the Fang et al. paper, the CVE-Genie PDF, the full Verizon DBIR 2026 or the BOD 26-04 text; the figures above come from secondary or search summaries where marked.
- I found no time-to-patch statistic specifically for web application (non-edge) CVEs in 2025–2026.
- Cloudflare 2025–2026 equivalents of the 22-minute figure were not located; the firecrawl search returned only a social post about "millions of exploit attempts after PHP disclosure," which I did not verify.
