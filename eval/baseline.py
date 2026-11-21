"""Accuracy gate: precision and recall may not fall more than half a point below baseline.

A baseline also records where it came from (split, session count, sha256 of eval/testset.lock),
so check-baseline refuses a baseline taken on another split or another test set.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

TOLERANCE = 0.005
GATED = ("precision", "recall")
PROVENANCE = ("split", "sessions", "testset_lock_sha256")
_EPSILON = 1e-9


def check_baseline(
    current: Mapping[str, float | None],
    baseline: Mapping[str, float],
    tolerance: float = TOLERANCE,
) -> list[str]:
    problems: list[str] = []
    for key in GATED:
        expected = baseline.get(key)
        value = current.get(key)
        if expected is None:
            problems.append(f"{key}: baseline has no value")
        elif value is None:
            problems.append(f"{key}: no current value (baseline {expected:.4f})")
        elif expected - value > tolerance + _EPSILON:
            problems.append(
                f"{key}: {value:.4f} is more than {tolerance:.4f} below baseline {expected:.4f}"
            )
    return problems


def load_baseline(path: Path) -> dict[str, float]:
    data = read_baseline(path)
    return {key: float(value) for key, value in data.items() if isinstance(value, int | float)}


def current_values(report: Mapping[str, Any]) -> dict[str, float | None]:
    return {key: report[key]["value"] for key in GATED if key in report}


def lock_digest(lock_path: Path) -> str | None:
    return hashlib.sha256(lock_path.read_bytes()).hexdigest() if lock_path.is_file() else None


def baseline_record(report: Mapping[str, Any], lock_path: Path) -> dict[str, Any]:
    values = current_values(report)
    empty = [key for key in GATED if values.get(key) is None]
    if empty:
        raise ValueError(f"cannot record a baseline: no value for {', '.join(empty)}")
    digest = lock_digest(lock_path)
    if digest is None:
        raise ValueError(f"cannot record a baseline: lock file missing: {lock_path}")
    return {
        **values,
        "split": report["split"],
        "sessions": report["sessions"],
        "testset_lock_sha256": digest,
        "thresholds": report["thresholds"],
    }


def check_provenance(
    baseline: Mapping[str, Any], report: Mapping[str, Any], lock_path: Path
) -> list[str]:
    missing = [key for key in PROVENANCE if key not in baseline]
    if missing:
        return [f"baseline has no {', '.join(missing)}; record it with `python -m eval baseline`"]
    problems: list[str] = []
    if baseline["split"] != report["split"]:
        problems.append(
            f"baseline was taken on split {baseline['split']!r}, "
            f"this run scores split {report['split']!r}"
        )
    if baseline["testset_lock_sha256"] != lock_digest(lock_path):
        problems.append(f"baseline was taken on another test set ({lock_path} digest differs)")
    return problems


def read_baseline(path: Path) -> dict[str, Any]:
    data: Any = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: baseline must be a JSON object")
    return data
