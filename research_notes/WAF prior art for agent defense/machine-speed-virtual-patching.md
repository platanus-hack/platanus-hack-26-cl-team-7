# Machine-Speed Virtual Patching: WAF & Adjacent Prior Art

> Prior-art due diligence for a hackathon pitch ("defense at machine speed, not office hours") whose prototype was dismissed as "just another WAF." Scope: does any shipping product detect a new/zero-day exploit and auto-generate or auto-deploy a virtual patch / containment rule without waiting for a human or a vendor patch? Current as of November 2026.
>
> **One-line bottom line for the report writer:** Automatic *deployment* of vendor-authored virtual patches is mature and genuinely runs at machine speed (minutes, no customer action). Automatic *generation of a novel rule from an observed live exploit transaction*, deployed in minutes without a human/vendor in the loop, is essentially NOT a shipping commercial product — it exists only as (a) ML "positive-security"/anomaly tuning, which is not CVE-specific, and (b) academic research. That gap is the defensible whitespace. See each section for the seam.

---

## Q1. What is "virtual patching" and which WAFs offer automatic virtual patch generation from a CVE/PoC? How fast, and is deployment automatic or human-gated?

### Takeaway
Virtual patching = a WAF/proxy rule that blocks exploitation of a known vulnerability before the real code is patched. Every major WAF ships vendor-authored CVE rules, and several (Cloudflare, Fastly, AWS, Imperva, F5, Qualys) deploy them automatically once a customer opts in. The rule *authoring* is still human/vendor research; the *distribution/deployment* is what runs at machine speed. Claimed CVE-to-rule times range from hours (Cloudflare emergency releases) to "minutes" (F5, from a scanner finding), but the honest framing is "automatic deployment of a human-written rule," not "automatic invention of a rule."

### Cited Findings — definition & mechanism
- A virtual patch is "data that specifies a rule including a rule condition and a rule action," enforced in front of the vulnerable app so malicious traffic never reaches it — intercepting attacks in transit — per a USPTO patent on application-aware virtual patching — [USPTO 10083024](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10083024).
- Industry framing: virtual patch "prevents the exploitation of a known vulnerability in an upstream system, generally in front of the vulnerable web application" — [Fastly docs](https://www.fastly.com/documentation/guides/next-gen-waf/virtual-patches-for-cves/).

### Cited Findings — Cloudflare (SaaS; emergency managed ruleset)
- Cloudflare's Managed Rules follow a seven-day release cycle (routine pushes Mon/Tue); **emergency releases are pushed outside this cycle as needed**, and sites running managed rules pick up coverage **automatically once the ruleset syncs, no customer action required** — [Cloudflare WAF changelog](https://developers.cloudflare.com/waf/change-log/changelog/).
- Concrete speed, php2shell (CVE-2026-109618/109619): emergency release added **seven Block rules on Oct 21 2026 at ~03:02 UTC**; on Oct 22 the rules' names/metadata were updated to cite the CVEs while **detection logic was unchanged** — [Cloudflare changelog](https://developers.cloudflare.com/changelog/product/waf/); [eSEOspace write-up](https://eseospace.com/blog/php2shell-cloudflare/).
- wp2shell chain (CVE-2026-63030 / CVE-2026-60137): rules live **July 17 2026 at 17:03 UTC** — [Cloudflare changelog](https://developers.cloudflare.com/changelog/product/waf/).
- Brotli (CVE-2026-111497): emergency release **Oct 25 2026** added two rules, **enabled by default but in Log (not Block) mode first** so customers evaluate impact — [Cloudflare changelog](https://developers.cloudflare.com/changelog/product/waf/); [CyberPress](https://cyberpress.org/cloudflare-waf-rules-node-js-brotli/).
- nginx heap overflow (CVE-2026-42945): emergency release May 15 2026 — [Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2026-05-15-emergency-waf-release/). Adobe Commerce/Magento "StyleSmuggler" (CVE-2026-75650), actively exploited zero-day: emergency release Sept 10 2026 — [Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2026-09-10-emergency-waf-release/).

### Cited Findings — Fastly Next-Gen WAF (SaaS)
- Virtual patches are **pre-built templated rules targeting a specific CVE**; matching requests are tagged with the CVE signal and then **blocked or logged per the customer's setting** — [Fastly docs](https://www.fastly.com/documentation/guides/next-gen-waf/virtual-patches-for-cves/).
- An **"Automatic CVE Virtual Patching" toggle** applies all *future* virtual patches "as soon as they're released" — but it is **opt-in and only forward-looking** (does not enable previously released patches, which still need manual action) — [Fastly docs](https://www.fastly.com/documentation/guides/next-gen-waf/virtual-patches-for-cves/).
- Fastly markets SmartParse as **not relying on traditional signatures** for anomalous-request detection — a behavior/parsing approach distinct from CVE rule lists — [Fastly blog](https://www.fastly.com/blog/virtual-patching-with-the-fastly-next-gen-waf).
- **Gap:** Fastly docs do NOT state how fast after CVE disclosure a virtual patch is released, nor the default block/log behavior for the automatic setting.

### Cited Findings — AWS WAF (SaaS)
- Log4j (CVE-2021-44228) protection shipped as the `Log4JRCE` signature inside `AWSManagedRulesKnownBadInputsRuleSet`; to **receive automatic updates customers must select the "default version"** of the managed rule group — [AWS Security Bulletin AWS-2021-006](https://aws.amazon.com/security/security-bulletins/AWS-2021-006/).
- AWS governance guidance: critical updates "that can't wait a week, such as protections against Log4j CVE, can be applied immediately at the expense of some false positives temporarily" — [AWS Builder guide](https://builder.aws.com/content/2wChYiP80aBg7UknVENvBlhqZ07/application-security-aws-waf-governance-at-scale).
- **Gap:** no precise hours-after-disclosure figure for the initial AWS Log4j signature push found.

### Cited Findings — Imperva (SaaS + self-hosted WAF Gateway/SecureSphere); scanner-driven
- Imperva's distinctive model is **scanner-to-WAF**: import vulnerability-scan results, and SecureSphere "automatically converts the vulnerability information to protection rules," creating virtual-patching policies automatically — [Qualys+Imperva brief](https://cdn2.qualys.com/docs/mktg/Imperva.pdf); [Imperva/Rapid7 Nexpose brief](https://www.imperva.com/docs/SB_Imperva_Rapid7.pdf).
- Integrations: Qualys, Acunetix, Rapid7 Nexpose, Trend Micro, Cenzic, HP, IBM, NT Objectives — the Nexpose parser converts web-app findings to XML "to create on-the-fly protection rules" — [Imperva/Rapid7 brief](https://www.imperva.com/docs/SB_Imperva_Rapid7.pdf); [Acunetix partnership](https://www.acunetix.com/blog/news/imperva-and-acunetix-partner/).
- Important: this generates a rule **from a scanner's finding about a KNOWN vulnerability on your own app**, not from an observed live attack. Still a human/tool-authored signature of a known weakness.

### Cited Findings — F5 (SaaS Distributed Cloud + self-hosted BIG-IP)
- Sept 1 2026 launch: F5 "delivers automated virtual patching with F5 Distributed Cloud Web App Scanning," turning scanner findings "into enforced protection in **minutes rather than weeks**"; triggers "targeted virtual patches at runtime" — [F5 investor release](https://investors.f5.com/news/news-details/2026/F5-Accelerates-Virtual-Patching-to-Manage-Emerging-Cyber-Risks-With-AI-Powered-WAF-and-Runtime-Security/default.aspx).
- F5's AI-powered WAF "scores risk dynamically rather than matching known signatures" to defend against zero-day attempts; internal testing claims **98% detection efficacy, 1% false positives** — [F5 release](https://investors.f5.com/news/news-details/2026/F5-Accelerates-Virtual-Patching-to-Manage-Emerging-Cyber-Risks-With-AI-Powered-WAF-and-Runtime-Security/default.aspx).
- Framing is still **human-gated/advisory**: agentic threat intel provides "recommended mitigations that can be applied immediately as virtual patches," positioned around "intelligent risk-based decisions" — [F5 release](https://investors.f5.com/news/news-details/2026/F5-Accelerates-Virtual-Patching-to-Manage-Emerging-Cyber-Risks-With-AI-Powered-WAF-and-Runtime-Security/default.aspx).

### Cited Findings — Qualys (scanner-to-WAF)
- Qualys lets a user flag a WAS-detected vulnerability for **automatic WAF-rule creation**; the rule is auto-generated and deployed to the WAF cluster(s), and all appliances in the cluster update their config — [Qualys KB 000006325](https://success.qualys.com/support/s/article/000006325).

### Inferences
- The "automatic" in every shipping product refers to **deployment/distribution of a rule a human wrote** (vendor researcher for Cloudflare/Fastly/AWS; a scanner's known-vuln fingerprint for Imperva/Qualys/F5). None of these claims "we saw a novel attack and synthesized a new rule."
- The fastest genuinely-automatic path to protection is **SaaS managed rulesets** (Cloudflare/AWS/Fastly): vendor writes the rule in hours, and opted-in customers get it with zero action. Self-hosted (BIG-IP, SecureSphere on-prem) adds customer-side deployment latency unless scanner-integration automation is configured.
- Cloudflare's "Log mode first" for high-blast-radius rules (Brotli) shows even "automatic" vendors deliberately keep a human evaluation step before blocking — machine-speed detection, human-paced enforcement.

### Gaps
- Exact CVE-disclosure-to-rule-live latency is only documented anecdotally (timestamps in specific blog posts), not as a vendor SLA/average.
- No vendor publishes a measured median time-to-mitigate across many CVEs.

---

## Q2. Does any product auto-generate a NOVEL rule from an observed LIVE exploit transaction and deploy it within minutes? Or is research-loop→rule still human/vendor?

### Takeaway
No mainstream commercial WAF advertises "observe a live exploit transaction → synthesize a brand-new blocking rule for it → auto-deploy in minutes." What exists commercially is **adaptive/ML policy learning** (positive-security and anomaly models tuned from traffic), which is not CVE-specific and typically learns *normal* traffic rather than minting a signature from a single malicious transaction. True "live-exploit → novel rule" synthesis is confined to **academic research** (notably WAPP, 2026). This is the clearest whitespace for the pitch — but note it is a known-hard problem (poisoned-training-data risk), which is exactly why vendors don't ship it.

### Cited Findings — commercial adaptive/ML (closest analogues, but NOT live-exploit→novel-signature)
- **Radware** Auto Policy Generation: ML algorithms analyze the protected app, "generate granular protection rules and apply a security policy in blocking mode" across 150+ attack vectors, auto-creating false-positive exceptions — [Radware AI-WAF](https://www.radware.com/cyberpedia/application-security/ai-driven-wafs-for-large-scale-deployments/); [Radware datasheet](https://www.outcomex.com.au/wp-content/uploads/2021/10/Radware_WAF_Auto_Policy_Generation_Data_Sheet-1.pdf).
- **Fortinet FortiADC** WAF Adaptive Learning: continuous DPI/traffic analysis "constructs comprehensive datasets from traffic patterns" and generates tailored policy recommendations — but it outputs *recommendations to refine policy*, not an instant blocking signature — [Fortinet docs](https://docs.fortinet.com/document/fortiadc/7.6.0/new-features/530168/waf-adaptive-learning).
- **Wallarm**: ML uses WAF-collected traffic to "construct its own set of dynamic blocking rules... based on any abnormal traffic patterns" — [Wallarm blog](https://lab.wallarm.com/posts/threat-intelligence-for-waf-a0908d9338de).
- These learn a model of normal/abnormal; they are **not** triggered by a single CVE PoC/exploit transaction to produce a CVE-scoped rule.

### Cited Findings — academic (the actual "live-traffic → synthesized rule" work)
- **WAPP** ("Safe Learning of Positive Security WAF Policies from Live Traffic," 2026): transforms live traffic into enforceable positive-security WAF policies via traffic profiling, trust filtering, **deterministic rule synthesis**, confidence scoring and validation before enforcement. Explicitly addresses the danger that "learning directly from live traffic can be unsafe when malicious requests contaminate the training data" — [arXiv 2609.06840](https://arxiv.org/pdf/2609.06840).
- **RAT** (reinforcement-learning adaptive testing) and **GenXSS** (AI-driven XSS detection/rule framework) are research on automated attack-payload handling, not deployed products — [RAT arXiv 2312.07885](https://arxiv.org/pdf/2312.07885); [GenXSS arXiv 2504.08176](https://arxiv.org/pdf/2504.08176).
- Open-source hobby WAF issue states the core user need plainly: when a CVE is exploited in the wild "operators need a rule the same day, long before the app is patched," and many exploits are "a specific path + parameter that looks harmless to generic rulesets" — [palisade-waf issue #189](https://github.com/sinhaparth5/palisade-waf/issues/189).

### Cited Findings — why signatures break (supports the "novel rule from live traffic" value prop)
- Java4Shell (Nov 2026): Cloudflare's Cloudforce One saw an IP probe with a user agent referencing Java4Shell, then **return ~17 hours later with the exploit trigger while impersonating Chrome** — i.e., signature rules keyed on self-identifying recon user agents stop matching once attackers disguise requests — [SecurityWeek](https://www.securityweek.com/java4shell-exploitation-attempts-begin-as-vendors-rush-out-advisories/); [CSA daily brief](https://labs.cloudsecurityalliance.org/research/frontier-ready-daily-20261120/).

### Inferences
- The "research loop → rule" is still a **human/vendor process** for CVE-specific virtual patches across all named vendors. The automation is in the *delivery pipeline*, not the *rule invention*.
- A prototype that genuinely synthesizes a novel, exploit-specific containment rule from a single observed malicious transaction and deploys it in minutes would be **differentiated from every product surveyed** — the honest caveat is that WAPP shows this is an active research problem with a real safety failure mode (training-data poisoning), so credibility hinges on how the prototype prevents an attacker from teaching it a bad rule.

### Gaps
- Could not find any commercial product (as of Nov 2026) claiming single-transaction → novel-signature → auto-deploy. Absence of evidence here is itself the finding, but a deeper vendor-by-vendor product-doc sweep could strengthen "nobody ships this."

---

## Q3. Evidence on the CVE-to-exploitation and CVE-to-patch gap — quantify the window the team claims to close

### Takeaway
The exploitation window has effectively gone to zero or negative: on average, vulnerabilities are now exploited at or before public disclosure, and roughly a fifth of KEV entries are exploited on/before the CVE publication date. Mass exploitation routinely begins within hours of disclosure. This is the strongest, best-sourced part of the case — the "office hours" gap is real and quantifiable.

### Cited Findings — time-to-exploit (Mandiant / Google)
- Mandiant mean time-to-exploit trend: **63 days (2018–19) → 44 (2020–21) → 32 (2021–22) → 5 days (2023) → −1 day (2024) → −7 days (2025)**; the 2024 figure is based on 112 vulnerabilities — [SC World on Mandiant](https://www.scworld.com/news/threat-actors-exploit-zero-days-within-5-days-says-googles-mandiant); [Upwind summary](https://www.upwind.io/feed/exploit-window-flipped-negative-tte-runtime); [resilientcyber on M-Trends 2026](https://www.resilientcyber.io/p/m-trends-2026-what-450000-hours-of).
- A **negative** mean means attackers were, on average, already exploiting before public disclosure (zero-day). **Caveat:** these are **means**, dragged down by a heavy pre-disclosure tail; Mandiant's 2023 "5 days" was a median after removing 15 outliers. No published 2024 *median* found — [SC World](https://www.scworld.com/news/threat-actors-exploit-zero-days-within-5-days-says-googles-mandiant).
- Google/GTIG counted **75 zero-days exploited in the wild in 2024** (down from 98 in 2023); zero-day defined as exploited before a patch is public; 44% targeted enterprise products — [GTIG 2024 zero-day analysis PDF](https://services.google.com/fh/files/misc/2024-zero-day-exploitation-analysis-en.pdf); [The Hacker News](https://thehackernews.com/2025/04/google-reports-75-zero-days-exploited.html).

### Cited Findings — CISA KEV (exploited before/at patch)
- **~19–23% of KEV entries are exploited on or before the CVE publication date.** VulnCheck: **23.43%** of 495 H1-2026 KEVs had exploitation evidence on/before publication day — [stingrai](https://www.stingrai.io/blog/vulnerability-statistics-2026). HackTheHammer (Nov 2026 KEV analysis): **21.1%** on/before publication, **54.7% within 30 days** — [HackTheHammer](https://www.hackthehammer.com/known-exploited-vulnerabilities-statistics/). BlueRadius: median CVE-publication-to-KEV-listing **12 days in 2026 (down from 26 in 2025), 44% within 7 days, 19% on/before publication day** — [BlueRadius](https://blueradius.io/research/cisa-kev-report-2026).
- KEV catalog ~**1,773 entries as of Nov 9 2026** — [HackTheHammer](https://www.hackthehammer.com/known-exploited-vulnerabilities-statistics/).
- Patch reality is slow: organizations fully remediated only **26% of detected KEV vulnerabilities, down from 38%** the prior year — [stingrai](https://www.stingrai.io/blog/vulnerability-statistics-2026). (Source note: these percentages come from analyst blogs aggregating VulnCheck/CISA data, not primary CISA publications; figures vary by measurement window.)

### Cited Findings — mass exploitation within hours
- GreyNoise 2025 Mass Internet Exploitation Report: attackers target zero-days **within hours of disclosure**; **40% of exploited CVEs in 2024 were at least four years old** (some from the 1990s); GreyNoise runs ~4,000 sensors in 200+ countries — [GreyNoise blog](https://www.greynoise.io/blog/2025-mass-internet-exploitation-report); [Dark Reading](https://www.darkreading.com/cyberattacks-data-breaches/greynoise-intelligence-releases-new-research-on-cybersecurity-vulns).
- Check Point noted php2shell was exploited **within hours of disclosure** — [precursorsecurity](https://precursorsecurity.com/blog/phpaftershell-critical-php-rce-vulnerabilities).
- GreyNoise observed a campaign **four days after disclosure** where a threat actor likely used LLMs to build/test exploits, assemble a target list, and run widespread exploitation — attacker-side automation is already here — [GreyNoise blog](https://www.greynoise.io/blog/2025-mass-internet-exploitation-report).

### Inferences
- The window the team claims to close is concretely: **mean time-to-exploit ≈ 0 to negative days, with mass scanning within hours, against a patch-remediation reality of weeks and only ~26% KEV remediation.** That is a defensible "machine speed vs. office hours" thesis grounded in primary-adjacent data.
- The counter the team must pre-empt: SaaS managed-rule vendors already shrink the *protection* window to hours automatically — so the differentiator is the sub-hour, no-vendor-in-the-loop, novel-attack case (Q2), not the generic "patch gap" (which WAFs partly address).

### Gaps
- Several KEV percentages come from secondary analyst blogs; the underlying VulnCheck/CISA primaries would be stronger citations if the writer needs authority.

---

## Q4. Emerging "autonomous SOC" / agentic-security-response products (2025–2026) — who ships this, and is it real or marketing?

### Takeaway
Agentic/autonomous SOC is the dominant 2026 vendor narrative (CrowdStrike, Microsoft) and is partly real: multi-agent auto-investigation and *optional* fully-autonomous containment exist, but **shipping defaults keep a human-in-the-loop**, and autonomy is a per-workflow customer setting. Gartner placed AI SOC Agents at the "Peak of Inflated Expectations" (June 2026) — a signal to treat machine-speed-containment claims skeptically. Importantly, these are endpoint/identity/SOC response tools, not web-exploit virtual patching — adjacent, not the same lane.

### Cited Findings — CrowdStrike (Fal.Con 2026, Sept 2)
- Charlotte AI dispatches domain agents in parallel across endpoint/identity/SaaS/cloud/network with a persistent shared "context layer"; **customers "set the autonomy level for each workflow, from human-in-the-loop approval to fully autonomous execution"** — [CrowdStrike press release](https://www.crowdstrike.com/en-us/press-releases/crowdstrike-unveils-next-evolution-of-the-agentic-soc/).
- Framed around attacker speed: "AI agents execute attack actions across multiple systems at machine speed. The investigation has to move the same way"; investigations go from "hours into minutes." Agents deliver verdicts with **"staged response actions"** — not fully automatic by default; "Analysts stop doing the grind and start making the call" — [CrowdStrike press release](https://www.crowdstrike.com/en-us/press-releases/crowdstrike-unveils-next-evolution-of-the-agentic-soc/).
- Agentic MDR (GA, RSA 2026): "deterministic automation within expert-defined guardrails" where "triage, enrichment, containment, and remediation happen instantly using predefined logic" — [CrowdStrike Agentic MDR release](https://www.crowdstrike.com/en-us/press-releases/crowdstrike-delivers-agentic-mdr-to-stop-breaches-at-machine-speed/).
- Standard forward-looking disclaimer: some features "still in development and subject to change" — [CrowdStrike press release](https://www.crowdstrike.com/en-us/press-releases/crowdstrike-unveils-next-evolution-of-the-agentic-soc/).

### Cited Findings — Microsoft & market
- Microsoft Security Copilot / Sentinel extend autonomy for Microsoft-heavy stacks, but analysts note Copilot's reach "thins" once non-Microsoft (CrowdStrike/Okta/AWS) data enters the mix, so such SOCs pair Sentinel with a vendor-agnostic agentic layer — [Stellar Cyber](https://stellarcyber.ai/learn/top-10-agentic-soc-platforms/).
- IBM expanded a partnership (April 2026) integrating Charlotte AI with ATOM for "machine-speed, cross-platform threat investigation and containment" — [Stellar Cyber](https://stellarcyber.ai/learn/top-10-agentic-soc-platforms/).
- **Gartner placed "AI SOC Agents" at the Peak of Inflated Expectations** in its June 2026 Hype Cycle for Security Operations — [Stellar Cyber](https://stellarcyber.ai/learn/top-10-agentic-soc-platforms/).

### Inferences
- "Autonomous SOC" is real as *auto-investigation/triage at machine speed*; *autonomous containment* is available but shipped behind an opt-in autonomy slider, so the human gate is the default — the same "machine detect, human enforce" pattern as WAFs (Q1).
- These products operate on alerts/endpoints/identities, not on inventing a web virtual patch from a live HTTP exploit. The team's pitch overlaps conceptually ("machine speed response") but a web-exploit→novel-rule prototype is not the same product category — a point that helps rebut "just another WAF" *and* "just another agentic SOC."

### Gaps
- No independent, measured data found on how often customers actually run these agents in "fully autonomous execution" vs. human-approval mode — vendor claims only.

---

## Q5. RASP/RAST and runtime self-protection — do they already "contain at the last step before compromise," and how does that differ from a proxy-level block?

### Takeaway
Yes — RASP (and the newer ADR category) sits inside the app runtime and blocks at the actual execution point (post-decode, at the SQL/OS/render boundary), which structurally catches novel/zero-day injection a perimeter WAF cannot see. That IS "containment at the last step." The trade-off: per-app instrumentation, runtime overhead, and coverage limited to what's instrumented. RASP is behavioral (no CVE signature needed), so it is arguably closer to the team's thesis than a WAF — a proxy block is pattern-guessing on HTTP; RASP is context-certain at execution. ("RAST" in the brief is most likely RASP or conflated with IAST/runtime testing; no distinct shipping "RAST" category surfaced.)

### Cited Findings
- WAF = perimeter guard inspecting HTTP against rule sets; RASP = inside the app runtime, monitoring function calls, data flows and DB queries with full application context — [Peakhour](https://www.peakhour.io/learning/application-security/waf-vs-rasp/); [Indusface](https://www.indusface.com/learning/waf-vs-rasp/).
- The "last step" mechanism: with an encoded injection a WAF sees `%27%20OR%20%271%27%3D%271`, while RASP sees the **decoded value at execution time — no bypass**; RASP sees a user-supplied string "about to be concatenated into a raw SQL query" — [Aikido](https://www.aikido.dev/blog/waf-rasp-adr); [raven.io](https://raven.io/blog/rasp-vs-waf-vs-adr).
- RASP "blocks exploit attempts even before a patch exists, because it monitors behavior rather than signatures" — making it effective against novel/unknown attacks — [daily.dev](https://daily.dev/blog/what-is-rasp-runtime-application-self-protection-explained/); [Aquilax](https://aquilax.ai/blog/rasp-runtime-protection-vs-waf).
- WAF structural blind spot: WAFs "cannot observe what happens after code begins executing"; the SQLi that slips a pattern matcher or a no-signature deserialization exploit "sail right through" — [raven.io](https://raven.io/blog/rasp-vs-waf-vs-adr).
- Trade-offs: RASP adds "performance overhead, compatibility risk, and app-by-app deployment complexity," and its zero-day coverage is "Partial — limited by injected coverage"; emerging **ADR (Application Detection & Response)** is positioned as the behavioral next step — [Aikido](https://www.aikido.dev/blog/waf-rasp-adr); [bytehide](https://www.bytehide.com/blog/in-app-waf-vs-rasp-vs-perimeter-waf).
- Consensus: WAF and RASP are **complementary, not competing** — WAF for edge/volumetric/DDoS, RASP for injection-class and zero-days — [Indusface](https://www.indusface.com/learning/waf-vs-rasp/); [appsecsanta](https://appsecsanta.com/rasp-tools/rasp-vs-waf).

### Inferences
- If the prototype operates at a RASP/ADR-like execution boundary (behavioral containment at the last step) rather than as an HTTP proxy, that is a legitimate, documented technical distinction from "just another WAF" — but it is NOT novel as a *category*; RASP and ADR already claim exactly this. The novelty would have to be in the *automatic machine-speed rule/policy generation* layered on top, not the runtime-containment position itself.
- "Contain at the last step" is a real, existing capability — so leaning on it alone invites the "that's RASP/ADR" rebuttal, paralleling the "that's a WAF" rebuttal.

### Gaps
- "RAST" as a distinct named product/category was not found; assumed to mean RASP (or possibly runtime/interactive app security testing, IAST). Writer should confirm the team's intended term.

---

## Cross-cutting synthesis (for the report writer)

- **What is genuinely automatic / machine-speed today:** SaaS managed-ruleset *distribution* (Cloudflare, AWS, Fastly) — vendor authors a rule in hours, opted-in customers get it with no action; scanner-to-WAF virtual patch *generation for known vulns* (Imperva, Qualys, F5) — minutes from a scan finding; auto-investigation/triage in agentic SOC tools (CrowdStrike) — hours to minutes.
- **What is still human-gated:** the *authoring* of every CVE-specific virtual patch (vendor research loop); enforcement defaults (Cloudflare ships high-impact rules in Log mode first; F5 frames around human risk decisions; agentic SOC containment defaults to human approval); self-hosted deployment (BIG-IP, on-prem SecureSphere) unless scanner automation is wired up.
- **The honest whitespace the team can defend:** novel-attack → *synthesized* containment rule from an observed live exploit transaction, auto-deployed sub-hour with no vendor/human in the loop. No surveyed commercial product does this; only research (WAPP) attempts it, and it flags the real risk (training-data poisoning / an attacker teaching the system a bad rule) the team must answer.
- **Self-hosted vs SaaS:** SaaS = fastest automatic delivery but vendor-dependent rule authoring. Self-hosted (BIG-IP, SecureSphere, FortiADC, open-source) = customer controls authoring/deployment but carries the deployment-latency and tuning burden; this is where "local, autonomous, instant" has the most headroom.
