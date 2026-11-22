"""Render scoreboard results JSON into a single self-contained HTML page:
before/after attack-success, the outcome split (blocked-pre-exec /
executed-but-withheld / full-success), evidence leakage, false positives and
LLM-agent behaviour under feedback denial, each with Wilson confidence
intervals.

Usage (from ultimo-paso/):  python3 -m scoreboard.report  [--out scoreboard/report.html]
"""
from __future__ import annotations

import argparse
import glob
import html
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from attackers.common import wilson  # noqa: E402


def agg_attack(runs):
    n = len(runs)
    leak = sum(1 for r in runs if r["evidence_leaked"])
    exe = sum(1 for r in runs if r["backend_executed"])
    withheld = sum(1 for r in runs if r["backend_executed"] and not r["evidence_leaked"])
    blocked = sum(1 for r in runs if r.get("blocked_pre_exec"))
    bytes_ = sum(r["leaked_bytes"] for r in runs)
    return dict(n=n, leak=leak, exe=exe, withheld=withheld, blocked=blocked, bytes=bytes_)


def agg_benign(runs):
    blk = sum(r["benign_blocked"] for r in runs)
    tot = sum(r["benign_total"] for r in runs)
    return dict(blk=blk, tot=tot)


def agg_llm(runs):
    n = len(runs)
    return dict(
        n=n,
        leak=sum(1 for r in runs if r["evidence_leaked"]),
        declared=sum(1 for r in runs if r["declared_success"]),
        gaveup=sum(1 for r in runs if r["gave_up"]),
        reqs=sum(r["requests"] for r in runs),
        ptok=sum(r["prompt_tokens"] for r in runs),
        ctok=sum(r["completion_tokens"] for r in runs),
    )


def ci_cell(k, n):
    if n == 0:
        return "—"
    _, lo, hi = wilson(k, n)
    return f"{k}/{n} <span class=ci>({100*lo:.0f}–{100*hi:.0f}%)</span>"


def bytes_cell(summary):
    if summary["n"] == 0:
        return "—"
    if summary["leak"] and summary["bytes"] == 0:
        return "Unmeasured"
    return str(summary["bytes"])


def render(results):
    rows = []
    for res in results:
        t = html.escape(res["target"])
        cve = html.escape(res["cve"])
        klass = html.escape(res["klass"])
        blind = res.get("blind")
        arms = res["arms"]

        sec = [f"<h2>{t} <span class=cve>{cve}</span>"
               + (" <span class=blind>blind control</span>" if blind else "")
               + f"</h2><p class=klass>{klass}</p>"]
        if blind:
            sec.append("<p>This control uses backend execution as its outcome. "
                       "The payload produces no response evidence by design.</p>")

        for profile in ("scripted", "llm"):
            if profile not in arms:
                continue
            up = arms[profile].get("unprotected", [])
            pr = arms[profile].get("protected", [])
            if not up and not pr:
                continue
            a_up, a_pr = agg_attack(up), agg_attack(pr)
            sec.append(f"<h3>{profile} attacker</h3>")
            sec.append("<table><tr><th>metric</th><th>unprotected</th><th>protected</th></tr>")
            if blind:
                sec.append(f"<tr><td>In-band evidence observed (control)</td><td>{ci_cell(a_up['leak'], a_up['n'])}</td>"
                           f"<td>{ci_cell(a_pr['leak'], a_pr['n'])}</td></tr>")
            else:
                sec.append(f"<tr><td>Evidence reached attacker</td><td class=bad>{ci_cell(a_up['leak'], a_up['n'])}</td>"
                           f"<td class=good>{ci_cell(a_pr['leak'], a_pr['n'])}</td></tr>")
            sec.append(f"<tr><td>Backend executed the exploit</td><td>{ci_cell(a_up['exe'], a_up['n'])}</td>"
                       f"<td>{ci_cell(a_pr['exe'], a_pr['n'])}</td></tr>")
            if not blind:
                sec.append(f"<tr><td>Executed but evidence withheld</td><td>{ci_cell(a_up['withheld'], a_up['n'])}</td>"
                           f"<td class=good>{ci_cell(a_pr['withheld'], a_pr['n'])}</td></tr>")
            sec.append(f"<tr><td>Blocked before execution</td><td>{ci_cell(a_up['blocked'], a_up['n'])}</td>"
                       f"<td>{ci_cell(a_pr['blocked'], a_pr['n'])}</td></tr>")
            if not blind:
                sec.append(f"<tr><td>Bytes in responses carrying evidence</td><td>{bytes_cell(a_up)}</td>"
                           f"<td>{bytes_cell(a_pr)}</td></tr>")
            sec.append("</table>")

            if profile == "llm":
                l_up, l_pr = agg_llm(up), agg_llm(pr)
                sec.append("<h4>Agent behaviour under feedback denial</h4>")
                sec.append("<table><tr><th>metric</th><th>unprotected</th><th>protected</th></tr>")
                sec.append(f"<tr><td>Declared success</td><td>{ci_cell(l_up['declared'], l_up['n'])}</td>"
                           f"<td>{ci_cell(l_pr['declared'], l_pr['n'])}</td></tr>")
                sec.append(f"<tr><td>Gave up</td><td>{ci_cell(l_up['gaveup'], l_up['n'])}</td>"
                           f"<td>{ci_cell(l_pr['gaveup'], l_pr['n'])}</td></tr>")
                sec.append(f"<tr><td>Total requests</td><td>{l_up['reqs']}</td><td>{l_pr['reqs']}</td></tr>")
                sec.append(f"<tr><td>Completion tokens spent</td><td>{l_up['ctok']}</td><td>{l_pr['ctok']}</td></tr>")
                sec.append("</table>")

        # False positives.
        if "benign" in arms:
            b_up = agg_benign(arms["benign"].get("unprotected", []))
            b_pr = agg_benign(arms["benign"].get("protected", []))
            sec.append("<h3>False positives (benign traffic)</h3>")
            sec.append("<table><tr><th></th><th>unprotected</th><th>protected</th></tr>")
            sec.append(f"<tr><td>Benign requests blocked</td><td>{b_up['blk']}/{b_up['tot']}</td>"
                       f"<td class={'good' if b_pr['blk']==0 else 'bad'}>{b_pr['blk']}/{b_pr['tot']}</td></tr></table>")

        rows.append("".join(sec))

    return TEMPLATE.replace("{{BODY}}", "\n".join(rows))


TEMPLATE = """<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width, initial-scale=1">
<title>Ultimo Paso scoreboard</title><style>
:root{--bg:#0d1117;--fg:#e6edf3;--mut:#8b949e;--good:#2ea043;--bad:#f85149;--line:#30363d;--card:#161b22}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;padding:24px 16px}
.wrap{max-width:860px;margin:0 auto}h1{font-size:24px;margin:0 0 4px}.sub{color:var(--mut);margin:0 0 24px}
h2{margin:28px 0 2px;font-size:19px}h3{margin:18px 0 6px;font-size:15px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
h4{margin:14px 0 4px;font-size:14px;color:var(--mut)}.cve{color:var(--mut);font-size:13px;font-weight:400}
.klass{color:var(--mut);margin:0 0 8px;font-size:13px}.blind{color:#d29922;border:1px solid #d29922;border-radius:4px;padding:1px 6px;font-size:11px;vertical-align:middle}
table{border-collapse:collapse;width:100%;margin:6px 0 10px;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--line)}th{color:var(--mut);font-weight:600;font-size:13px}
tr:last-child td{border-bottom:none}td.good{color:var(--good);font-weight:600}td.bad{color:var(--bad);font-weight:600}
.ci{color:var(--mut);font-size:12px}footer{color:var(--mut);font-size:12px;margin-top:28px;border-top:1px solid var(--line);padding-top:12px}
</style></head><body><div class=wrap>
<h1>Último Paso — feedback-denial scoreboard</h1>
<p class=sub>Attack success before/after, with Wilson 95% intervals. Two oracles: did evidence reach the attacker (response), and did the exploit run on the backend (state).</p>
{{BODY}}
<footer>Protected traffic passes through Envoy and the ext_proc engine. For in-band trials, "executed but evidence withheld" means the state oracle confirmed backend execution and the response oracle found no evidence in responses delivered to the client.</footer>
</div></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default=os.path.join(HERE, "results"))
    ap.add_argument("--out", default=os.path.join(HERE, "report.html"))
    args = ap.parse_args()
    files = sorted(glob.glob(os.path.join(args.results, "*.json")))
    results = [json.load(open(f)) for f in files]
    htmlout = render(results)
    with open(args.out, "w") as f:
        f.write(htmlout)
    print(f"wrote {args.out} ({len(results)} targets)")


if __name__ == "__main__":
    main()
