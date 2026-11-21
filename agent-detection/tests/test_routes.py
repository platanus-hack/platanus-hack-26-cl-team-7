from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from engine.routes import RouteMatch, RouteTable

PATTERNS: list[dict[str, Any]] = [
    {"pattern": "/"},
    {"pattern": "/login", "methods": ["GET", "POST"]},
    {"pattern": "/products"},
    {"pattern": "/api/users/{id}"},
    {"pattern": "/api/users/{id}/orders/{order_id}"},
    {"pattern": "/static/**", "asset": True},
    {"pattern": "/docs/**"},
]

ROUTES_YAML = """\
routes:
  - pattern: "/api/users/{id}"
  - pattern: "/static/**"
    asset: true
  - pattern: "/login"
    methods: [GET, POST]
"""


@pytest.fixture
def table() -> RouteTable:
    return RouteTable.from_patterns(PATTERNS)


def _pattern(table: RouteTable, method: str, path: str) -> str | None:
    match = table.match(method, path)
    return None if match is None else match.pattern


def test_exact_route_matches(table: RouteTable) -> None:
    assert table.match("GET", "/products") == RouteMatch(pattern="/products", asset=False)


def test_root_route_matches_root_only(table: RouteTable) -> None:
    assert _pattern(table, "GET", "/") == "/"
    assert _pattern(table, "GET", "/nothing-here") is None


def test_exact_route_does_not_match_longer_path(table: RouteTable) -> None:
    assert table.match("GET", "/products/42") is None
    assert table.match("GET", "/productsx") is None


@pytest.mark.parametrize("path", ["/api/users/42", "/api/users/abc-DEF_9", "/api/users/me"])
def test_param_matches_one_segment(table: RouteTable, path: str) -> None:
    assert _pattern(table, "GET", path) == "/api/users/{id}"


@pytest.mark.parametrize(
    "path",
    ["/api/users", "/api/users/", "/api/users//", "/api/users/42/extra"],
)
def test_param_rejects_empty_or_extra_segments(table: RouteTable, path: str) -> None:
    assert table.match("GET", path) is None


def test_multiple_params(table: RouteTable) -> None:
    pattern = "/api/users/{id}/orders/{order_id}"
    assert _pattern(table, "GET", "/api/users/7/orders/99") == pattern
    assert table.match("GET", "/api/users/7/orders") is None
    assert table.match("GET", "/api/users/7/orders/99/x") is None


@pytest.mark.parametrize(
    "path",
    ["/static/app.js", "/static/css/site.css", "/static/img/a/b/c/logo.png"],
)
def test_double_star_matches_any_remainder(table: RouteTable, path: str) -> None:
    assert table.match("GET", path) == RouteMatch(pattern="/static/**", asset=True)


@pytest.mark.parametrize("path", ["/static", "/static/"])
def test_double_star_matches_zero_segments(table: RouteTable, path: str) -> None:
    assert _pattern(table, "GET", path) == "/static/**"


def test_double_star_requires_segment_boundary(table: RouteTable) -> None:
    assert table.match("GET", "/staticfoo") is None
    assert table.match("GET", "/staticfoo/app.js") is None


def test_asset_flag_defaults_false(table: RouteTable) -> None:
    match = table.match("GET", "/docs/guide/intro")
    assert match == RouteMatch(pattern="/docs/**", asset=False)


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_methods_filter_allows_listed(table: RouteTable, method: str) -> None:
    assert _pattern(table, method, "/login") == "/login"


@pytest.mark.parametrize("method", ["DELETE", "PUT", "HEAD", "OPTIONS"])
def test_methods_filter_rejects_unlisted(table: RouteTable, method: str) -> None:
    assert table.match(method, "/login") is None


@pytest.mark.parametrize("method", ["GET", "POST", "DELETE", "PATCH", "OPTIONS"])
def test_absent_methods_means_any(table: RouteTable, method: str) -> None:
    assert _pattern(table, method, "/products") == "/products"


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/products/", "/products"),
        ("/login/", "/login"),
        ("/api/users/42/", "/api/users/{id}"),
        ("/docs/", "/docs/**"),
    ],
)
def test_trailing_slash_is_ignored(table: RouteTable, path: str, expected: str) -> None:
    assert _pattern(table, "GET", path) == expected


@pytest.mark.parametrize("path", ["/Products", "/LOGIN", "/Static/app.js", "/API/users/1"])
def test_matching_is_case_sensitive(table: RouteTable, path: str) -> None:
    assert table.match("GET", path) is None


def test_no_percent_decoding_before_match(table: RouteTable) -> None:
    assert table.match("GET", "/%6Cogin") is None
    assert table.match("GET", "/products%2F") is None
    assert _pattern(table, "GET", "/api/users/a%2Fb") == "/api/users/{id}"


@pytest.mark.parametrize(
    "path",
    ["/.env", "/wp-admin/", "/admin", "/api", "/api/orders/1", "/robots.txt"],
)
def test_unlisted_paths_do_not_match(table: RouteTable, path: str) -> None:
    assert table.match("GET", path) is None


def test_empty_table_matches_nothing() -> None:
    empty = RouteTable.from_patterns([])
    assert empty.match("GET", "/") is None
    assert empty.match("GET", "/products") is None


def test_from_yaml(tmp_path: Path) -> None:
    path = tmp_path / "routes.yaml"
    path.write_text(ROUTES_YAML, encoding="utf-8")
    table = RouteTable.from_yaml(path)
    assert table.match("GET", "/api/users/5") == RouteMatch("/api/users/{id}", False)
    assert table.match("GET", "/static/a/b.js") == RouteMatch("/static/**", True)
    assert table.match("POST", "/login") == RouteMatch("/login", False)
    assert table.match("DELETE", "/login") is None
    assert table.match("GET", "/missing") is None


def test_from_yaml_accepts_str_path(tmp_path: Path) -> None:
    path = tmp_path / "routes.yaml"
    path.write_text(ROUTES_YAML, encoding="utf-8")
    table = RouteTable.from_yaml(str(path))
    assert _pattern(table, "GET", "/api/users/5") == "/api/users/{id}"


def test_route_match_is_frozen_value() -> None:
    assert RouteMatch("/x", False) == RouteMatch(pattern="/x", asset=False)
    assert hash(RouteMatch("/x", True)) == hash(RouteMatch("/x", True))


def test_repo_routes_yaml_covers_demo_shop(repo_root: Path) -> None:
    table = RouteTable.from_yaml(repo_root / "config" / "routes.yaml")
    assert table.match("GET", "/products/7") == RouteMatch("/products/{id}", False)
    assert table.match("DELETE", "/api/cart") == RouteMatch("/api/cart", False)
    assert table.match("PUT", "/api/cart") is None
    for path in ("/static/css/site.css", "/favicon.ico", "/robots.txt"):
        match = table.match("GET", path)
        assert match is not None
        assert match.asset
    assert table.match("GET", "/.env") is None
