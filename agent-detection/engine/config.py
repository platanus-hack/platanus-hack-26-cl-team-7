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


KNOWN_KEYS: dict[str, frozenset[str]] = {
    "r1_exits": frozenset({"min_exits", "window_seconds"}),
    "r2_breadth": frozenset({"max_endpoints", "window_seconds"}),
    "r3_flags": frozenset({"enabled"}),
    "session": frozenset({"idle_timeout_seconds"}),
}


def load_thresholds(path: str | Path) -> Thresholds:
    """Thresholds from a config/rules.yaml file; absent keys keep their defaults.

    Raises ValueError on an unknown section or key, so a misspelled tuning edit cannot be
    silently ignored.
    """
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a mapping of rule sections")
    unknown = sorted(set(map(str, data)) - set(KNOWN_KEYS))
    if unknown:
        raise ValueError(f"{path}: unknown section(s) {unknown}; known: {sorted(KNOWN_KEYS)}")
    defaults = Thresholds()
    r1 = _section(data, "r1_exits", path)
    r2 = _section(data, "r2_breadth", path)
    r3 = _section(data, "r3_flags", path)
    session = _section(data, "session", path)
    return Thresholds(
        r1_min_exits=int(r1.get("min_exits", defaults.r1_min_exits)),
        r1_window=float(r1.get("window_seconds", defaults.r1_window)),
        r2_max_endpoints=int(r2.get("max_endpoints", defaults.r2_max_endpoints)),
        r2_window=float(r2.get("window_seconds", defaults.r2_window)),
        r3_enabled=bool(r3.get("enabled", defaults.r3_enabled)),
        idle_timeout=float(session.get("idle_timeout_seconds", defaults.idle_timeout)),
    )


def _section(data: dict[Any, Any], name: str, path: str | Path) -> dict[str, Any]:
    section = data.get(name)
    if section is None:
        return {}
    if not isinstance(section, dict):
        raise ValueError(f"{path}: section {name!r} must be a mapping")
    unknown = sorted(set(map(str, section)) - KNOWN_KEYS[name])
    if unknown:
        known = sorted(KNOWN_KEYS[name])
        raise ValueError(f"{path}: unknown key(s) {unknown} in {name!r}; known: {known}")
    return section
