# Full-Transaction / Response-Side Exploit Confirmation and Blocking in WAFs (Prior Art)

Scope: which products inspect the upstream RESPONSE for evidence a request-side exploit actually succeeded, and withhold/alter that response before it reaches the attacker. Current as of November 2026. Self-hosted vs SaaS/edge-only noted per product, since the team's prototype is self-hosted.

Bottom line up front: Response-side inspection is NOT new. Two distinct, long-standing capabilities already exist in the market: (1) response-body data-leakage/masking (F5 Data Guard, Imperva, OWASP CRS RESPONSE-950 family, Oracle, Radware — some a decade+ old), and (2) response-aware login-outcome tracking (AWS WAF ATP/ACFP). What is genuinely new (Oct 21, 2026) is Cloudflare framing request↔response correlation as "exploit confirmation" with a dedicated "response firewall" — but even that explicitly does NOT allow raw response-body matching in custom rules, is edge/SaaS-only, and does NOT correlate across multiple requests. No mainstream product ships cross-request (polling-based) exploit correlation as a WAF feature.

---

## Q1: Cloudflare "full transaction / response" WAF — what it inspects, rules, exclusions, deployment model

### Takeaway
On 2026-10-21 Cloudflare GA'd "full transaction detection" (correlate each request with its response to confirm exploitation) plus a "response firewall" of response custom rules that block the origin reply before it reaches the attacker. It is edge/SaaS-only (not self-hostable), correlates only within a single transaction (no cross-request), and critically does NOT support matching on the raw response body in custom rules.

### Cited Findings
- Announced and GA on 2026-10-21: two new capabilities — "full transaction detections" and "response rules." Detections "evaluate each HTTP request alongside its response to identify evidence of exploitation." — [Cloudflare blog: Introducing full transaction detection](https://blog.cloudflare.com/full-transaction-waf/)
- Mechanism: a suspicious request alone may be harmless, but if the server's reply suggests the exploit worked, Cloudflare blocks that response before it reaches the attacker. Detections "attach metadata to the request and response"; rules "decide what to do." Detections and rules are "separate by design." — [Cloudflare blog](https://blog.cloudflare.com/full-transaction-waf/)
- Worked example: SQLi signature in request + origin returns 500 or 404 → low confidence; origin returns 200 OK with a body matching a "sensitive data" signature → flagged as "Successful Exploit Confirmation." — [Cloudflare blog, via search synthesis](https://blog.cloudflare.com/full-transaction-waf/); [Prophet Security: How to investigate WAF alerts](https://www.prophetsecurity.ai/blog/how-to-investigate-waf-alerts)
- Response detection fields for paying customers: `cf.waf.signature.response.confidence`, `cf.waf.signature.response.categories`, `cf.waf.signature.response.ref` (up to 10 signature reference IDs). Still "rolling out" to accounts at announcement. — [Cloudflare blog](https://blog.cloudflare.com/full-transaction-waf/)
- Response custom rule match fields (from docs): request fields (same entitlements as WAF custom rules) PLUS response fields `http.response.code`, `http.response.content_type.media_type`, `http.response.headers` (+names/values, raw variants), `http.response.set_cookies`. — [Cloudflare docs: Response firewall](https://developers.cloudflare.com/waf/response-firewall/)
- EXPLICIT EXCLUSION — no raw response-body matching: rules "do not support matching on `http.response.body.raw`." The blog states "Creating rules on the response body is not yet available." — [Cloudflare docs: Response firewall](https://developers.cloudflare.com/waf/response-firewall/); [Cloudflare blog](https://blog.cloudflare.com/full-transaction-waf/)
- EXPLICIT LIMITATION — blocking a response "cannot undo actions already performed at the origin" (does not reverse code that already ran). — [Cloudflare blog](https://blog.cloudflare.com/full-transaction-waf/)
- Plans/limits: GA to ALL plans including Free. Every plan gets up to THREE response custom rules per zone (disabled rules count toward the limit); at most ONE rule may use the `execute` action, leaving two slots for `block`/`log`. All customers get the "Cloudflare Managed Response Firewall Default" ruleset (one-click deploy, scopable to paths, runs on every request by default). Free gets managed detections for high-profile vulns; paying customers get the richer catalog + the `cf.waf.signature.response.*` fields. — [Cloudflare docs](https://developers.cloudflare.com/waf/response-firewall/); [Cloudflare blog](https://blog.cloudflare.com/full-transaction-waf/)
- First managed use case: php2shell. Managed protections live from 2026-10-21 03:02 UTC, blocking by default on free + paid WAF. — [Cloudflare blog](https://blog.cloudflare.com/full-transaction-waf/); [Cloudflare: PHP vulnerabilities WAF protection](https://blog.cloudflare.com/php-vulnerabilities-waf-protection/)
- Deployment: edge-based, runs only on traffic proxied through Cloudflare; managed in dashboard under Security > Security Rules. NOT self-hostable. — [Cloudflare blog](https://blog.cloudflare.com/full-transaction-waf/)
- Related prior Cloudflare capability it builds on: "Attack Signature Detection" / always-on detections (request-side), which decoupled detection from action to eliminate the log-vs-block trade-off. — [Cloudflare blog: Always-on detections](https://blog.cloudflare.com/attack-signature-detection/)
- Separate, older Cloudflare response feature: "Sensitive Data Detection" managed ruleset identifies data leaks from origin responses, but handles text/HTML/JSON/XML up to 1 MB, does NOT inspect compressed response bodies, and requires an Enterprise plan. — [Cloudflare docs: Sensitive Data Detection](https://developers.cloudflare.com/waf/managed-rules/reference/sensitive-data-detection/)

### Inferences
- The feature's novelty is positioning/packaging ("exploit confirmation," one-click managed "response firewall" on Free), not the underlying ability to read responses — Cloudflare itself already had Sensitive Data Detection on responses (Enterprise-only) before this.
- For a self-hosted product, Cloudflare is not a direct competitor on deployment model; the differentiators a self-hosted tool can claim against Cloudflare specifically are: (a) raw response-BODY matching (Cloudflare explicitly lacks it), (b) more than 3 response rules, (c) cross-request correlation, (d) running on-prem/non-proxied traffic.

### Gaps
- Exact rollout percentage / regional availability of the `cf.waf.signature.response.*` fields not quantified beyond "rolling out."

---

## Q2: AWS WAF, F5, Imperva, Akamai, Fastly, Azure, ModSecurity/Coraza/CRS — do they inspect response bodies for exploit evidence and block on it?

### Takeaway
Response-body inspection is widespread but split into two buckets: data-leakage/PII masking (F5 Data Guard, Imperva Sensitive Information Leakage Protection, OWASP CRS RESPONSE-950 family, Oracle, Radware KWAAP) and login-outcome tracking (AWS WAF ATP/ACFP). None is framed as general "exploit succeeded → block the response" across arbitrary signatures the way the team intends, and most carry hard limits (size caps, byte-range bypass, masking-not-blocking, CloudFront-only, Enterprise-only).

### Cited Findings

**AWS WAF (SaaS/managed; CloudFront/ALB/API GW/AppSync)**
- Fraud Control ATP (Account Takeover Prevention) and ACFP (Account Creation Fraud Prevention) rule groups inspect ORIGIN RESPONSES to count login/account-creation success vs failure per IP/session, then label/mitigate. Response inspection added for CloudFront origin responses in Feb 2023. — [AWS what's new (2023-02)](https://aws.amazon.com/about-aws/whats-new/2023/02/aws-waf-fraud-control-account-takeover-prevention-cloudfront-origin-responses/)
- Response inspection is available ONLY in web ACLs protecting Amazon CloudFront distributions. — [AWS docs, via search](https://docs.aws.amazon.com/waf/latest/APIReference/API_ResponseInspection.html)
- You configure exactly ONE response component to inspect: body, header, JSON, or status code (cannot combine). — [AWS API: ResponseInspection](https://docs.aws.amazon.com/waf/latest/APIReference/API_ResponseInspection.html)
- Body inspection (`ResponseInspectionBodyContains`): inspects first 65,536 bytes (64 KB); match on SuccessStrings/FailureStrings — exact, case-sensitive substring match, 1–5 strings each. — [AWS API: ResponseInspectionBodyContains](https://docs.aws.amazon.com/waf/latest/APIReference/API_ResponseInspectionBodyContains.html)
- LIMIT: this is narrowly scoped to login/account-creation outcomes (credential stuffing / brute force / fake accounts), NOT a general exploit-confirmation engine. General AWS WAF custom rules cannot match on arbitrary response bodies. — [AWS API docs](https://docs.aws.amazon.com/waf/latest/APIReference/API_ResponseInspection.html)

**F5 BIG-IP ASM / Advanced WAF (self-hostable appliance/VE, also BIG-IP Next; also SaaS via Distributed Cloud)**
- "Data Guard" feature prevents responses from exposing sensitive info by masking (response scrubbing) — scans response text for things like credit card / SSN / email / phone, replaces with asterisks, OR blocks the entire response. Raises "Data Guard: Information Leakage Detected" violation. — [F5 techdocs: Protecting Sensitive Data with Data Guard](https://techdocs.f5.com/kb/en-us/products/big-ip_asm/manuals/product/asm-implementations-11-5-0/9.html); [F5 Cloud Docs: Data Guard](https://clouddocs.f5.com/bigip-next/latest/waf_management/waf_data_guard.html)
- Custom PCRE patterns supported for other sensitive data; from v14.0+ can mask positional params, HTTP headers, cookie values. Supports gzip-compressed responses when Mask Data is enabled. — [Nokron: Data Guard in F5 ASM/AWAF](https://docs.nokron.net/waf-f5/big-ip-application-security-manager/sensitive-data-masking-scrubbing-data-guard-in-f5-asm-awaf)
- LIMIT: Data Guard is DLP-oriented (mask known sensitive patterns), not generic exploit-evidence/command-output confirmation; it is pattern/PII driven, not request↔response exploit correlation. — [F5 techdocs](https://techdocs.f5.com/kb/en-us/products/big-ip_asm/manuals/product/asm-implementations-11-5-0/9.html)

**Imperva (SaaS Cloud WAF + on-prem SecureSphere)**
- "Sensitive Information Leakage Protection" (Cloud WAF) inspects RESPONSES for exposed sensitive data (e.g., API responses returning full PANs, over-sharing error messages, debug logs) and auto-remediates by masking the first 12 digits of card numbers (PCI DSS). — [Imperva: The hidden threat / sensitive information leakage](https://www.imperva.com/blog/the-hidden-threat-how-sensitive-information-leakage-puts-your-business-at-risk/)
- For php2shell specifically, Imperva's protection "inspects both request patterns and abnormal response headers, the place where leaked memory would show up" — explicit acknowledgment that request-only controls "cannot see data leaving." — [Imperva: Why AI-found vulnerabilities demand protection](https://www.imperva.com/blog/why-ai-found-vulnerabilities-demand-protection-thats-already-on/)
- Imperva AI Application Security inspects LLM model OUTPUTS to block/mask PII and prevent system-prompt leakage ("inspecting data after application-level modifications"). — [Imperva: AI Application Security](https://www.imperva.com/products/ai-application-security/)

**Akamai (SaaS/edge)**
- Documentation surfaced covers REQUEST body inspection limits (8/16/32 KB). No primary doc surfaced for general response-body exploit-evidence inspection/blocking in App & API Protector; Oracle (below) and F5/Imperva are the clearer response-side players. — [Akamai techdocs: request body advanced settings](https://techdocs.akamai.com/application-security/reference/put-advanced-settings-request-body)

**Fastly Next-Gen WAF (Signal Sciences) — self-hostable module+agent, also edge**
- Blocking is driven by response CODE (blocks any response code in range 300–599, configurable min 301 / max 599); default blocked-request response is 406 Not Acceptable. Module sits in nginx/Apache/IIS; agent over Unix socket. Integrates with Envoy/Istio/Kong/HAProxy. — [Fastly docs: module config](https://www.fastly.com/documentation/guides/next-gen-waf/setup-and-configuration/module-agent-deployment/module-config/); [Fastly: agent response codes](https://docs.fastly.com/en/ngwaf/troubleshooting-agent-response-codes)
- No primary doc surfaced showing Fastly NGWAF inspects response BODY content for exploit evidence; surfaced capability is response-code based, not body-signature based. — [Fastly docs](https://www.fastly.com/documentation/guides/next-gen-waf/setup-and-configuration/module-agent-deployment/module-config/)
- Caveat: reported fail-open in Kubernetes sidecar deployments before rules load (vendor disputes; CVE pending). — [Full Disclosure, seclists 2026-Nov](https://seclists.org/fulldisclosure/2026/Nov/40)

**Azure WAF (Application Gateway / Front Door; SaaS/managed)**
- Documentation surfaced covers REQUEST body inspection (on by default, configurable inspection limit, default 15 KB / independently configurable on CRS 3.2+). No native general response-body inspection/blocking feature surfaced; Azure relies on CRS, and CRS response rules only fire if the engine has response-body access enabled. — [Microsoft Learn: WAF request size limits](https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/application-gateway-waf-request-size-limits); [Azure networking blog: size enforcement & inspection limits](https://techcommunity.microsoft.com/blog/azurenetworksecurityblog/independent-configuration-of-size-enforcement-and-inspection-limits-in-applicati/4235543)

**ModSecurity / OWASP CRS (self-hosted)**
- `SecResponseBodyAccess` enables response-body buffering/inspection; DEFAULT is Off in both ModSecurity v2 and v3. Required to inspect HTML responses and implement response blocking. — [ModSecurity Reference Manual v3.x](https://github.com/owasp-modsecurity/ModSecurity/wiki/Reference-Manual-(v3.x))
- CRS ships dedicated outbound data-leakage rule files: RESPONSE-950 (generic sensitive-data leaks), 951 (SQL errors), 952 (Java stack traces), 953 (PHP errors), 954 (IIS errors), 955 (web-shell output), 956 (Ruby on Rails errors). — [Netnea: Including OWASP CRS](https://www.netnea.com/cms/apache-tutorial-7_including-modsecurity-core-rules/); [CRS RESPONSE-950 example (fastly/waf_testbed)](https://github.com/fastly/waf_testbed/blob/master/templates/default/RESPONSE-950-DATA-LEAKAGES.conf.erb)
- KEY LIMIT: because `SecResponseBodyAccess` is Off by default, the RESPONSE-950..956 rules are effectively inert unless an operator explicitly turns it On; a backend spilling a DB error then returns a clean-looking 200. — [ModSecurity Reference Manual v3.x](https://github.com/owasp-modsecurity/ModSecurity/wiki/Reference-Manual-(v3.x)); [coraza-rs issue #127](https://github.com/networking-incubator/coraza-rs/issues/127)
- Byte-range bypass: requesting only a portion of the response body easily evades data-leakage AND web-shell/backdoor response rules. — [SicuraNext: Response Filter DoS](https://blog.sicuranext.com/response-filter-denial-of-service-a-new-way-to-shutdown-a-website/)

**Other vendors (response-side DLP, for completeness)**
- Oracle WAF: numerous response-body leakage protection rules (e.g., Mastercard/Visa PAN leakage site→user, SSN/SIN/CPF). — [Oracle WAF supported protection rules](https://docs.oracle.com/en-us/iaas/Content/WAF/Reference/protectionruleids.htm)
- Radware KWAAP: Data Leakage Protection (DLP) module scans HTTP reply bodies for configured patterns; Active mode redacts with 'X'. — [Radware KWAAP DLP](https://support.radware.com/app/answers/answer_view/a_id/1028812/~/radware-kwaap-data-leakage-protection)

### Inferences
- The industry's response-side prior art is overwhelmingly DLP/masking (hide sensitive data leaving) or auth-outcome counting — NOT "did this specific injected request produce command output / canary evidence proving code execution, and withhold that specific response." Cloudflare's Oct 2026 "exploit confirmation" framing is the closest commercial match, and it still can't match the raw body.
- A self-hosted tool that does generic request↔response exploit-evidence correlation WITH raw response-body matching sits in a genuine gap between CRS (body matching but no built-in request↔response exploit correlation and off-by-default) and Cloudflare (correlation + managed exploit signatures but no raw-body matching and edge-only).

### Gaps
- No primary Akamai or Azure doc found for a dedicated response-BODY exploit-evidence inspection/blocking feature (as opposed to request-body or CRS-dependent). Likely they rely on CRS/managed rulesets; could not confirm a first-party response-body feature.
- "Canary tokens / command-output confirmation" as an explicit productized WAF response signature: not found in any vendor's primary docs. AWS uses success/failure login strings; CRS 955 matches web-shell output patterns; none described as canary/command-output exploit confirmation.

---

## Q3: Does any self-hosted / open-source proxy ship response-body exploit-evidence blocking out of the box?

### Takeaway
Response-body blocking is POSSIBLE on self-hosted proxies but is never on "out of the box": ModSecurity/Coraza default `SecResponseBodyAccess` to Off, and the Coraza-Envoy/WASM plugin additionally requires FULL mode to even pass the response phase. nginx/Caddy/Envoy/Istio have no native response-body exploit-evidence blocking; they get it only by bolting on Coraza/ModSecurity and explicitly enabling it.

### Cited Findings
- Coraza supports response-body inspection via `SecResponseBodyAccess On`; rules run in response-headers and response-body phases. Recommended config (`coraza.conf-recommended`) sets it On, noting without it Coraza "cannot see response content looking for errors and data leakage." — [Coraza coraza.conf-recommended](https://github.com/corazawaf/coraza/blob/main/coraza.conf-recommended)
- In the Coraza Envoy/WASM plugin, operating modes (REQUEST_ONLY default, FULL, RESPONSE_ONLY deprecated) only decide which phases are passed to Coraza; FULL is required for response-phase evaluation, but response-body inspection STILL requires `SecResponseBodyAccess On` — neither alone suffices. — [Built On Envoy: coraza-waf](https://builtonenvoy.io/extensions/coraza-waf/); [coraza-rs issue #127](https://github.com/networking-incubator/coraza-rs/issues/127)
- The "Built On Envoy" example intentionally sets `SecResponseBodyAccess Off` ("not needed for the example") — illustrating that response inspection is opt-in and commonly left off in default/example deployments. — [Built On Envoy](https://builtonenvoy.io/extensions/coraza-waf/)
- Real bug class from off-by-default: in coraza-rs Envoy fixtures the CRS policy didn't set the directive, so RESPONSE-950..956 silently couldn't fire; a fix enabled it within the WASM ceiling. — [coraza-rs issue #127](https://github.com/networking-incubator/coraza-rs/issues/127); [coraza-rs PR #129](https://github.com/networking-incubator/coraza-rs/pull/129)
- nginx + Fastly NGWAF module: blocking is response-CODE based; return/redirect directives can cause nginx to skip the WAF phase entirely (requests not inspected). — [Fastly: agent response codes](https://docs.fastly.com/en/ngwaf/troubleshooting-agent-response-codes)
- Performance cost: `SecResponseBodyAccess On` makes Coraza buffer and scan full response bodies; memory must be monitored, and size caps (e.g., SecResponseBodyLimit) apply. — [Coraza coraza.conf-recommended](https://github.com/corazawaf/coraza/blob/main/coraza.conf-recommended)

### Inferences
- "Out of the box" for the open-source stack means request-side only. Response-body exploit-evidence blocking requires deliberate, non-default configuration AND accepting buffering/memory/latency costs — a friction point the team's product could legitimately claim to remove or make safe-by-default.
- None of these open-source proxies perform request↔response EXPLOIT CORRELATION (confidence that an exploit succeeded); they at best run static outbound signatures (CRS RESPONSE-95x). The correlation/confirmation layer is the differentiator, not raw response reading.

### Gaps
- Caddy: no specific primary source surfaced; Caddy gains WAF via a Coraza module (coraza-caddy), so the same off-by-default/opt-in response-body story applies by inheritance, but this was not separately confirmed in a primary doc this session.

---

## Q4: Does any product correlate request suspicion with response evidence across MULTIPLE requests (cross-request / polling-based exploits)?

### Takeaway
No surfaced WAF correlates a single transaction's suspicion with response evidence appearing in LATER/SEPARATE requests (the polling/async pattern). All "exploit confirmation" products (Cloudflare full-transaction, Contrast ADR+WAF) correlate within ONE request↔response pair. Broader "WAF event correlation" exists but links request-side events over time/IP, not request-suspicion-to-later-response-evidence. This appears to be a real gap.

### Cited Findings
- Cloudflare full transaction detection correlates "each HTTP request alongside its response" — single transaction; no cross-request correlation described anywhere in blog or docs. — [Cloudflare blog](https://blog.cloudflare.com/full-transaction-waf/); [Cloudflare docs: Response firewall](https://developers.cloudflare.com/waf/response-firewall/)
- Contrast Security "Confirmed WAF alert (ADR + WAF)": correlates a WAF request alert with code-level (ADR) exploit confirmation of the SAME request, using a tight 5-minute window because both see the same request nearly simultaneously — still single-request correlation, just across two sensors. — [Contrast: Confirmed WAF alert (ADR + WAF)](https://docs.contrastsecurity.com/en/5-5-confirmed-waf-alert--adr---waf-.html)
- "WAF event correlation" (e.g., Prophaze) links multiple threat signals across time, IPs, endpoints and behaviors to reveal multi-stage attacks — but this is request-event correlation, not request-suspicion ↔ later-response-evidence. — [Prophaze: What is WAF event correlation](https://prophaze.com/learn/waf/what-is-waf-event-correlation/)
- Known hard problem even for single-transaction keying: when the same client/Host/URI issues multiple requests in the same second, a later rejection's signature can be mis-attributed to an earlier successful request; recommended fix is exact immutable per-transaction correlation keys. — [ingressi issue #397](https://github.com/ingres-si/ingressi/issues/397)
- AWS ATP/ACFP do aggregate across requests (counting success/failure per IP/session over time) — the closest thing to multi-request response-aware logic — but it is scoped to login/account-creation outcomes, not general exploit evidence. — [AWS what's new 2023-02](https://aws.amazon.com/about-aws/whats-new/2023/02/aws-waf-fraud-control-account-takeover-prevention-cloudfront-origin-responses/)

### Inferences
- The cross-request / polling-based exploit-confirmation pattern (request A plants/triggers, evidence surfaces in response to request B, or via an out-of-band poll) is NOT covered by any mainstream WAF's response feature found. AWS fraud control is the only multi-request response-aware mechanism and it is domain-specific (auth). This is the strongest "where the commercial state of the art stops" line for the team.
- For agent/tool-call defense specifically (the team's apparent domain), the gap is even wider: no surfaced WAF reasons about an exploit that completes across a sequence of correlated requests/responses rather than one transaction.

### Gaps
- Could not find any named commercial or open-source product that explicitly advertises cross-request (session/sequence-level) request↔response exploit confirmation. Absence of evidence here is a meaningful signal but not proof none exists; analyst notes (Gartner) were not accessible this session to confirm.

---

## Cross-cutting summary table (feature, date, deployment, key limit)

- Cloudflare Full Transaction Detection + Response Firewall — GA 2026-10-21 — EDGE/SaaS only — no raw response-body matching; 3 response rules/zone; single-transaction only; can't undo origin actions. [blog](https://blog.cloudflare.com/full-transaction-waf/) / [docs](https://developers.cloudflare.com/waf/response-firewall/)
- Cloudflare Sensitive Data Detection — pre-existing (Enterprise) — EDGE/SaaS only — text/HTML/JSON/XML up to 1 MB, no compressed bodies, Enterprise-only. [docs](https://developers.cloudflare.com/waf/managed-rules/reference/sensitive-data-detection/)
- AWS WAF ATP/ACFP response inspection — response-side since 2023-02 — SaaS/managed — CloudFront-only; one component only; 64 KB body; login/account outcomes only. [AWS](https://aws.amazon.com/about-aws/whats-new/2023/02/aws-waf-fraud-control-account-takeover-prevention-cloudfront-origin-responses/)
- F5 BIG-IP ASM/AWAF Data Guard — long-standing (v11.x+) — SELF-HOSTED (appliance/VE) + SaaS — DLP masking/scrub, PII-pattern driven, not exploit correlation. [F5](https://techdocs.f5.com/kb/en-us/products/big-ip_asm/manuals/product/asm-implementations-11-5-0/9.html)
- Imperva Sensitive Information Leakage Protection — current — SaaS Cloud WAF (+ on-prem) — masks card PANs; response-header/body data-leak focus. [Imperva](https://www.imperva.com/blog/the-hidden-threat-how-sensitive-information-leakage-puts-your-business-at-risk/)
- Oracle WAF / Radware KWAAP DLP — current — SaaS/appliance — response-body PII leakage rules, masking/block. [Oracle](https://docs.oracle.com/en-us/iaas/Content/WAF/Reference/protectionruleids.htm) / [Radware](https://support.radware.com/app/answers/answer_view/a_id/1028812/~/radware-kwaap-data-leakage-protection)
- OWASP CRS RESPONSE-950..956 on ModSecurity/Coraza — long-standing — SELF-HOSTED — off by default (`SecResponseBodyAccess Off`), byte-range bypass, static signatures not correlation. [ModSecurity](https://github.com/owasp-modsecurity/ModSecurity/wiki/Reference-Manual-(v3.x)) / [coraza-rs #127](https://github.com/networking-incubator/coraza-rs/issues/127)
- Coraza on Envoy/Istio — current — SELF-HOSTED — needs FULL mode + `SecResponseBodyAccess On`; not default. [Built On Envoy](https://builtonenvoy.io/extensions/coraza-waf/)
- Fastly Next-Gen WAF (Signal Sciences) — current — SELF-HOSTED module+agent + edge — response-CODE blocking (300–599), no response-body exploit matching surfaced. [Fastly](https://www.fastly.com/documentation/guides/next-gen-waf/setup-and-configuration/module-agent-deployment/module-config/)
- Azure/Akamai — current — SaaS/managed — request-body inspection documented; no first-party response-body exploit feature surfaced (rely on CRS). [Azure](https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/application-gateway-waf-request-size-limits)
- Contrast ADR + WAF confirmed alert — current — agent+WAF (self-host agent) — single-request two-sensor correlation, 5-min window, not cross-request. [Contrast](https://docs.contrastsecurity.com/en/5-5-confirmed-waf-alert--adr---waf-.html)
