from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest

from engine.config import Thresholds, load_thresholds

CUSTOM_RULES = """\
r1_exits:
  min_exits: 7
  window_seconds: 120
r2_breadth:
  max_endpoints: 25
  window_seconds: 30.5
r3_flags:
  enabled: false
session:
  idle_timeout_seconds: 600
"""


def test_thresholds_defaults_match_contract() -> None:
    t = Thresholds()
    assert t.r1_min_exits == 5
    assert t.r1_window == 300.0
    assert t.r2_max_endpoints == 10
    assert t.r2_window == 60.0
    assert t.r3_enabled is True
    assert t.idle_timeout == 1800.0


def test_thresholds_is_frozen() -> None:
    t = Thresholds()
    field_name = "r1_min_exits"
    with pytest.raises(dataclasses.FrozenInstanceError):
        setattr(t, field_name, 99)


def test_repo_rules_yaml_loads_to_defaults(rules_path: Path) -> None:
    assert load_thresholds(rules_path) == Thresholds()


def test_load_accepts_str_path(rules_path: Path) -> None:
    assert load_thresholds(str(rules_path)) == Thresholds()


def test_load_custom_values(tmp_path: Path) -> None:
    path = tmp_path / "rules.yaml"
    path.write_text(CUSTOM_RULES, encoding="utf-8")
    t = load_thresholds(path)
    assert t == Thresholds(
        r1_min_exits=7,
        r1_window=120.0,
        r2_max_endpoints=25,
        r2_window=30.5,
        r3_enabled=False,
        idle_timeout=600.0,
    )


def test_load_custom_value_types(tmp_path: Path) -> None:
    path = tmp_path / "rules.yaml"
    path.write_text(CUSTOM_RULES, encoding="utf-8")
    t = load_thresholds(path)
    assert isinstance(t.r1_min_exits, int)
    assert isinstance(t.r2_max_endpoints, int)
    assert isinstance(t.r3_enabled, bool)
    assert isinstance(t.r1_window, float)
    assert isinstance(t.r2_window, float)
    assert isinstance(t.idle_timeout, float)
