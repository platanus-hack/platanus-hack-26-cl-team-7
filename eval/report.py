"""Labeled replay of one split: verdicts, scores per split and per source, printable table."""

from __future__ import annotations

import dataclasses
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from engine.config import load_thresholds
from engine.detector import Detector, replay
from engine.models import Verdict
from engine.routes import RouteTable
from eval.dataset import DatasetError, Split, load_dataset
from eval.metrics import score

METRICS = (
    ("precision", "precision", True),
    ("recall", "recall", True),
    ("human_false_alarm_rate", "human false-alarm rate", True),
    ("critical_flag_precision", "critical-flag precision", True),
    ("median_requests_before_verdict", "median requests before verdict", False),
    ("probing_ai_recall", "probing_ai recall", True),
)


def evaluate(
    data_dir: Path, split_name: str, routes_path: Path, rules_path: Path
) -> dict[str, Any]:
    split = load_dataset(data_dir)[split_name]
    if not split.labels:
        raise DatasetError(
            f"split {split_name!r} has no labeled sessions in {data_dir / split_name}; "
            "record <name>.jsonl + <name>.labels.json pairs there first"
        )
    thresholds = load_thresholds(rules_path)
    verdicts = replay(split.requests, Detector(RouteTable.from_yaml(routes_path), thresholds))
    return {
        "split": split_name,
        "data_dir": str(data_dir),
        "routes": str(routes_path),
        "thresholds": dataclasses.asdict(thresholds),
        "sessions": len(split.labels),
        "requests": len(split.requests),
        **score(split.labels, verdicts),
        "verdicts_by_rule": dict(sorted(Counter(v.rule for v in verdicts).items())),
        "per_source": per_source(split, verdicts),
    }


def per_source(split: Split, verdicts: Sequence[Verdict]) -> dict[str, Any]:
    names = sorted(set(split.sources.values()))
    result: dict[str, Any] = {}
    for name in names:
        labels = {sid: lab for sid, lab in split.labels.items() if split.sources.get(sid) == name}
        result[name] = {
            "synthetic": split.synthetic.get(name, False),
            "sessions": len(labels),
            "labels": dict(sorted(Counter(labels.values()).items())),
            **score(labels, verdicts),
        }
    return result


def format_report(report: dict[str, Any]) -> str:
    lines = [
        f"split: {report['split']}  sessions: {report['sessions']}  requests: {report['requests']}",
        *_confusion_table(report["confusion"]),
        "",
        *(_metric_line(label, report[key], rate) for key, label, rate in METRICS),
    ]
    for name, entry in report["per_source"].items():
        tag = " (synthetic)" if entry["synthetic"] else ""
        lines.extend(["", f"source {name}{tag}: {entry['sessions']} sessions {entry['labels']}"])
        lines.extend(f"  {_metric_line(label, entry[key], rate)}" for key, label, rate in METRICS)
    return "\n".join(lines)


def _confusion_table(confusion: dict[str, int]) -> list[str]:
    return [
        f"{'':18}{'flagged':>10}{'not flagged':>14}",
        f"{'probing (all)':18}{confusion['tp']:>10}{confusion['fn']:>14}",
        f"{'human':18}{confusion['fp']:>10}{confusion['tn']:>14}",
    ]


def _metric_line(label: str, entry: dict[str, Any], rate: bool) -> str:
    value = entry["value"]
    if value is None:
        shown = "n/a"
    elif rate:
        shown = f"{value * 100:.2f}%"
    else:
        shown = f"{value:g}"
    return f"{label:34}{shown:>10}  ({entry['sessions']} sessions)"
