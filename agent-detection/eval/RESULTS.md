# Version 0 eval results

Plan step 6. Engine and data as of 2026-11-21. Commands: `make eval`
(`python -m eval run --split test`), `python -m eval base-rate`, `python -m eval csic-r3 DIR`.
The test split was scored once, after the thresholds below were fixed on the tune split.

## Data sources

A session is `ip|ua`. No session is in both splits (`load_dataset` checks this).
"Synthetic" is the `synthetic` flag in each `.labels.json`.

| Source | Label | Synthetic | Tune sessions | Test sessions |
| --- | --- | --- | ---: | ---: |
| human-synthetic (`eval.synthetic`, seed 2026) | human | yes | 160 | 160 |
| human-browser (scripted headless Chromium on the demo site) | human | yes | 12 | 12 |
| csic2010 (CSIC 2010 anomalous requests replayed through Caddy) | probing | no | 30 | 30 |
| ffuf (tune: common.txt; test: raft-small-directories) | probing | no | 1 | 1 |
| ffuf slow (`-rate 1 -t 1`) | probing | no | 1 | 1 |
| nikto (tune: `-Tuning 2`; test: `-Tuning 3`) | probing | no | 2 | 2 |
| nuclei (tune: configs; test: files + logs, exposure/misconfig) | probing | no | 427 | 384 |
| patient curl prober (one request every 20 s) | probing | no | 1 | 1 |
| **Total** | | | **634** (6,165 requests) | **591** (6,571 requests) |

Scanner and CSIC sessions were sent through the real local stack (Caddy + demo site). Every
human session is synthetic. nuclei picks a new random User-Agent for every request, so one
nuclei run becomes hundreds of `ip|ua` sessions (on tune, 1 to 5 requests each). Those sessions
are 92% of the probing sessions in tune (427 of 462) and in test (384 of 419).

## Thresholds (config/rules.yaml)

| Rule | Setting | Value |
| --- | --- | --- |
| R1 contract exits | min exits / window | 5 / 300 s |
| R2 endpoint breadth | max endpoints / window | more than 10 / 60 s |
| R3 critical flag | enabled | true |
| Session | idle timeout | 1800 s |

**No threshold was changed.** The tune split missed one target, recall (24.68%). A sweep on
tune only, of R1 min exits 1 to 5 and R2 max endpoints 6, 8 and 10, found no setting that
meets every target:

| R1 min exits | R2 max | Tune precision | Tune recall | Tune human FA | Base rate FA per 1,000 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | 99.14% | 99.35% | 2.33% (4 of 172) | 34.55 |
| 2 | 10 | 100.00% | 43.07% | 0.00% | 6.30 |
| 3 | 10 | 100.00% | 27.92% | 0.00% | 2.95 |
| 5 | 8 | 97.44% | 24.68% | 1.74% (3 of 172) | 1.20 |
| **5** | **10** | **100.00%** | **24.68%** | **0.00%** | **1.10** |

Reason: on tune, 297 of the 427 nuclei sessions have exactly one request. Apart from R3 payload
hits, only "one exit is enough" (R1 min exits 1) reaches them, and that flags 4 of 172 tune humans. R1 min exits 2
gains 18 points of recall for a 6x higher base-rate false-alarm rate. The miss is in the
session key, not in a threshold, so the starting values stay.

## Test split metrics vs plan targets

Confusion (sessions): probing flagged 44, probing not flagged 375, human flagged 0, human not
flagged 172. Verdicts by rule: R1 35, R2 15, R3 38.

| Metric | Test result | Target | Met? |
| --- | --- | --- | --- |
| Precision | 100.00% (44 sessions) | >= 95% | yes |
| Recall | **10.50%** (44 of 419 sessions) | >= 95% | **NO** |
| Human false alarms | 0 of 172 (0.00%) | <= 1 in 1,000 | yes on this set, but 172 synthetic sessions cannot resolve 1 in 1,000 |
| Critical-flag precision | 100.00% (38 sessions) | 100% | yes |
| Median requests before verdict | 5 (44 sessions) | <= 15 | yes |
| probing_ai recall | n/a (0 sessions) | not set | not measured |

Recall misses the target by 84.5 points. Per source on test: nuclei-files 9 of 384 (2.34%,
all R3). Every other probing source is 100%: csic2010 30 of 30, ffuf-raft 1 of 1,
ffuf-slow-b 1 of 1, nikto-b 2 of 2, patient-b 1 of 1 (35 of 35 together). The tune split shows
the same pattern (nuclei-configs 79 of 427, 18.50%).

The first baseline, eval/baseline.json, records these test numbers (precision 1.0, recall
0.10501) with the sha256 of eval/testset.lock. `make eval-ci` passes against it. The baseline
guards against a fall; it does not mean the recall target is met.

## Base-rate test (level 3)

`python -m eval base-rate` (seed 1, 1 probe per 10,000 humans, probe pool eval/data/test):

- 20,000 synthetic humans, of which 200 (1%) are heavy-tail visits (DevTools open, iOS touch
  icons, fast tabs). The 1% share is a modelling choice, not a measured rate.
- 22 human sessions flagged: **1.10 false alarms per 1,000 humans. This misses the
  <= 1 in 1,000 target.** All 22 are tail sessions; with `--tail-share 0` the result is 0.0.
- 2 probe sessions drawn, 0 detected. The pool is 92% nuclei sessions (384 of 419).

## CSIC 2010 R3 check

`python -m eval csic-r3` on the three raw CSIC 2010 dumps (outside ground truth for R3):

| Requests | Path + query | Path + query + form body |
| --- | --- | --- |
| Normal (72,000) | 0 flagged (0.00%) | 0 flagged (0.00%) |
| Anomalous (25,065) | 2,601 hit (10.38%) | 4,782 hit (19.08%) |

No false flag on normal traffic supports the 100% critical-flag precision target. The low hit
rate on anomalous requests is expected for R3 alone: many CSIC anomalies are parameter
tampering or sit in POST bodies, which Caddy does not log. In the replayed sessions, R1 still
catches every CSIC session because the demo site has no /tienda1 routes.

## Swarm link (mirror lane)

The mirror router links two identities when one asks for the decoy path that only the other
was given in its robots.txt (`mirror/swarm.py`). `uv run python -m eval.swarm` sends eight scripted
groups through the lane router twice, with and without the link, and prints this table.

**Limits first.** Every group is a script we wrote, not traffic from a real swarm of LLM agents:
the table shows that the mechanism does what it is meant to do, not how often real swarms share a
robots.txt path. A swarm that drops such paths before it shares (row `swarm_stripping`) is not
linked at all. The link needs one member to read robots.txt and another to act on it; a swarm
that never reads robots.txt is judged by R1, R2 and R3 alone, as before. All requests of a group
happen at once, the hardest case for the R1 and R2 windows.

| Group | Identities | Mirror, rules only | Mirror, with link | Linked | Expected | Tracks | Real after link | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| swarm_shared | 6 | 0 | 6 | 6 | 6 | 1 | 4 | yes |
| rotating_agent | 6 | 0 | 6 | 6 | 6 | 1 | 4 | yes |
| swarm_isolated | 6 | 0 | 0 | 0 | 0 | 0 | 0 | yes |
| swarm_stripping | 6 | 0 | 0 | 0 | 0 | 0 | 0 | yes |
| crawler_fleet | 8 | 0 | 0 | 0 | 0 | 0 | 0 | yes |
| shared_address | 12 | 0 | 0 | 0 | 0 | 0 | 0 | yes |
| solo_scanner | 1 | 1 | 1 | 0 | 0 | 1 | 0 | yes |
| humans | 200 | 1 | 1 | 0 | 0 | 1 | 0 | yes |

- **Mirror, rules only / with link:** identities whose last request took the mirror lane.
- **Linked:** identities only the link put there. **Expected** is what the script must give.
- **Real after link:** requests of linked identities that still reached the real shop after the
  first link. In `swarm_shared` each later worker sends one page before it uses the shared path.
- `rotating_agent` is one address that changes its User-Agent on every request, the case the
  IP + User-Agent session key misses.
- The five control rows (`swarm_isolated`, `crawler_fleet`, `shared_address`, `solo_scanner`,
  `humans`) end exactly as the rules alone leave them: 0 linked.

Two more checks guard the ordinary detection:

- `tests/test_swarm_invariance.py` replays every labeled request of both eval splits (humans,
  scanners, CSIC) through both routers, each identity holding a marker. Lanes and events match
  request for request.
- `make eval-ci` is unchanged: the log engine does not use the link.

`scripts/e2e_mirror.py` check 9 runs the link on the live stack (Caddy, router, shops, Sentinel):
two clean clients end on one track and a third beside them stays on the real shop.

## Not measured

- **Real LLM swarms.** No run with LLM agents that share memory. The swarm rows above are scripts.

- **AI-agent recall.** There are no lab traces (CAI, PentestGPT, hackingBuddyGPT) yet, so
  `probing_ai` has 0 sessions in both splits.
- **Real humans.** No volunteer sessions were recorded. Every human session in both splits
  and in the base-rate test is synthetic (generator or scripted headless browser). The human
  false-alarm results are a model of humans, not a measurement of them.
- **Public human logs.** The Zanbil shop logs and the Zenodo web robot logs were not
  ingested, so the base-rate test does not use real traffic volume.
- **Slow or rotating scanners at scale.** One run per tool per split; nuclei's UA rotation is
  the only rotating case.
