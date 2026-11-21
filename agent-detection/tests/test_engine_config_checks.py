"""Broken config files fail loudly, and dot-segment paths count as exits."""

from __future__ import annotations

from pathlib import Path

import pytest

from engine.cli import main
from engine.config import Thresholds, load_thresholds
from engine.detector import Detector
from engine.models import Request
from engine.routes import RouteTable, has_dot_segment, load_route_entries

REPO = Path(__file__).resolve().parent.parent
ROUTES = REPO / "config" / "routes.yaml"
RULES = REPO / "config" / "rules.yaml"

BROKEN_ROUTES = {
    "misspelled key": "route:\n  - pattern: /\n",
    "empty file": "",
    "empty list": "routes: []\n",
    "not a list": "routes:\n  pattern: /\n",
    "entry without pattern": "routes:\n  - asset: true\n",
    "entry not a mapping": "routes:\n  - /\n",
    "pattern without slash": "routes:\n  - pattern: products\n",
    "methods as a string": "routes:\n  - pattern: /login\n    methods: GET\n",
    "top level is a list": "- pattern: /\n",
}


def _write(tmp_path: Path, name: str, text: str) -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


@pytest.mark.parametrize("case", sorted(BROKEN_ROUTES))
def test_broken_routes_file_is_rejected(tmp_path: Path, case: str) -> None:
    path = _write(tmp_path, "routes.yaml", BROKEN_ROUTES[case])
    with pytest.raises(ValueError, match="routes.yaml"):
        RouteTable.from_yaml(path)


def test_from_patterns_rejects_entry_without_pattern() -> None:
    with pytest.raises(ValueError, match="pattern"):
        RouteTable.from_patterns([{"asset": True}])


def test_repo_routes_load_as_checked_entries() -> None:
    entries = load_route_entries(ROUTES)
    assert entries
    assert all(str(entry["pattern"]).startswith("/") for entry in entries)


def test_cli_exits_2_on_broken_routes(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    log = _write(tmp_path, "access.log", "")
    routes = _write(tmp_path, "routes.yaml", BROKEN_ROUTES["misspelled key"])
    assert main(["replay", str(log), "--routes", str(routes), "--rules", str(RULES)]) == 2
    assert "routes" in capsys.readouterr().err


def test_cli_exits_2_on_unparsable_yaml(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    log = _write(tmp_path, "access.log", "")
    rules = _write(tmp_path, "rules.yaml", "r1_exits: [unclosed\n")
    assert main(["replay", str(log), "--routes", str(ROUTES), "--rules", str(rules)]) == 2
    assert "engine:" in capsys.readouterr().err


BROKEN_RULES = {
    "misspelled section": ("r1_exit:\n  min_exits: 8\n", "r1_exit"),
    "misspelled key": ("r1_exits:\n  min_exit: 8\n", "min_exit"),
    "key from another section": ("r3_flags:\n  window_seconds: 5\n", "window_seconds"),
    "section not a mapping": ("r2_breadth: 12\n", "r2_breadth"),
    "top level is a list": ("- r1_exits\n", "mapping"),
}


@pytest.mark.parametrize("case", sorted(BROKEN_RULES))
def test_broken_rules_file_is_rejected(tmp_path: Path, case: str) -> None:
    text, named = BROKEN_RULES[case]
    path = _write(tmp_path, "rules.yaml", text)
    with pytest.raises(ValueError, match=named):
        load_thresholds(path)


def test_absent_sections_and_keys_keep_defaults(tmp_path: Path) -> None:
    path = _write(tmp_path, "rules.yaml", "r1_exits:\n  min_exits: 8\nsession:\n")
    assert load_thresholds(path) == Thresholds(r1_min_exits=8)
    assert load_thresholds(_write(tmp_path, "empty.yaml", "")) == Thresholds()


@pytest.mark.parametrize(
    "path",
    [
        "/static/../admin",
        "/products/..",
        "/products/.",
        "/products/%2e%2e",
        "/products/%2E%2e",
        "/static/%2e%2e/graphql",
        "/products/..%2fadmin",
        "/static/..%5cadmin",
        "/./products",
        "/static/./app.js",
    ],
)
def test_dot_segment_paths_are_exits(path: str) -> None:
    assert has_dot_segment(path)
    assert RouteTable.from_yaml(ROUTES).match("GET", path) is None


@pytest.mark.parametrize("path", ["/static/app.min.js", "/static/a..b.css", "/products/...", "/"])
def test_dots_inside_a_name_are_not_dot_segments(path: str) -> None:
    assert not has_dot_segment(path)


def test_dot_segment_probe_session_gets_a_verdict() -> None:
    detector = Detector(RouteTable.from_yaml(ROUTES), Thresholds())
    names = ["admin", "debug", "graphql", "internal", "metrics", "console", "swagger"]
    rules: list[str] = []
    for n, name in enumerate(names):
        req = Request(1000.0 + n, "192.0.2.5", "agent/1.0", "GET", f"/static/../{name}", "", 404)
        rules.extend(v.rule for v in detector.process(req))
    assert rules == ["R1"]
