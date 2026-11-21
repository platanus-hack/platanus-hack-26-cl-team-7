"""mirror.findings: a virtual patch is made only from what the lane endpoint can match, the URI."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from engine.routes import RouteTable
from mirror.canaries import Canaries
from mirror.contracts import DeceptionEvent, FindingConfirmed
from mirror.findings import BLOCKED, FindingRules
from mirror.patches import PatchBook
from tests.test_mirror_findings import FORM, NOT_FOUND, REPO, Rules, write_canaries

JSON = "application/json"
CART = {"productId": "1' OR '1'='1", "qty": 1}
SQLI_FORM = b"username=%27+OR+1%3D1+--&password=x"


@pytest.fixture
def rules(tmp_path: Path) -> Rules:
    routes = RouteTable.from_yaml(REPO / "config" / "routes.yaml")
    write_canaries(tmp_path / "canaries.json", "someone@example.org")
    patches = PatchBook.load(tmp_path / "patches.jsonl", routes)
    events: list[DeceptionEvent] = []
    found = FindingRules(
        Canaries(tmp_path / "canaries.json"), routes, patches, events.append, lambda: NOT_FOUND
    )
    return Rules(found, patches, tmp_path / "canaries.json", events)


def test_a_body_signature_on_an_ordinary_route_is_reported_without_a_patch(rules: Rules) -> None:
    cart = {"method": "POST", "path": "/api/cart", "content_type": JSON}
    body = json.dumps(CART).encode()
    assert rules.check(**cart, request_body=body, body=b'{"items": [1, 2, 3]}') == [
        "signature_success"
    ]
    [finding] = rules.events
    assert isinstance(finding, FindingConfirmed)
    assert "signature 'sql tautology'" in finding.evidence
    assert BLOCKED not in finding.evidence  # a repeat from a new client reaches the real shop
    assert len(rules.patches) == 0
    assert rules.patches.match("POST", "/api/cart", "") is None


@pytest.mark.parametrize(("path", "kind"), [("/login", FORM), ("/api/session", JSON)])
def test_a_login_body_signature_starts_no_patch_because_logins_reads_every_body(
    rules: Rules, path: str, kind: str
) -> None:
    body = SQLI_FORM if kind == FORM else json.dumps({"username": "' OR 1=1 --"}).encode()
    login = {"method": "POST", "path": path, "content_type": kind, "request_body": body}
    assert rules.check(**login, status=401) == []
    assert rules.check(**login, status=302, request_id="req-2") == ["auth_flip"]
    assert len(rules.patches) == 0
    finding = rules.events[-1]
    assert isinstance(finding, FindingConfirmed)
    assert BLOCKED in finding.evidence  # mirror.logins reads every login body


def test_a_uri_signature_on_a_post_route_still_starts_a_patch(rules: Rules) -> None:
    query = "next=%27+OR+1%3D1+--"
    flip: dict[str, Any] = {"method": "POST", "path": "/api/session", "query": query}
    flip["request_body"] = SQLI_FORM
    assert rules.check(**flip, status=401) == []
    assert rules.check(**flip, status=302, request_id="req-2") == ["auth_flip"]
    assert len(rules.patches) == 1
    assert rules.patches.match("POST", "/api/session", query) is not None
    assert rules.patches.match("POST", "/api/session", "") is None
