"""Static checks on deploy/: what the proxy log keeps and which host interfaces get a port."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

import pytest
import yaml

REPO = Path(__file__).resolve().parents[1]
CADDYFILES = [REPO / "deploy" / "Caddyfile", REPO / "deploy" / "Caddyfile.local"]
SECRET_QUERY_KEYS = ("current", "new", "repeat")
QUERY_FILTER = re.compile(r"request>uri query \{(?P<body>[^}]*)\}")


@pytest.mark.parametrize("caddyfile", CADDYFILES, ids=lambda p: p.name)
def test_log_filter_redacts_the_password_change_query(caddyfile: Path) -> None:
    text = caddyfile.read_text(encoding="utf-8")
    found = QUERY_FILTER.search(text)
    assert found, f"{caddyfile.name}: no request>uri query filter"
    lines = {line.strip() for line in found["body"].splitlines() if line.strip()}
    assert lines == {f"replace {key} REDACTED" for key in SECRET_QUERY_KEYS}


@pytest.mark.parametrize("caddyfile", CADDYFILES, ids=lambda p: p.name)
def test_header_limit_is_pinned_for_the_dashboard_body_limit(caddyfile: Path) -> None:
    assert re.search(r"^\s*max_header_size 16KiB$", caddyfile.read_text(), re.MULTILINE)


def test_dashboard_port_is_published_on_loopback_only() -> None:
    compose = yaml.safe_load((REPO / "deploy" / "docker-compose.yml").read_text())
    ports = [str(port) for port in compose["services"]["dashboard"].get("ports", [])]
    assert ports, "dashboard publishes no port"
    assert all(port.startswith("127.0.0.1:") for port in ports), ports
    engine_args = compose["services"]["engine"]["command"]
    assert "http://dashboard:8090/webhook" in engine_args


def _password_change_queries() -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for log in sorted((REPO / "eval" / "data").rglob("*.jsonl")):
        for line in log.read_text(encoding="utf-8", errors="replace").splitlines():
            if "change-password" not in line:
                continue
            uri = urlsplit(json.loads(line).get("request", {}).get("uri", ""))
            if uri.path.rstrip("/").endswith("/change-password"):
                pairs.extend(parse_qsl(uri.query, keep_blank_values=True))
    return pairs


def test_captured_eval_data_holds_no_password_change_values() -> None:
    pairs = _password_change_queries()
    leaked = [(k, v) for k, v in pairs if k in SECRET_QUERY_KEYS and v != "REDACTED"]
    assert leaked == []
