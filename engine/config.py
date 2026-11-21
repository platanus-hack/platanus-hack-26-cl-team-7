"""Rule thresholds, loaded from config/rules.yaml."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True, slots=True)
class Thresholds:
    r1_min_exits: int = 5
    r1_window: float = 300.0
    r2_max_endpoints: int = 10
    r2_window: float = 60.0
    r3_enabled: bool = True
    idle_timeout: float = 1800.0


def load_thresholds(path: str | Path) -> Thresholds:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    defaults = Thresholds()
    r1 = _section(data, "r1_exits")
    r2 = _section(data, "r2_breadth")
    r3 = _section(data, "r3_flags")
    session = _section(data, "session")
    return Thresholds(
        r1_min_exits=int(r1.get("min_exits", defaults.r1_min_exits)),
        r1_window=float(r1.get("window_seconds", defaults.r1_window)),
        r2_max_endpoints=int(r2.get("max_endpoints", defaults.r2_max_endpoints)),
        r2_window=float(r2.get("window_seconds", defaults.r2_window)),
        r3_enabled=bool(r3.get("enabled", defaults.r3_enabled)),
        idle_timeout=float(session.get("idle_timeout_seconds", defaults.idle_timeout)),
    )


def _section(data: Any, name: str) -> dict[str, Any]:
    section = data.get(name) if isinstance(data, dict) else None
    return section if isinstance(section, dict) else {}
