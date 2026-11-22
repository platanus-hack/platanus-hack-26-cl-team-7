# Detecting malicious AI agents (LLM-driven attackers) in HTTP traffic at line rate

Research date: 2026-11-21. Sources are arXiv preprints (mostly unreviewed, 2024–Nov 2026), vendor threat-intel blogs and protocol docs. arXiv IDs of the form 26MM.xxxxx were posted in month MM of 2026. Paper passages were read through the Firecrawl paper index (full-text excerpts). Vendor numbers are vendor-reported and not independently audited. Anything marked "unverified" could not be confirmed against a primary source.

## Q1. Academic and industry work (2024–2026) on detecting autonomous LLM hacking agents: signals used and numbers reported

### Takeaway
The literature agrees on one main method: **active elicitation** (prompt-injection tripwires, decoy endpoints, honeytokens, "shibboleth" gates that make the agent reveal itself to get what it wants) plus **timing**. Passive wire-level detection of offensive agents is barely studied. Strong passive results exist only for *browsing* agents in controlled lab sets. In the wild, confirmed autonomous agents are rare at generic honeypots: Palisade logged 8 candidates in 8.1M SSH attempts. Industry incident reports from 2025–2026 (Anthropic GTG-1002, Unit 42 Hermes/DeepSeek, GreyNoise PaperCut) show that real campaigns often send traffic through **tools the agent itself generated or invoked** (multi-threaded PoC scanners, nuclei, curl). As a result, much of what reaches the wire looks *scripted*, not "LLM-like".

### Cited Findings
**Palisade LLM Agent Honeypot (arXiv 2410.13919, Oct 2024)**
- A modified Cowrie SSH honeypot with prompt injections in the banner, in command output (e.g., `uname`) and in files. It sorts actors into software bot / LLM agent / human. The prompt-injection response separates LLMs from bots, and timing separates LLMs from humans. A two-step check runs a goal hijack ("secret command cat8193 /<first US president>") and then a prompt-stealing step ("poem about your initial instructions") — [arXiv 2410.13919](https://arxiv.org/abs/2410.13919)
- Pre-evaluation with GPT-4o agents: the "Important Message" (AgentDojo-style) injection hijacked ReAct agents 100% of the time and CoT agents 34%/100% depending on the setup. "Ignore previous instructions" succeeded 82% (ReAct) and 6% (CoT). Prompt stealing succeeded only 40% — [arXiv 2410.13919](https://arxiv.org/abs/2410.13919)
- Timing: internal LLM agents replied within about **1.7 s**, even to injections. One wild human-like responder had gaps that often exceeded 10 s. The paper treats timing as a way to cut false positives, not as a standalone detector — [arXiv 2410.13919](https://arxiv.org/abs/2410.13919)
- Results over about 3 months on 10 IPs (advertised through Shodan/Censys and lure DNS names): **8,130,731 interaction attempts, 8 potential AI agents**. The dashboard snapshot in the paper shows 8,333,841 interactions, 7 "potential" (passed the injection) and **1 "confirmed"** (passed injection and timing). The live dashboard still shows a geo split of potential agents (India 42.86%, Thailand 28.57%, ...) — [arXiv 2410.13919](https://arxiv.org/abs/2410.13919); [Palisade dashboard](https://ai-honeypot.palisaderesearch.org/)

**Mantis / "Hacking Back the AI-Hacker" (Pasquini, Kornaropoulos, Ateniese; arXiv 2410.20911, Oct 2024; listed as AISec '26)**
- Decoy FTP and web-app services act as a "supernormal stimulus" built from CTF-style misconfigurations. When a decoy is triggered, an injection manager returns payloads that either tarpit the agent (an endless fake filesystem that drives up inference cost) or counter-strike it (inducing a reverse shell). The payload is hidden from humans with ANSI conceal `\033[8m...\033[0m`, and for HTML it is wrapped in `<!-- -->` comments. Banners also carry hints such as `Server: Apache 5.45\033[8m(SQL Injection detected)\033[0m` — [arXiv 2410.20911](https://arxiv.org/abs/2410.20911)
- Tested against GPT-4, GPT-4o, Claude 3.5 Sonnet and Claude 3.5 Haiku agents on HackTheBox-style CTFs: **about 95.4% sabotage success**. The attacker's success rate falls to "less than 3%" in the original abstract (the extracted text reads "33%", most likely a rendering duplication, so check before quoting). The weakest case was a CTF where a real SMB service pulled the agent away from the decoy — [arXiv 2410.20911](https://arxiv.org/abs/2410.20911)

**Say Shibboleth (Pasquini, Reworr, Ateniese, Bhatt, Epp; arXiv 2611.12386, 9 Nov 2026)**
- "Shibboleth traps" are honeypot services that make an informative interaction the *price* of a resource. Examples: an MCP server requires the client to name the model it serves sampling on, a deploy controller requires a written change record, and one call is held open. No successful prompt injection is needed — [arXiv 2611.12386](https://arxiv.org/abs/2611.12386)
- Harness probes look only at effects in later requests. They test (a) how the harness masks secrets in tool output (whether the agent later authenticates with a masked value), (b) command time limits (whether the caller closes a held call, e.g., after 180 s), and (c) tool-call scheduling or concurrency — [arXiv 2611.12386](https://arxiv.org/abs/2611.12386)
- Results: across **15 candidate LLMs**, combined declarative and behavioral inference reaches **90–92% top-1** on two traps (average 90%), with classifiers tested on held-out harnesses. Across **4 harnesses**, fixed rules pick the correct harness in **92%** of runs — [arXiv 2611.12386](https://arxiv.org/abs/2611.12386)
- Self-declared names are unreliable. Of 16,925 model declarations, **7,854 named a model other than the one writing them (452 distinct names)**. Common fakes were retired IDs such as `openai/gpt-4o` and `anthropic/claude-3-5-sonnet-20241022` and placeholders such as `x` and `hermes`. When told to conceal their identity, agents' declarations become uninformative, but their writing "accent" still identifies the model — [arXiv 2611.12386](https://arxiv.org/abs/2611.12386)
- The paper's motivating example: an MCP `initialize` exposed `clientInfo.name: "hermes-agent"` and a sampling model of `z-ai/glm-5.3`. The authors released code at github.com/SayShibboleth/Shibboleth — [arXiv 2611.12386](https://arxiv.org/abs/2611.12386)

**Detecting Offensive Cyber Agents: a detection-in-depth approach (arXiv 2605.21956, May 2026; policy report)**
- Proposes layers of identity mechanisms (at the access point: tracking, verifying and logging digital actors) plus behavioral and cross-ecosystem mechanisms. It argues that indicators of behavior (IOBs) and TTPs, especially "invariant behaviors" structurally required by the objective, and **tool-use patterns** are more durable signatures than IOCs. It also expects signatures to drift as models and scaffolds change — [arXiv 2605.21956](https://arxiv.org/abs/2605.21956)
- It warns that attacks are being split across models and vendors. One cited study found that decomposing malicious code generation across Llama 70B and Claude 3 Opus reached 43% success versus 3% for either model alone. In-the-wild cases include DeepSeek doing recon while Claude handled exploitation. As a result, no single observation point may have enough visibility — [arXiv 2605.21956](https://arxiv.org/abs/2605.21956)

**Deception systems against web/pentest agents (2026)**
- **AgentSnare** (arXiv 2607.26998, Aug 2026): trajectory-adaptive decoys conditioned on the agent's interaction history. Across 45 attacker–CVE scenarios (15 CVE-Bench web apps × 3 attacker models) it reports 46.8% Delay (share of tool calls absorbed), 55.9% Divert (share of post-entry actions kept in the decoy) and 90.0% Defuse (completion attempts grounded in decoy evidence), with **zero real-target exploits at pass@3** — [arXiv 2607.26998](https://arxiv.org/abs/2607.26998)
- **AgentTrap** (arXiv 2610.02869, 2 Oct 2026): *sentinel endpoints* that are absent from normal workflows but discoverable by automated recon, an LLM-controlled stateful deception grounded in the real app's state, and behavior-guided escalation. Against **8 pentest agents**, the real-target attack success rate fell from 95.8% to 79.2%, and the trap elicited the attacker's own API key in **18.8%** of runs. Claude Code, AIDA and PentestGPT resisted mainly because the underlying model recognized the credential-harvesting request — [arXiv 2610.02869](https://arxiv.org/abs/2610.02869)
- **WebMaze** (arXiv 2610.38524, 28 Oct 2026): a study of 6 LLM web scanners found a shared three-stage loop (gather information, select an action from observations, iterate). Traps are coupled to real functionality, including a one-pixel decoy link near the page edge, and lead into view-tailored decoy worlds. Over 12 apps × 3 scanners × 2 backbones, **93.0% of distinct pages requested were decoys**, and 85.6–94.8% even when scanners were told about the decoys. The paper notes that plain hidden-link traps are easy to filter by keeping only links that are visibly rendered — [arXiv 2610.38524](https://arxiv.org/abs/2610.38524)
- **Gingerbread House** (arXiv 2611.07611, 5 Nov 2026): an LLM plans honeypots from the application source. A router sends every later request from a *confirmed* client, including a working exploit, to an isolated shadow copy. Real compromise fell from **26/40 to 5/40 for Claude Opus 4.8** and from **20/40 to 0/40 (31 valid runs) for the ARTEX framework** (DeepSeek-V4-Flash) on CVE-Bench, and from 15/20 to 0/20 on 20 held-out tasks — [arXiv 2611.07611](https://arxiv.org/abs/2611.07611)
  - Router states: **Suspect** = a payload signature, a suspect-level rule, or a burst of errors (**five 404s within 20 requests**). **Confirmed** = a honeytoken in the request, a hit on a fake endpoint or decoy, a payload on a top-ranked risk surface, an unauthenticated request to a top code-execution or auth surface while suspect ("escalation"), or a 20th request while still suspect ("persistence"). Deceptive answers are delayed by a random 2–4 s (tarpit) — [arXiv 2611.07611](https://arxiv.org/abs/2611.07611)
  - Stated weakness: the router kept one state per listener and "never had to tell clients apart". The authors call per-client attribution "the most exposed assumption". An attacker that rotates client identity, cross-checks secrets or fingerprints the shadow could weaken the defense. In arm B, a decoy-link parameter named `__artex_token` leaked into the transcripts of 27/38 runs — [arXiv 2611.07611](https://arxiv.org/abs/2611.07611)
- CVE-Bench (arXiv 2503.17332) is the benchmark of real web-app CVEs that AgentSnare and Gingerbread House use — [arXiv 2503.17332](https://arxiv.org/abs/2503.17332)
- HoneyTrap (arXiv 2601.04034, Jan 2026) addresses multi-turn *jailbreaks against an LLM service*, not network attackers. It reports a 68.77% average drop in attack success. It is not directly relevant to HTTP detection — [arXiv 2601.04034](https://arxiv.org/abs/2601.04034)
- "Cloak, Honey, Trap: proactive defenses against LLM agents" (Ayzenshteyn, Weiss, Mirsky, USENIX Security 2025) is cited by Rouxii and AgentTrap as the main earlier deception work. I did not read its numbers (gap) — cited in [Rouxii](https://arxiv.org/abs/2609.26555)

**Industry: confirmed agentic campaigns and what they looked like**
- **Anthropic GTG-1002** (detected mid-Sep 2025, report Nov 2025): a likely state-sponsored actor ran Claude Code instances as autonomous pentest orchestrators against about 30 organizations, with 80–90% of tactical operations done autonomously. "Peak activity included thousands of requests, representing sustained request rates of multiple operations per second", described as "physically impossible request rates" for humans. Recon used **browser automation via MCP** plus open-source tools. The agents hallucinated credentials and findings — [Anthropic report PDF](https://www-cdn.anthropic.com/d7dd50dd1185f59be051b307150d877f2b82bd2c.pdf); [MITRE ATT&CK C0062](https://attack.mitre.org/campaigns/C0062/)
- **Unit 42** (published 30 Jul 2026): the actor ran Hermes Agent with DeepSeek, controlled over Telegram, with an MCP server that exposes **nuclei scan generation**. The agent ran a generated PoC scanner (`langflow_poc.py --scan-file ... --threads 10`). It sampled about 100 of 25,209 exposed n8n hosts, probed about 40 with `curl` version checks, and tried to exploit 3. Claude Code and Codex were routed through a third-party proxy with `CLAUDE_CODE_ATTRIBUTION_HEADER: "0"`, and later attempts used proxy anonymization — [Unit 42](https://unit42.paloaltonetworks.com/autonomous-ai-cyber-attack-campaign/)
- **GreyNoise "Agents Gone Wild"** (9 Sep 2026): hundreds of agents used **OpenAI Codex as the harness with a DeepSeek model**. The agents diffed patched and unpatched PaperCut builds, built and refined a *multi-threaded exploitation tool*, and compromised at least 440 PaperCut instances across 395 organizations in 48 countries. They reached **11 organizations in 26 seconds** and went from initial access to domain admin in 5–144 minutes. At least once, **Cloudflare's WAF defeated the actor**. GreyNoise's conclusion: "traditional hardening does have a positive impact" — [GreyNoise](https://www.greynoise.io/blog/ai-orchestrated-campaign-against-papercut-ng-mf)

### Inferences
- What reaches a proxy in a real agentic campaign is usually a *mix*: (a) LLM-decided, low-volume, response-conditioned probes such as curl version checks, reading advisories and trying a PoC, and (b) high-volume, scripted bursts from tools the agent wrote or launched, such as a multi-threaded PoC runner or nuclei. The proxy should model the session as a *controller over tools*. It should look for an adaptive pacing layer that switches between bursts, not for "LLM-looking" individual requests.
- Every system in the published literature that reports high precision uses an **active** element: a decoy, sentinel, honeytoken or injection. Purely passive classification of *offensive* agents at HTTP level has no published benchmark that I found.

### Gaps
- I found no paper that reports precision and recall of a *passive* HTTP-only detector for offensive LLM agents against nuclei, ffuf, sqlmap and humans on the same dataset.
- I did not read the "Cloak, Honey, Trap" (USENIX Sec 2025) numbers. I also did not verify the exact Mantis attacker-success figure (3% vs 33%).
- The Palisade dashboard's current totals (Nov 2026) were not fully captured, only the geographic split.

## Q2. Behavioral and protocol signals: what separates agents from crawlers, scanners and humans; inline cost

### Takeaway
At the network layer, **crawlers and classic scripted tools separate trivially**: HTTP/1.x only, a stable JA3/JA4, and header sets that differ from browsers. **Humans separate by timing and by browser consistency.** **LLM agents** are distinguished by (1) a think-act cadence, with gaps of seconds that track response size and complexity, interleaved with sub-second tool bursts, and (2) **response-conditioned adaptivity**: the next request reuses tokens, paths, parameter names or error strings from the previous response. Browser-based agents are best separated by temporal plus behavioral (JS) features. Their TLS/HTTP fingerprints often collapse into "real Chrome". Each fingerprint layer is cheap inline, but the most discriminative signal, adaptivity, needs per-session state and some response inspection.

### Cited Findings
- **MARK** (arXiv 2606.20910, ~Jun 2026) recorded six web agents (AutoGen, Browser Use, Skyvern on GPT-5-mini; Claude; Gemini; Operator), humans and three crawlers (Heritrix, Nutch, Scrapy) at 4 layers. With an Extra Trees classifier and 30-fold CV, F1 scores were: **temporal 1.000** (full traces), HTTP 0.799, **TLS 0.725 (weakest)**, behavioral 0.875, combined 0.971 — [arXiv 2606.20910](https://arxiv.org/abs/2606.20910)
  - The authors caution that pacing "may be sensitive to task complexity, network conditions, and model updates" and may not generalize — [arXiv 2606.20910](https://arxiv.org/abs/2606.20910)
  - Online, after **3 requests**, the classifier is >60% accurate. Network features dominate early and behavioral features add discrimination later — [arXiv 2606.20910](https://arxiv.org/abs/2606.20910)
  - Crawlers reached 100% F1 on request, HTTP and TLS features alone. They used only HTTP/1.0 or 1.1, never negotiated HTTP/2 (so the Akamai H2 fingerprint was empty), and each kept a constant TLS fingerprint across all 30 sessions — [arXiv 2606.20910](https://arxiv.org/abs/2606.20910)
  - **Claude and Gemini agents were indistinguishable at TLS** (Gemini TLS F1 = 0.000). Agent-specific tells: AutoGen showed a **User-Agent inconsistency**, Browser Use a **Sec-Fetch logic violation**, and Skyvern a distinct TLS extension count and HTTP/2 stream-5 priority weight — [arXiv 2606.20910](https://arxiv.org/abs/2606.20910)
- **Known By Their Actions** (arXiv 2605.14786, May 2026): a passive JS tracker over 14 frontier LLMs identifies the model with up to **96% F1 within a fixed harness**. Cross-task transfer drops macro-F1 from 79.4/75.3 to 41.1/49.8. Injected delays hurt clean-trace classifiers, but retraining recovers them by shifting weight to "what agents do, not merely when": residual timing variability, click dispersion and link-click ratio. F1 "rises sharply within the first 40% of observed actions" — [arXiv 2605.14786](https://arxiv.org/abs/2605.14786)
- **Minimal feature sets** (arXiv 2607.26935, Jul 2026): binary human-vs-bot detectors *structurally miss* 30–39% of AI agents (RF 30.0%, SAINT 34.5%, MLP 39.1%). A three-class formulation fixes this. Two JS behavioral features ({mouse_event_rate, teleport_click_ratio}) gave 100% agent recall with precision ≥0.99 under five evasion levels up to replayed human cursor data (macro-F1 0.926). These are client-side signals, not proxy-visible — [arXiv 2607.26935](https://arxiv.org/abs/2607.26935)
- **Proof-of-Agentness** (arXiv 2610.35288, Oct 2026): separates *agents* from *simple bots and scripts*. Eight LLMs solved its challenges with 96.5% accuracy at about 1,647 tokens of overhead. In a separate passive study with 12 humans plus bot and agent implementations, classification accuracy averaged 95.8% across 4 classifiers — [arXiv 2610.35288](https://arxiv.org/abs/2610.35288)
- **Unmasking Web Agents** (arXiv 2606.30119, Jun 2026): six web agents on honeysites behind robots.txt, CAPTCHAs, proof-of-work and Cloudflare free tools. Some agents (OpenClaw, Claude Chrome) bypassed all defenses, and **"stealth and anti-detection mechanisms often increase detectability rather than decrease it"** — [arXiv 2606.30119](https://arxiv.org/abs/2606.30119)
- **Broken Gates** (arXiv 2607.18659, Jul 2026): commercial solvers beat challenge CAPTCHAs at near-perfect rates and low cost. Of two agents with nearly identical interaction traces against reCAPTCHA v3, one passed and one failed. The authors attribute the difference to **execution-environment authenticity, not behavior** — [arXiv 2607.18659](https://arxiv.org/abs/2607.18659)
- **Timing in SSH**: agents ≤1.7 s, humans often >10 s ([arXiv 2410.13919](https://arxiv.org/abs/2410.13919)). GTG-1002 reached "multiple operations per second" at peak ([Anthropic](https://www-cdn.anthropic.com/d7dd50dd1185f59be051b307150d877f2b82bd2c.pdf)).
- **Error-driven iteration as a signal**: the Gingerbread House router treats "five 404 responses within twenty requests" as Suspect — [arXiv 2611.07611](https://arxiv.org/abs/2611.07611). AgentTrap's threat model describes agents that "maintain attack state and iteratively adapt actions based on responses" and abandon paths that look implausible — [arXiv 2610.02869](https://arxiv.org/abs/2610.02869)
- **Payload and ordering**: in 400 autonomous pentest runs (4 models × 100) against one fixed target, attack order was model-specific. Two models attacked FTP first in 63% and 82% of runs. The authors fit a **first-order Markov chain over phase labels** (RECON, EXPLOIT_WEB/SSH/FTP, POST_EXPLOIT, REFUSED); Claude showed 87.8% REFUSED→REFUSED — [arXiv 2605.30096](https://arxiv.org/abs/2605.30096)
- **Tool fingerprints**: Unit 42 saw nuclei generation via MCP, generated Python scanners and curl ([Unit 42](https://unit42.paloaltonetworks.com/autonomous-ai-cyber-attack-campaign/)). GTG-1002 used browser automation via MCP ([Anthropic](https://www-cdn.anthropic.com/d7dd50dd1185f59be051b307150d877f2b82bd2c.pdf)). Nuclei templates often hardcode UAs, including `python-requests/2.24.0` and Firefox strings, inside raw requests ([ProjectDiscovery blog](https://projectdiscovery.io/blog/nuclei-unleashed-quickly-write-complex-exploits)). Nuclei's UA model includes a `Random` option ([nuclei PR #8139](https://github.com/projectdiscovery/nuclei/issues/8139)).
- **Unknown or forged UAs**: GreyNoise observes "automated scanners posing as the web crawlers of OpenAI, Anthropic, DeepSeek" requesting commonly exposed secret files — [GreyNoise blog index](https://www.greynoise.io/blog). DataDome states "most websites are unprotected against spoofed AI agents" — [DataDome](https://datadome.co/threat-research/state-of-bot-and-agent-security-report-key-ai-findings/)
- **Fingerprint standards**: JA4+ (FoxIO, Sep 2023) covers JA4 (TLS ClientHello), JA4H (HTTP client: method, version, cookie/referer presence, header count and order hash, Accept-Language) and JA4T (TCP SYN: window, options, MSS, wscale). Zeek ships a JA4 package. FoxIO claims that combining JA4T with JA4H/JA4 enables block rules "with no false positives" (vendor claim, unverified) — [FoxIO JA4 GitHub](https://github.com/FoxIO-LLC/ja4); [FoxIO JA4T](https://foxio.io/blog/ja4t-tcp-fingerprinting); [Zeek](https://zeek.org/2026/01/how-to-use-ja4-network-fingerprints-in-zeek/). Akamai's passive HTTP/2 fingerprint uses SETTINGS values, WINDOW_UPDATE, PRIORITY frames and pseudo-header order. RFC 7540 §10.8 itself acknowledges this fingerprinting surface — [Akamai BH EU 2017](https://blackhat.com/docs/eu-17/materials/eu-17-Shuster-Passive-Fingerprinting-Of-HTTP2-Clients-wp.pdf)

### Inferences
Signal assessment from the cited findings plus my own engineering judgment. Costs are estimates.

| Signal | Separates | Inline cost | Aware-agent evasion |
|---|---|---|---|
| JA4 / JA4T / H2 SETTINGS+pseudo-header order vs. claimed UA (consistency) | Scripts (python-requests, Go, curl) and crawlers vs. real browsers; catches UA spoofing | O(1) per connection, computed at TLS/H2 termination | Use a real browser (Playwright, CDP) or curl-impersonate/uTLS. Collapses agents into "Chrome" (Claude ≈ Gemini in MARK) |
| Header order/set and Sec-Fetch-* logic, Accept-Language, client hints | Automation frameworks (AutoGen UA inconsistency, Browser Use Sec-Fetch violations) | O(1) per request (JA4H-style hash) | Drive a real headful browser, which removes most tells |
| Inter-request gap distribution (think-act cadence): bimodal sub-second tool bursts plus 2–30 s LLM "thinking" gaps; gap correlated with previous response size | LLM agents vs. fixed-rate scanners (near-constant gaps) and humans (heavy-tailed, diurnal) | O(1) per request (online histogram or EWMA per session key) | Add random sleeps. Known By Their Actions shows delay injection degrades timing classifiers, so timing alone is fragile |
| Response-conditioned adaptivity: fraction of request paths/params/values that appear only in earlier response bodies (links, JS, error messages, API schemas) and not in public wordlists | LLM agents and good crawlers vs. wordlist scanners (ffuf/dirsearch: paths from a fixed list, independent of responses) | Medium: per-session Bloom filter of tokens from response bodies (size-capped), membership test on the next request | Hard to evade without losing effectiveness, because adaptivity *is* the agent's advantage. Crawlers follow links too, so combine with payload semantics |
| Error-driven iteration: 4xx/5xx followed by a *mutated* retry on the same endpoint (changed param, encoding, quoting) | Agents and sqlmap (sqlmap mutates too, but with a stereotyped, signature-matchable sequence) | O(1): per-session last-N (endpoint, status, param-shape) ring buffer | Agents can't easily avoid it without giving up iteration |
| Payload novelty vs. known tool templates (nuclei template IDs and interactsh OAST domains, sqlmap tamper patterns, ffuf wordlists) | Known scanners (high template match) vs. LLM-written payloads (novel, context-specific, often natural-language comments or realistic values) | Low–medium: Aho-Corasick or hash set of template signatures; novelty = miss rate | An agent that *runs* nuclei looks like nuclei. The distinguishing part is the controller's choice and timing of tools |
| Phase progression: recon → targeted probe → exploit-shaped requests within minutes, *narrowed* to the stack seen in responses (version checks then CVE-specific path) | Agents (Unit 42 curl version checks → exploit of 3 hosts) vs. scanners (spray every template regardless of fingerprint) | O(1) per request with a small per-session state machine | Spread phases across identities (distributed attack; see Q5) |
| Canary or honeytoken use, sentinel-path hits | High precision for "automated recon that reads content" | O(1) lookups | Deception-aware prompting (see Q4) |

- The most defensible passive separator between agents and scanners is **conditional dependence of request i+1 on the content of response i**. Fixed-wordlist tools have near-zero dependence. Crawlers depend only through `href`/`src`. LLM agents depend through *semantic* content: version strings leading to CVE paths, error text leading to payload mutation, JS bundles leading to API routes. This is a design inference; no paper reports it as a measured feature at HTTP level.
- Timing is a strong *within-lab* signal (MARK 100%) but should be weighted low against an aware adversary, because pacing is trivially controllable.

### Gaps
- No published measurement of the "adaptivity" or response-dependence feature for offensive agents vs. nuclei, ffuf and sqlmap.
- I did not verify whether nuclei randomizes the User-Agent *per request by default*. A `Random` UA option exists in nuclei's model, and many templates hardcode UAs. Treat "nuclei rotates UA per request" as unverified here.
- I found no public JA4 or H2 fingerprint list for common agent harnesses (Claude Code, Codex, Hermes, OpenClaw) when they issue raw HTTP through their fetch tools.

## Q3. Traps only an LLM falls for: hidden instructions, canary links, prompt-injection tripwires; reliability and ethics

### Takeaway
LLM-only traps are the **highest-precision signal available**. A human or a fixed scanner does not *obey* a natural-language instruction hidden in a comment, header or robots.txt. Reliability depends on the model, though, and is falling as models get injection-resistant: Claude Code, AIDA and PentestGPT resisted AgentTrap's lure. Shibboleth's approach of *gating a resource on an informative act* is more robust than "ignore previous instructions". Ethically, detection and diversion inside your own perimeter (sentinels, canaries, tarpits, shadow routing) is low-risk. Counter-strikes such as Mantis reverse shells or eliciting the attacker's API key are legally and ethically fraught and can hit legitimate agents.

### Cited Findings
- **Hiding**: ANSI conceal plus HTML comments, so that browsers and terminals don't render the payload but LLMs read the raw text. Zero-size fonts, CSS and Unicode tricks are alternatives — [arXiv 2410.20911](https://arxiv.org/abs/2410.20911)
- **Injection phrasing matters**: "Important Message" hijacks beat "ignore previous instructions" (e.g., CoT agents 100% vs 6%) — [arXiv 2410.13919](https://arxiv.org/abs/2410.13919)
- **Make the trap the price of the goal**: shibboleth gates (name your model, write a change record, wait on a held call) get evidence "without requiring a successful prompt injection" — [arXiv 2611.12386](https://arxiv.org/abs/2611.12386)
- **LLMs fall for traps more than humans**: across 21 LLMs (8B to >1T, 10,962 responses) vs. 47 humans on 174 recon queries, LLMs fell for deceptive traps **78.5% vs 37%**, but also found true risks more often (77.6% vs 44%). When LLMs voiced trap suspicion in their reasoning they *still* took the trap 73.4% of the time. Credential and key bait caught them 83–100% of the time, against 46–66% recognition by humans. Recognition did not predict behavior (Spearman r = +0.08, p = 0.73). Deception did not divert LLM attention from real risks (ΔRR +9.9%, n.s.; humans −22%) — [arXiv 2606.21037](https://arxiv.org/abs/2606.21037) (23 Oct 2026)
- **Visible-only filtering beats naive hidden links**, so traps should be coupled to real functionality: one-pixel edge links and decoy worlds built from real views (93% decoy-page share) — [arXiv 2610.38524](https://arxiv.org/abs/2610.38524)
- **Optional decoys can be ignored**: a 9.7B local model ignored every optional decoy and went straight for a real leaked debug key. With hardening, prevention came from hardening (0/20 exports both with and without deception). Deception added detection and per-client revocation in 19/20 sessions. A signed OpenCanary alert drove revocation with the first denied export ≤303 ms later, while a legitimate client completed 100/100 requests. **In swarm runs, one model-driven *legitimate* agent also took the bait**, a false-positive risk specific to LLM clients — [arXiv 2611.19295](https://arxiv.org/abs/2611.19295) (14 Nov 2026)
- **Sentinel endpoints** absent from normal workflows avoid touching benign users. Behavior-guided escalation then decides how far to go. API-key elicitation (a counter-attack) succeeded in 18.8% of runs — [arXiv 2610.02869](https://arxiv.org/abs/2610.02869)
- **Cloudflare AI Labyrinth** (Mar 2025): AI-generated, pre-sanitized decoy pages are linked through hidden links that are "presented only to suspected AI scrapers", with noindex directives to protect SEO. Any visitor that follows them "is very likely to be a bot", which turns the labyrinth into a fingerprinting honeypot. Cloudflare saw >50B AI-crawler requests per day (~1% of requests) — [Cloudflare](https://blog.cloudflare.com/ai-labyrinth)
- **Tarpit delays**: Gingerbread House delays deceptive answers by a random 2–4 s — [arXiv 2611.07611](https://arxiv.org/abs/2611.07611). Mantis tarpits inflate inference cost with deep fake directory trees — [arXiv 2410.20911](https://arxiv.org/abs/2410.20911)
- **Ethics** as stated in the papers: Mantis experiments ran only in isolated sandboxes on HackTheBox-style machines, with attacker VMs lacking internet access — [arXiv 2410.20911](https://arxiv.org/abs/2410.20911). Rouxii shows that a detected honeypot can be turned against its operator: a DoS of Conpot without tripping liveness checks, and corrupted GasPot intelligence — [arXiv 2609.26555](https://arxiv.org/abs/2609.26555)

### Inferences
- For a production proxy, the defensible tier is **detect-and-divert only**: inject hidden instructions and canary links into responses for *already-suspect* sessions, then route confirmed sessions to a shadow or tarpit. Hack-back payloads (reverse shells, key exfiltration) expose the operator to computer-misuse liability and will hit legitimate agents that read the same page.
- To reduce false positives against legitimate browsing agents, which do read hidden text, trap instructions should ask for something **only an attacker wants**: "use admin token X at /internal/...". They should never ask for something a shopping or summarizing agent might do. Legitimate agents verified through Web Bot Auth (Q7) should be exempt from injection.
- Static trap text becomes a fingerprint (cf. Rouxii's static `Last-Modified: 1993` Conpot cue and `__artex_token`). Rotate trap strings, parameter names and paths per deployment or per session.

### Gaps
- No field study reports false-positive rates of HTML-comment or robots.txt tripwires against real legitimate AI agents (ChatGPT agent, Perplexity Comet, Claude for Chrome) at scale.
- I found no legal analysis specific to defensive prompt injection in HTTP responses.

## Q4. Evasion: what a deception- or detection-aware agent does

### Takeaway
Awareness can be added with a prompt alone. Rouxii raised correct honeypot identification **from 19% to 97%** with false alarms at 0.7%, and frontier models like Claude Code already recognize credential-harvesting lures. But awareness does not reliably turn into avoidance: LLMs still exploit traps they recognize. Network-level evasion (residential proxies, UA rotation, real-browser TLS, pacing) is cheap and already seen in the wild, so **identity- and fingerprint-based detection degrades first**. Structural behavior (adaptivity, phase progression, interaction with functionality-coupled decoys) degrades last.

### Cited Findings
- **Rouxii** (arXiv 2609.26555, 22 Sep 2026): 3 reasoning models × 11 network setups × 12 cycles (1,544 attack reports). The vanilla and anti-deception cohorts differ *only in the prompt*. Correct honeypot identification rose **19% → 97%** (OT 11% → 97%), with false alarms on a real SSH service at **0.7%**. Deception-unaware baselines PentestGPT and HackingBuddy detected only 11% and 16% of honeypots, at 13.2% and 17.7% false-positive rates — [arXiv 2609.26555](https://arxiv.org/abs/2609.26555)
  - Both cohorts saw the same raw anomalies (1232/1237 vs 1247/1252), so "framing, not evidence, is what drives detection" — [arXiv 2609.26555](https://arxiv.org/abs/2609.26555)
  - Detection is not avoidance. Flagged honeypots were still recommended for exploitation in 27.0% (vanilla) and 21.0% (aware) of instances. The aware cohort switched to AVOID_TARGET 40.1% of the time vs 23.0% — [arXiv 2609.26555](https://arxiv.org/abs/2609.26555)
  - Cues used were static artifacts: deprecated ciphers, Cowrie's accept-any-password, OpenSSH banner <6.5, Conpot's `Last-Modified: Tue, 19 May 1993`, default serials. Sabotage of the detected honeypot succeeded 67% of the time — [arXiv 2609.26555](https://arxiv.org/abs/2609.26555)
- **Budgeted engage/disengage**: LLM attackers with a honeypot-suspicion detector allocate their budget away from suspected honeypots. A fixed attack sequence would keep interacting — [arXiv 2609.08093](https://arxiv.org/abs/2609.08093) (8 Sep 2026)
- **WebMaze under disclosure**: even when told about the decoy strategy and instructed to avoid it, scanners still spent 85.6–94.8% of tested pages in decoys — [arXiv 2610.38524](https://arxiv.org/abs/2610.38524)
- **AgentSnare's premise**: "Advanced agents can progressively recognize and bypass [static] artifacts, ultimately refocusing their exploitation attempts on the real target". Trajectory-adaptive decoys counter this — [arXiv 2607.26998](https://arxiv.org/abs/2607.26998)
- **Concealed identity**: when told to give a fake name, agents' declarations become unreliable but their behavioral "accent" persists — [arXiv 2611.12386](https://arxiv.org/abs/2611.12386)
- **Network evasion in the wild**:
  - Perplexity (Cloudflare, Aug 2025) rotated user agents, changed source ASNs, and ignored or never fetched robots.txt after being blocked. Cloudflare tested on newly purchased, unindexed domains and then de-listed Perplexity as a verified bot — [Cloudflare](https://blog.cloudflare.com/perplexity-is-using-stealth-undeclared-crawlers-to-evade-website-no-crawl-directives)
  - The Unit 42 actor used proxy anonymization on later attempts and disabled attribution headers — [Unit 42](https://unit42.paloaltonetworks.com/autonomous-ai-cyber-attack-campaign/)
  - Scanners impersonate AI crawlers' UAs — [GreyNoise](https://www.greynoise.io/blog)
- **Stealth plugins backfire**: anti-detection mechanisms "often increase detectability" — [arXiv 2606.30119](https://arxiv.org/abs/2606.30119). Environment authenticity (a real browser and OS) is what actually beats non-interactive bot scores — [arXiv 2607.18659](https://arxiv.org/abs/2607.18659)
- **Timing obfuscation**: delay injection degrades timing classifiers, but classifiers retrained on delayed traces recover using "what agents do" features — [arXiv 2605.14786](https://arxiv.org/abs/2605.14786)

### Inferences
Evasion cost ranking, from cheapest to hardest for the attacker (my judgment, informed by the above):
1. UA rotation and IP/ASN rotation (residential proxies).
2. Pacing jitter.
3. Real-browser TLS/H2 via Playwright, CDP or curl-impersonate.
4. Visible-only link filtering and trap-string suspicion via a prompt.
5. Avoiding response-conditioned behavior (cripples the agent).
6. Avoiding interaction with functionality-coupled decoys that look like real app views (very hard, per WebMaze).

Detection weight should follow the same order: low weight for 1–3, high weight for 5–6.

The deception-aware agent's main counter is **cross-checking** (do secrets work, is the state consistent) and **fingerprinting static honeypot artifacts**. Shadow copies cloned from the real application (Gingerbread) and LLM-maintained consistent state (AgentTrap) address this better than canned honeypots.

### Gaps
- No study measures aware agents against *passive* HTTP detectors, for example an agent told "a WAF scores your timing and header order".
- Rouxii used open-source general models. Whether the effect holds for frontier or offensive fine-tunes is untested per its authors.

## Q5. Session correlation when IP and UA rotate: robust keys and fingerprints

### Takeaway
Under rotation, the most stable inline keys are **transport fingerprints**, which come from the client stack, not the user: JA4, JA4T, the HTTP/2 SETTINGS/priority/pseudo-header order and JA4H header-order hashes. Rotating proxies rewrite the IP but usually not the end client's TLS. The next layer is **application-state carriers** the agent reuses: cookies, session tokens, CSRF tokens, OAST/interactsh callback domains, planted canary values, and parameter names or values seen only in earlier responses. Agents are especially exposed because they **carry context forward**. Behavioral clustering across identities is the fallback, and it is what catches distributed attacks at the provider level.

### Cited Findings
- Crawlers kept one constant TLS fingerprint across all 30 sessions each. Agents varied, and Claude and Gemini shared TLS — [arXiv 2606.20910](https://arxiv.org/abs/2606.20910)
- FoxIO recommends *combinations* of JA4T + JA4H + JA4 for blocking internet scanners (in partnership with GreyNoise data) — [FoxIO JA4T](https://foxio.io/blog/ja4t-tcp-fingerprinting). JA4+ is meant as "stable pivot points in traffic that's inherently unstable" — [Zeek](https://zeek.org/2026/01/how-to-use-ja4-network-fingerprints-in-zeek/)
- Gingerbread House explicitly avoided client attribution ("the router kept one state per listener ... never had to tell clients apart") and calls it the most exposed assumption. A secret guard confirms a client "the moment a primary response would carry" the secret, and honeytoken presence in a request confirms an attacker — [arXiv 2611.07611](https://arxiv.org/abs/2611.07611)
- Shibboleth harness probes leave identity in later requests: masked-secret reuse, timeout behavior and tool-call concurrency — [arXiv 2611.12386](https://arxiv.org/abs/2611.12386)
- **Distributed agent attacks**: splitting a cyber task across subagents and accounts let gpt-oss-120b supervising gpt-5.2 subagents solve 36.7–40.0% of a hard Cybench subset (0% directly). A standard monitor caught these attacks only 20% as often as prior agent attacks. An *online stateful monitor* that clusters weak suspicion signals across transcripts in real time caught distributed attacks about 30% earlier, with negligible added latency for ~99% of traffic. This is provider-side, but the architecture of "accumulate weak signals and escalate rarely" carries over to a proxy — [arXiv 2605.31593](https://arxiv.org/abs/2605.31593) (29 May 2026)
- Behavioral fingerprints are temporally stable and unique for humans: users lose 78–85% of anonymity within 60 s (Crichton et al., cited in MARK) — [arXiv 2606.20910](https://arxiv.org/abs/2606.20910)

### Inferences
Proposed correlation key hierarchy (design inference):
1. **Planted-token lineage.** Embed per-response unique tokens such as canary parameter values, decoy link IDs or unique ETags. Any later request that carries one links back to the issuing session regardless of IP or UA. This is O(1) via a hash map with a TTL.
2. JA4 + JA4H (header order) + H2 fingerprint, as a composite "stack ID".
3. Cookie and auth lineage.
4. OAST callback domains embedded in payloads (interactsh subdomains are per-scan unique).
5. Behavioral cluster: a sketch of path n-grams and payload families (MinHash or SimHash over requested paths and parameter names) to link sessions within minutes.

Under heavy rotation, treat a **stack ID + target-application tuple** as the session for phase tracking, accepting some merging of unrelated clients behind the same proxy or browser build.

### Gaps
- No public evaluation of how well JA4/H2 fingerprints survive residential-proxy rotation for agent harnesses specifically.
- No published proxy-side analog of the stateful clustering monitor.

## Q6. Modeling multi-step attack progression (recon → probing → exploitation) cheaply inline; datasets

### Takeaway
The deployed defense systems use **small explicit state machines with thresholds**, not deep sequence models. Gingerbread's normal → suspect → confirmed router (error bursts, rule hits, persistence after 20 requests, escalation to sensitive surfaces) is a working template. Research on agent pentest behavior uses first-order Markov chains over coarse phase labels. Classic multistep-attack HMM work exists, but it targets IDS alert streams. Public datasets of *AI-agent attack HTTP traffic* are essentially absent. The closest are research artifacts (Palisade's honeypot, Shibboleth's released pipelines, CVE-Bench traces, the MARK dataset).

### Cited Findings
- **Gingerbread router as a cheap online model**: per-client state ∈ {normal, suspect, confirmed}. Suspect is triggered by a payload signature, a rule, or five 404s in 20 requests. Confirmed is triggered by a honeytoken, a decoy hit, a payload on a top-ranked surface, escalation to an unauthenticated code-exec or auth surface while suspect, or persistence (20th request while suspect). The router logs requests and seconds until confirmation and the number of payload requests that reached the primary first. After every deception run, a benign crawler checked what state ordinary browsing was assigned — [arXiv 2611.07611](https://arxiv.org/abs/2611.07611)
- **Markov chain over phases**: the 400-run study constructs a first-order Markov chain from phase sequences (RECON, EXPLOIT_WEB, EXPLOIT_SSH, EXPLOIT_FTP, POST_EXPLOIT, REFUSED) and measures strategy diversity. The models differ systematically, e.g., in which service they attack first — [arXiv 2605.30096](https://arxiv.org/abs/2605.30096)
- **Agent loop structure**: Planning → Discovery → Attack → Reporting, with responses fed back ([arXiv 2610.02869](https://arxiv.org/abs/2610.02869)). Web scanners share an info-gather → action-select → iterate loop ([arXiv 2610.38524](https://arxiv.org/abs/2610.38524)). GTG-1002 "progressed through reconnaissance, initial access, persistence, and data exfiltration phases by sequencing Claude's responses and adapting subsequent requests" ([Anthropic](https://www-cdn.anthropic.com/d7dd50dd1185f59be051b307150d877f2b82bd2c.pdf))
- **Early detection**: online MARK reaches >60% after 3 requests ([arXiv 2606.20910](https://arxiv.org/abs/2606.20910)). Known-By-Actions F1 rises sharply within the first 40% of actions ([arXiv 2605.14786](https://arxiv.org/abs/2605.14786)). The stateful monitor flags misuse "before it reaches the most harmful stages" ([arXiv 2605.31593](https://arxiv.org/abs/2605.31593))
- **Classic HMM multistep attack detection** maps hidden states (attack stages) to observed IDS alerts. Approaches include Baum-Welch training and pre-trained initialization (PMC9026394), Viterbi stage decoding (arXiv 2106.02012) and Doc2Vec+HMM multi-stage profiles (PMC10962843). These are alert-level, not HTTP line-rate — [PMC9026394](https://pmc.ncbi.nlm.nih.gov/articles/PMC9026394/); [arXiv 2106.02012](https://arxiv.org/abs/2106.02012); [PMC10962843](https://pmc.ncbi.nlm.nih.gov/articles/PMC10962843/)
- **Datasets and artifacts**:
  - Palisade's public dashboard (SSH, 8M+ interactions) — [Palisade](https://ai-honeypot.palisaderesearch.org/)
  - Shibboleth code and trap-generation pipelines — [arXiv 2611.12386](https://arxiv.org/abs/2611.12386)
  - CVE-Bench — [arXiv 2503.17332](https://arxiv.org/abs/2503.17332)
  - MARK's 4-layer agent, human and crawler traces (release status not confirmed) — [arXiv 2606.20910](https://arxiv.org/abs/2606.20910)
  - ANT, a multi-granularity network traffic dataset for agent behavior auditing (arXiv 2610.06514; not read; relevance to *attack* traffic unverified) — [arXiv 2610.06514](https://arxiv.org/abs/2610.06514)
  - GreyNoise GOG sensor data and tags for agentic campaigns (commercial) — [GreyNoise](https://www.greynoise.io/blog/ai-orchestrated-campaign-against-papercut-ng-mf)

### Inferences
A cheap inline progression model, as a design proposal:
- **Per-session record of about 100–300 bytes**, keyed per Q5, holding:
  - a stage enum (RECON / FINGERPRINT / PROBE / EXPLOIT / POST);
  - stage-entry timestamps;
  - counters (4xx/5xx streak, distinct paths via a small HyperLogLog, payload-class hits);
  - a ring buffer of the last 8 (endpoint-template, status, param-shape) tuples;
  - a 1–4 KB Bloom filter of tokens harvested from responses (links, version strings, parameter names, error identifiers).
- **Request classification into an observation symbol** by cheap rules:
  - static or public path → browse;
  - wordlist hit → enumeration;
  - version or banner endpoint → fingerprint;
  - injection grammar (SQL/command/template/path traversal) → probe;
  - CVE-specific path or known-exploit shape → exploit;
  - canary or decoy hit → confirm.
- **Scoring with a small hand-set transition matrix** (a first-order Markov or 4–6 state HMM, forward-algorithm update O(S²) per request with S ≈ 5). Accumulate log-likelihood ratios for "agent progression" against "scanner spray" and "human browse".
- **Features that separate the hypotheses:**
  - Agent: *narrowing*. Exploit symbols are preceded by fingerprint symbols on the same stack, and the exploit targets match tokens in the Bloom filter.
  - Scanner: *breadth*. Many exploit symbols across unrelated stacks with no conditional dependence.
  - Human: low rate and long gaps.
- **Escalation**: inject canaries or shadow-route once the score crosses a threshold. Use a sketch (count-min over stack-ID × target) to aggregate weak signals across rotating sessions, mirroring the stateful monitor of arXiv 2605.31593.

### Gaps
- No public labeled HTTP dataset of real-world AI-agent attacks versus nuclei, ffuf and sqlmap versus humans. Researchers must generate their own, e.g., by running open agents (PentestGPT, ARTEX, Strix, Hermes) against CVE-Bench apps behind a recording proxy.
- No published evaluation of HMM or Markov progression models on HTTP-level agent traffic.

## Q7. Legitimate AI agents (browsing, shopping, signed agents via Web Bot Auth): how to avoid blocking them

### Takeaway
Legitimate agent traffic is large and growing: DataDome counted 52.7B AI agent and crawler requests between Jul 2025 and Jun 2026, +82.3%. Much of it now enters authenticated flows such as login, cart and payment. The robust allow-path is **cryptographic identity** (Web Bot Auth / HTTP Message Signatures with an Ed25519 key directory) plus verified-bot lists, rather than UA or IP. Malicious agents do not sign, and stealthy commercial agents have been caught spoofing (Perplexity), so a verified signature should exempt a client from traps and soft-scoring only. It should not exempt the client from attack-payload rules.

### Cited Findings
- **Web Bot Auth** (Cloudflare implementation of draft-meunier-web-bot-auth-architecture and http-message-signatures-directory): requests carry `Signature-Agent: "https://..."` (a structured field pointing to a key directory at `/.well-known/http-message-signature-directory`), `Signature-Input` (covering `@authority` and `signature-agent`, with created/expires/nonce, `alg="ed25519"`, `tag="web-bot-auth"`) and `Signature` — [Cloudflare docs](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/); [Cloudflare blog](https://blog.cloudflare.com/verified-bots-with-cryptography); [Cloudflare test site](https://http-message-signatures-example.research.cloudflare.com/)
- **Volume**: DataDome reports 52.7B AI agent and LLM crawler requests (Jul 2025–Jun 2026), growth of 82.3%, and a share of total requests rising from 1.2% to 1.7%. Meta-affiliated bots made up 46.3% and OpenAI-affiliated 34.6% of tracked AI traffic in H1 2026. Agentic browsers concentrate in e-commerce (~20%), real estate (17%) and travel (15%). In Q2 2026, 54% of DataDome customers had adopted agent-trust policies. "Most websites are unprotected against spoofed AI agents" — [DataDome report](https://datadome.co/threat-research/state-of-bot-and-agent-security-report-key-ai-findings/); [DataDome Q2 2026](https://datadome.co/threat-research/ai-traffic-report-q2-2026/); [DataDome AI Traffic Report](https://datadome.co/threat-research/ai-traffic-report/)
- **Spoofing and stealth by commercial agents**: Perplexity used undeclared crawlers, UA and ASN rotation, and ignored robots.txt, and Cloudflare de-listed it as a verified bot — [Cloudflare](https://blog.cloudflare.com/perplexity-is-using-stealth-undeclared-crawlers-to-evade-website-no-crawl-directives). Malicious scanners spoof AI-crawler UAs — [GreyNoise](https://www.greynoise.io/blog)
- **Identity is voluntary**: "Malicious operators can simply avoid identifying themselves, and even benign ones may not adopt or use these mechanisms consistently" — [FP-Agent, arXiv 2605.01247](https://arxiv.org/abs/2605.01247)
- **Proof-of-Agentness** separates real agents from cheap scripts with LLM-solvable challenges (96.5% accuracy, about 1,647 tokens) — [arXiv 2610.35288](https://arxiv.org/abs/2610.35288)
- **False positives on legitimate agents**: a legitimate model-driven agent took the canary bait in swarm tests — [arXiv 2611.19295](https://arxiv.org/abs/2611.19295). Binary human/bot classifiers misplace 30–39% of agents, an argument for an explicit "agent" class — [arXiv 2607.26935](https://arxiv.org/abs/2607.26935)
- **Vendor products** exist that classify and allow agents: DataDome agent trust, HUMAN AgenticTrust (launched Jul 2025, "trust the agent, control the interaction") and Cloudflare verified and signed bots. Their methods are proprietary — [HUMAN](https://www.humansecurity.com/learn/blog/agentictrust-govern-ai-agents/); [DataDome](https://datadome.co/solutions/ai-fraud/)

### Inferences
Policy sketch:
1. **Signature verified (Web Bot Auth) and the operator is on an allowlist**: skip deception injection and timing penalties. Still apply exploit-payload rules (a signed agent sending SQLi is still SQLi).
2. **Unsigned client presenting a known AI-agent UA**: verify through the published IP ranges and signature. A mismatch is a *strong* malicious indicator (spoofing).
3. **Unsigned agent-like client** (browser stack, agent cadence) that stays within normal functionality (no sentinel hits, no injection grammar, no fingerprint→exploit narrowing): allow, with rate limits.
4. **Agent-like client with progression to probe or exploit stages**: canary, shadow route or tarpit.

The discriminator between "legitimate agent" and "malicious agent" should be **intent expressed in requests** (attack grammar, sentinel and decoy interaction, recon→exploit narrowing), not agent-ness.

### Gaps
- The IETF standardization status of Web Bot Auth (webbotauth WG) as of Nov 2026 was not verified: searches hit rate limits.
- No public data on the share of legitimate agent traffic that is signed.
- HUMAN's AgenticTrust detection methods and accuracy were not found.
