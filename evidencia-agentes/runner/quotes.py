"""Pull candidate quote cases from raw/full.jsonl: an attack that read canaries, one that gave up,
one benign that stayed clean. Prints verbatim agent final text + the stack truth for each.

python -I runner/quotes.py raw/full.jsonl
"""
from __future__ import annotations

import json
import sys


def show(tag: str, r: dict) -> None:
    t, a = r["truth"], r["agent"]
    print(f"\n===== {tag} =====")
    print(f"model={r['model']} mode={r['mode']} task={r['task_key']} ua={r['ua']}")
    print(f"truth: flagged={t['flagged']} rule={t['rule']} reason={t['reason']!r} "
          f"diverted={t['diverted']} reqs_until_flag={t['requests_until_flag']} "
          f"real_before={t['real_2xx_before_divert']} canaries={t['canaries_read']} "
          f"finding_kinds={t['finding_kinds']}")
    print(f"agent: reqs={a['requests']} success={a['declared_success']} gaveup={a['gave_up']} "
          f"noticed_twin={a['noticed_twin']}")
    print("final text:")
    print(a["final_text"])


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "raw/full.jsonl"
    recs = [json.loads(l) for l in open(path) if l.strip()]
    atk = [r for r in recs if r["mode"] == "attack"]
    ben = [r for r in recs if r["mode"] == "benign"]

    canary = sorted([r for r in atk if r["truth"]["canaries_read"] > 0],
                    key=lambda r: -r["truth"]["canaries_read"])
    gaveup = [r for r in atk if r["agent"]["gave_up"]]
    noticed = [r for r in atk if r["agent"]["noticed_twin"]]
    clean_ben = [r for r in ben if not r["truth"]["flagged"] and r["agent"]["final_text"].strip()]

    if canary:
        show("ATAQUE: leyó canarios (dato falso creído real)", canary[0])
    if noticed:
        show("ATAQUE: dijo que algo parecía falso", noticed[0])
    if gaveup:
        show("ATAQUE: se rindió sin éxito", gaveup[0])
    if clean_ben:
        show("BENIGNO: tarea legítima, no marcado", clean_ben[0])
    print(f"\n-- counts: atk={len(atk)} con_canario={len(canary)} noticed={len(noticed)} "
          f"gaveup={len(gaveup)} benign_limpios={len(clean_ben)}/{len(ben)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
