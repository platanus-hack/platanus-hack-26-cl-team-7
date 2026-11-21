"""Accuracy gate: precision and recall may not fall more than half a point below baseline."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

TOLERANCE = 0.005
GATED = ("precision", "recall")
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
    data: Any = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: baseline must be a JSON object")
    return {key: float(value) for key, value in data.items() if isinstance(value, int | float)}


def current_values(report: Mapping[str, Any]) -> dict[str, float | None]:
    return {key: report[key]["value"] for key in GATED if key in report}
