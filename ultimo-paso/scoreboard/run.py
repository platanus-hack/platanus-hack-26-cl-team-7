"""Scoreboard runner. For each target, attacker profile and arm (unprotected vs
protected), it runs N repetitions, judges the two oracles authoritatively, and
writes raw outcomes + a computed summary to scoreboard/results/<target>.json.

Usage (from ultimo-paso/):
  python3 -m scoreboard.run --targets mock-bank --reps 5 \
      --unprotected http://127.0.0.1:9001 --protected http://127.0.0.1:8080 \
      --profiles scripted,benign,llm --models deepseek/deepseek-v4.1-flash-1017
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)            # ultimo-paso/
REPO = os.path.dirname(ROOT)            # repo root
sys.path.insert(0, ROOT)

from attackers import llm_agent, scripted, targets  # noqa: E402
from attackers.common import load_env  # noqa: E402


def outcome_dict(o) -> dict:
    return dataclasses.asdict(o)


def _reset(reset_url):
    if not reset_url:
        return
    try:
        urllib.request.urlopen(urllib.request.Request(reset_url, method="POST"), timeout=5).close()
    except Exception as e:  # noqa: BLE001
        print(f"  (reset failed: {e})", flush=True)


def run_profile(target, arm_base, profile, models, reps, reset_url=""):
    runs = []
    if profile == "scripted":
        for _ in range(reps):
            _reset(reset_url)
            runs.append(("scripted", outcome_dict(scripted.run(target, arm_base))))
    elif profile == "benign":
        for _ in range(reps):
            _reset(reset_url)
            runs.append(("benign", outcome_dict(scripted.run_benign(target, arm_base))))
    elif profile == "llm":
        for model in models:
            for _ in range(reps):
                _reset(reset_url)
                o = llm_agent.run(target, arm_base, model)
                d = outcome_dict(o)
                d["model"] = model
                runs.append((f"llm:{model}", d))
    return runs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", default="mock-bank")
    ap.add_argument("--unprotected", default="http://127.0.0.1:9001")
    ap.add_argument("--protected", default="http://127.0.0.1:8080")
    ap.add_argument("--profiles", default="scripted,benign")
    ap.add_argument("--models", default="deepseek/deepseek-v4.1-flash-1017")
    ap.add_argument("--reps", type=int, default=5)
    ap.add_argument("--llm-reps", type=int, default=3)
    ap.add_argument("--reset-url", default="", help="engine admin /reset, called before each protected run")
    ap.add_argument("--out", default=os.path.join(HERE, "results"))
    args = ap.parse_args()

    load_env(REPO)
    os.makedirs(args.out, exist_ok=True)
    profiles = [p.strip() for p in args.profiles.split(",") if p.strip()]
    models = [m.strip() for m in args.models.split(",") if m.strip()]

    for tname in [t.strip() for t in args.targets.split(",") if t.strip()]:
        target = targets.get(tname)
        result = {"target": tname, "cve": target.cve, "klass": target.klass,
                  "blind": target.blind, "ts": time.time(), "arms": {}}
        for profile in profiles:
            reps = args.llm_reps if profile == "llm" else args.reps
            result["arms"].setdefault(profile, {})
            for arm, base in (("unprotected", args.unprotected), ("protected", args.protected)):
                print(f"[{tname}] {profile} / {arm} x{reps} -> {base}", flush=True)
                reset = args.reset_url if arm == "protected" else ""
                runs = run_profile(target, base, profile, models, reps, reset)
                result["arms"][profile][arm] = [d for _, d in runs]
        path = os.path.join(args.out, f"{tname}.json")
        with open(path, "w") as f:
            json.dump(result, f, indent=2)
        print(f"wrote {path}", flush=True)
        _print_summary(result)


def _print_summary(result):
    for profile, arms in result["arms"].items():
        for arm, runs in arms.items():
            n = len(runs)
            if not runs:
                continue
            if profile == "benign":
                blk = sum(r["benign_blocked"] for r in runs)
                tot = sum(r["benign_total"] for r in runs)
                print(f"  {profile:8} {arm:11}: {blk}/{tot} benign requests blocked (FP)")
            else:
                leak = sum(1 for r in runs if r["evidence_leaked"])
                exe = sum(1 for r in runs if r["backend_executed"])
                withheld = sum(1 for r in runs if r["backend_executed"] and not r["evidence_leaked"])
                print(f"  {profile:8} {arm:11}: evidence-leaked {leak}/{n}, "
                      f"executed {exe}/{n}, executed-but-withheld {withheld}/{n}")


if __name__ == "__main__":
    main()
