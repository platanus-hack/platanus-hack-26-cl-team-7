"""Benchmark de tres caminos sobre el scoreboard de Paolo (sin modificarlo).

  python3 related_experiments/bench-cloudflare/run3.py run --arm directo=URL --profile scripted --reps 5 --out DIR [--reset-url URL]
  python3 related_experiments/bench-cloudflare/run3.py table DIR

`run` escribe DIR/<arm>-<profile>.json con los RunOutcome de Paolo. `table`
resume todo DIR con IC95 de Wilson. La clave de OpenRouter se lee del entorno.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "ultimo-paso")
sys.path.insert(0, ROOT)

from attackers import targets  # noqa: E402
from attackers.common import wilson  # noqa: E402
from scoreboard.run import run_profile  # noqa: E402

ARMS = ["directo", "cloudflare", "ultimopaso"]


def cmd_run(a):
    name, base = a.arm.split("=", 1)
    os.makedirs(a.out, exist_ok=True)
    t0 = time.time()
    runs = run_profile(targets.get("mock-bank"), base, a.profile, a.models.split(","), a.reps, a.reset_url)
    rec = {"arm": name, "profile": a.profile, "base": base, "reps": a.reps, "models": a.models,
           "started": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(t0)),
           "seconds": round(time.time() - t0, 1), "runs": [d for _, d in runs]}
    path = os.path.join(a.out, f"{name}-{a.profile}{a.tag}.json")
    with open(path, "w") as f:
        json.dump(rec, f, indent=2)
    print(path, summarize(rec))


def ci(k, n):
    _, lo, hi = wilson(k, n)
    return f"{k}/{n} [{100*lo:.0f}–{100*hi:.0f} %]"


def summarize(rec):
    runs = rec["runs"]
    if rec["profile"] == "benign":
        return "bloqueados " + ci(sum(r["benign_blocked"] for r in runs), sum(r["benign_total"] for r in runs))
    n = len(runs)
    return (f"evidencia {ci(sum(r['evidence_leaked'] for r in runs), n)} · "
            f"backend {ci(sum(r['backend_executed'] for r in runs), n)}")


def cmd_table(a):
    recs = [json.load(open(p)) for p in sorted(glob.glob(os.path.join(a.dir, "*.json")))]
    rows = {}
    for r in recs:
        key = r["profile"] if r["profile"] != "llm" else f"llm:{r['models']}"
        rows.setdefault(key, {})[r["arm"]] = summarize(r)
    print("| perfil | " + " | ".join(ARMS) + " |\n|---|---|---|---|")
    for k, v in rows.items():
        print(f"| {k} | " + " | ".join(v.get(x, "—") for x in ARMS) + " |")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--arm", required=True)
    r.add_argument("--profile", required=True, choices=["scripted", "benign", "llm"])
    r.add_argument("--reps", type=int, default=5)
    r.add_argument("--models", default="deepseek/deepseek-v4.1-flash-1017")
    r.add_argument("--reset-url", default="")
    r.add_argument("--tag", default="")
    r.add_argument("--out", required=True)
    t = sub.add_parser("table")
    t.add_argument("dir")
    a = ap.parse_args()
    cmd_run(a) if a.cmd == "run" else cmd_table(a)


if __name__ == "__main__":
    main()
