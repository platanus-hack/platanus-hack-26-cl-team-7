"""Session-level scoring of engine verdicts against labels."""

from __future__ import annotations

import statistics
from collections.abc import Collection, Iterable, Mapping
from typing import Any

from engine.models import Label, Verdict

POSITIVE: frozenset[Label] = frozenset({"probing", "probing_ai"})


def score(labels: Mapping[str, Label], verdicts: Iterable[Verdict]) -> dict[str, Any]:
    # A session's first verdict is its earliest by log time. After an idle timeout the engine
    # restarts request_count for the same "ip|ua", so a later verdict can carry a smaller count.
    first: dict[str, Verdict] = {}
    critical: set[str] = set()
    for item in verdicts:
        if item.session_id not in labels:
            continue
        known = first.get(item.session_id)
        if known is None or item.ts < known.ts:
            first[item.session_id] = item
        if item.critical:
            critical.add(item.session_id)
    first_count = {sid: item.request_count for sid, item in first.items()}
    return _report(labels, first_count, critical)


def _report(
    labels: Mapping[str, Label], first_count: Mapping[str, int], critical: Collection[str]
) -> dict[str, Any]:
    positives = {sid for sid, label in labels.items() if label in POSITIVE}
    humans = {sid for sid, label in labels.items() if label == "human"}
    ai = {sid for sid, label in labels.items() if label == "probing_ai"}
    flagged = set(first_count)
    tp, fp = len(flagged & positives), len(flagged & humans)
    detected = [first_count[sid] for sid in flagged & positives]
    return {
        "confusion": {
            "tp": tp,
            "fp": fp,
            "fn": len(positives) - tp,
            "tn": len(humans) - fp,
        },
        "precision": _ratio(tp, tp + fp),
        "recall": _ratio(tp, len(positives)),
        "human_false_alarm_rate": _ratio(fp, len(humans)),
        "critical_flag_precision": _ratio(len(positives.intersection(critical)), len(critical)),
        "median_requests_before_verdict": _median(detected),
        "probing_ai_recall": _ratio(len(flagged & ai), len(ai)),
    }


def _ratio(numerator: int, denominator: int) -> dict[str, Any]:
    value = numerator / denominator if denominator else None
    return {"value": value, "sessions": denominator}


def _median(counts: list[int]) -> dict[str, Any]:
    value = float(statistics.median(counts)) if counts else None
    return {"value": value, "sessions": len(counts)}
