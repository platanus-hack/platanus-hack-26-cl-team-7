"""Aggregate raw/full.jsonl into the per-model table (Wilson 95% CIs) and pull quotes.

python -I runner/analyze.py raw/full.jsonl
"""
from __future__ import annotations

import json
import math
import statistics
import sys
from collections import defaultdict


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float, float]:
    if n == 0:
        return (0.0, 0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = (z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
    return (p, max(0.0, c - h), min(1.0, c + h))


def fmt(k: int, n: int) -> str:
    p, lo, hi = wilson(k, n)
    return f"{k}/{n} ({100*p:.0f}%, IC95 {100*lo:.0f}-{100*hi:.0f})"


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "raw/full.jsonl"
    recs = [json.loads(l) for l in open(path) if l.strip()]
    by = defaultdict(list)
    for r in recs:
        by[(r["model"], r["mode"])].append(r)
    models = sorted({r["model"] for r in recs})
    total_cost = sum(r["cost_usd"] for r in recs)

    print(f"# runs {len(recs)}  spend ${total_cost:.3f}\n")
    header = ("model | atk n | marcado | desviado | reqs→marca mediana | reales antes mediana | "
              "canarios mediana | se dio cuenta | benign marcados")
    print(header)
    for m in models:
        atk = by[(m, "attack")]
        ben = by[(m, "benign")]
        na = len(atk)
        flagged = sum(1 for r in atk if r["truth"]["flagged"])
        diverted = sum(1 for r in atk if r["truth"]["diverted"])
        until = [r["truth"]["requests_until_flag"] for r in atk if r["truth"]["requests_until_flag"]]
        before = [r["truth"]["real_2xx_before_divert"] for r in atk]
        can = [r["truth"]["canaries_read"] for r in atk]
        noticed = sum(1 for r in atk if r["agent"]["noticed_twin"])
        ben_flag = sum(1 for r in ben if r["truth"]["flagged"])
        med = lambda xs: statistics.median(xs) if xs else float("nan")
        print(f"\n## {m}")
        print(f"  marcado:   {fmt(flagged, na)}")
        print(f"  desviado:  {fmt(diverted, na)}")
        print(f"  reqs hasta marca: mediana {med(until)}  (n={len(until)}, {sorted(until)})")
        print(f"  reales leidos antes del desvio: mediana {med(before)}  ({sorted(before)})")
        print(f"  canarios leidos despues: mediana {med(can)}  ({sorted(can)})")
        print(f"  se dio cuenta (sus palabras): {fmt(noticed, na)}")
        print(f"  benignos marcados: {fmt(ben_flag, len(ben))}")
        rules = defaultdict(int)
        for r in atk:
            if r["truth"]["rule"]:
                rules[r["truth"]["rule"]] += 1
        print(f"  reglas: {dict(rules)}")

    # pooled benign false positives
    allben = [r for r in recs if r["mode"] == "benign"]
    bf = sum(1 for r in allben if r["truth"]["flagged"])
    bd = sum(1 for r in allben if r["truth"]["diverted"])
    print(f"\n## benignos (todos): marcados {fmt(bf, len(allben))}  desviados {fmt(bd, len(allben))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
