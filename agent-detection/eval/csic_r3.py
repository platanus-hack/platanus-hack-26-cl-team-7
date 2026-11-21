"""R3 against outside ground truth: CSIC 2010 normal requests (false flags) and attacks (hits).

`python -m eval csic-r3 DIR` reads the raw CSIC dumps in DIR and runs the engine's R3 matcher
(engine.rules.r3_flags.flag) over every request. "url" is what R3 sees in a Caddy log: path plus
query. "url_and_body" also hands the form body of POST/PUT requests to R3 as if it were a query,
which shows what a log with bodies would add.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from engine.rules.r3_flags import flag
from eval.convert.csic import CsicRequest, read_dump

NORMAL_FILES = ("normalTrafficTraining.txt", "normalTrafficTest.txt")
ANOMALOUS_FILE = "anomalousTrafficTest.txt"
EXAMPLES = 5


def r3_report(directory: Path) -> dict[str, Any]:
    normal = [req for name in NORMAL_FILES for req in _dump(directory, name)]
    anomalous = _dump(directory, ANOMALOUS_FILE)
    return {
        "source": "CSIC 2010 HTTP dataset",
        "normal": _score(normal, "false_flags"),
        "anomalous": _score(anomalous, "hits"),
    }


def _dump(directory: Path, name: str) -> list[CsicRequest]:
    path = directory / name
    if not path.is_file():
        raise FileNotFoundError(f"{path} not found")
    return read_dump(path)


def _score(requests: list[CsicRequest], key: str) -> dict[str, Any]:
    total = len(requests)
    result: dict[str, Any] = {"requests": total, "with_query": sum(1 for r in requests if r.query)}
    for mode in ("url", "url_and_body"):
        flagged: Counter[str] = Counter()
        examples: list[str] = []
        for req in requests:
            signature = _flag(req, with_body=mode == "url_and_body")
            if signature is None:
                continue
            flagged[signature] += 1
            if len(examples) < EXAMPLES:
                examples.append(f"{signature}: {req.method} {req.target[:160]}")
        count = sum(flagged.values())
        result[mode] = {
            key: count,
            "rate": round(count / total, 4) if total else 0.0,
            "by_signature": dict(flagged.most_common()),
            "examples": examples,
        }
    return result


def _flag(req: CsicRequest, *, with_body: bool) -> str | None:
    query = req.query
    if with_body and req.body:
        query = f"{query}&{req.body}" if query else req.body
    return flag(req.path, query)


def format_r3(report: dict[str, Any]) -> str:
    lines = [f"R3 critical flag on {report['source']}"]
    for group, key in (("normal", "false_flags"), ("anomalous", "hits")):
        part = report[group]
        for mode in ("url", "url_and_body"):
            entry = part[mode]
            lines.append(
                f"  {group:<9} {mode:<12} {entry[key]:>6} / {part['requests']:<6} {key}"
                f" ({entry['rate']:.2%})"
            )
    return "\n".join(lines)
