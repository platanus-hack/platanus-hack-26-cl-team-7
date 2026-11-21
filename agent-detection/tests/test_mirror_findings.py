"""mirror.findings and mirror.canaries: the three finding rules, their virtual patches, the canary
file and the twin's 404 size."""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

import pytest

from engine.routes import RouteTable
from mirror import findings
from mirror.canaries import Canaries
from mirror.contracts import DeceptionEvent, FindingConfirmed
from mirror.exchange import Exchange
from mirror.findings import FindingRules, NotFoundSize
from mirror.patches import PatchBook
from mirror.sockets import UnixHTTPServer
from tests.test_mirror_tap_proxy import serving
from tests.test_twin_support import socket_dir

REPO = Path(__file__).resolve().parent.parent
TRACK, OTHER = "trk_0123456789abcdef", "trk_fedcba9876543210"
ADMIN_EMAIL = "leo.espinoza68@yahoo.com"
ADDRESS = "Avenida Vicuña Mackenna 3336, Talca"
FORM = "application/x-www-form-urlencoded"
SQLI = b"username=%27+OR+1%3D1+--&password=x"
NOT_FOUND = 10


def write_canaries(path: Path, *values: object) -> None:
    items = [
        {"kind": f"kind_{n}", "table": "users", "column": "email", "rowId": n + 1, "value": v}
        for n, v in enumerate(values)
    ]
    path.write_text(json.dumps({"version": 1, "canaries": items}), encoding="utf-8")


@dataclass
class Rules:
    rules: FindingRules
    patches: PatchBook
    canaries: Path
    events: list[DeceptionEvent] = field(default_factory=list)
    not_found: list[int | None] = field(default_factory=lambda: [NOT_FOUND])

    def check(self, **fields: Any) -> list[str]:
        return [finding.kind for finding in self.rules.check(exchange(**fields))]


@pytest.fixture
def make(tmp_path: Path) -> Callable[[], Rules]:
    routes = RouteTable.from_yaml(REPO / "config" / "routes.yaml")

    def build() -> Rules:
        canaries = tmp_path / "canaries.json"
        write_canaries(canaries, ADMIN_EMAIL, ADDRESS, "O'Brien & Sons", 7)
        patches = PatchBook.load(tmp_path / "patches.jsonl", routes)
        events: list[DeceptionEvent] = []
        not_found: list[int | None] = [NOT_FOUND]
        found = FindingRules(
            Canaries(canaries), routes, patches, events.append, lambda: not_found[0]
        )
        return Rules(found, patches, canaries, events, not_found)

    return build


def exchange(**fields: Any) -> Exchange:
    body = fields.pop("body", b"<p>ok</p>")
    base = Exchange(
        track_id=TRACK,
        request_id="req-1",
        method="GET",
        path="/api/users/1",
        query="",
        content_type="",
        request_body=b"",
        credentials="\n",
        status=200,
        response_type="text/html",
        response_body=body,
        response_size=len(body),
    )
    return replace(base, **fields)


def test_a_canary_in_the_answer_is_a_finding_without_a_patch(make: Callable[[], Rules]) -> None:
    rules = make()
    assert rules.check(body=json.dumps({"email": ADMIN_EMAIL}).encode()) == ["canary_read"]
    [finding] = rules.events
    assert isinstance(finding, FindingConfirmed)
    assert (finding.event_id, finding.track_id) == ("finding.confirmed:req-1:canary_read", TRACK)
    assert finding.endpoint == "GET /api/users/{id}"
    assert "holds canary kind_0 (users.email row 1)" in finding.evidence
    assert finding.evidence.endswith("Request: GET /api/users/1")
    assert ADMIN_EMAIL not in finding.evidence
    assert len(rules.patches) == 0


@pytest.mark.parametrize(
    "body",
    [
        json.dumps({"address": ADDRESS}).encode(),  # the shop's JSON escapes non-ASCII
        ADDRESS.encode(),
        b"<dd>O&#x27;Brien &amp; Sons</dd>",
    ],
)
def test_a_canary_is_found_raw_json_escaped_or_html_escaped(
    make: Callable[[], Rules], body: bytes
) -> None:
    assert make().check(body=body) == ["canary_read"]


def test_a_canary_read_with_a_signature_patches_that_signature(make: Callable[[], Rules]) -> None:
    rules = make()
    traversal = {"path": "/account", "query": "invoice=../../../users.csv"}
    assert rules.check(body=ADMIN_EMAIL.encode(), status=404, **traversal) == ["canary_read"]
    assert rules.patches.match("GET", "/account", "invoice=../../x/y") is not None
    assert rules.patches.match("GET", "/account", "invoice=7.txt") is None


def test_an_auth_flip_needs_a_401_then_success_with_a_signature(make: Callable[[], Rules]) -> None:
    rules = make()
    login = {"method": "POST", "path": "/login", "content_type": FORM}
    assert rules.check(**login, request_body=b"username=a&password=b", status=401) == []
    assert (
        rules.check(**login, request_body=b"username=a&password=c", status=303, request_id="r2")
        == []
    )
    assert rules.check(**login, request_body=SQLI, status=303, request_id="req-3") == ["auth_flip"]
    finding = rules.events[-1]
    assert isinstance(finding, FindingConfirmed)
    assert finding.endpoint == "POST /login"
    assert "answered this track 401 (request req-1), now 303" in finding.evidence
    assert "signature 'sql tautology'" in finding.evidence
    assert finding.evidence.endswith("body username=%27+OR+1%3D1+--&password=x")
    assert rules.patches.match("POST", "/login", SQLI.decode()) is not None
    assert rules.patches.match("POST", "/login", "username=bob&password=pw") is None


def test_a_401_counts_only_for_its_track_and_endpoint(make: Callable[[], Rules]) -> None:
    rules = make()
    rules.check(method="POST", path="/api/session", status=401)
    rules.check(method="POST", path="/login", status=401, track_id=OTHER)
    flip = {"method": "POST", "path": "/login", "content_type": FORM, "request_body": SQLI}
    assert rules.check(**flip, status=303) == []
    assert rules.check(**flip, status=302, track_id=OTHER) == ["auth_flip"]


def test_one_request_can_flip_and_succeed_but_patches_once(make: Callable[[], Rules]) -> None:
    rules = make()
    rules.check(method="POST", path="/api/session", status=401)
    body = json.dumps({"username": "' OR 1=1 --", "password": "x"}).encode()
    sqli = {"method": "POST", "path": "/api/session", "content_type": "application/json"}
    assert rules.check(**sqli, request_body=body, body=b'{"token": "t"}' * 3) == [
        "auth_flip",
        "signature_success",
    ]
    assert [event.event_id for event in rules.events] == [
        "finding.confirmed:req-1:auth_flip",
        "finding.confirmed:req-1:signature_success",
    ]
    assert len(rules.patches) == 1


def test_signature_success_needs_2xx_and_a_body_larger_than_the_404_page(
    make: Callable[[], Rules],
) -> None:
    rules = make()
    traversal = {"path": "/account", "query": "invoice=../../etc/passwd"}
    assert rules.check(**traversal, body=b"Not found\n", request_id="r1") == []
    assert rules.check(**traversal, body=b"x" * 50, status=404, request_id="r2") == []
    assert rules.check(**traversal, body=b"root:x:0:0:root:/root:/bin/bash\n") == [
        "signature_success"
    ]
    finding = rules.events[-1]
    assert isinstance(finding, FindingConfirmed)
    assert "signature 'path traversal' got 200, 32 bytes; the 404 page has 10" in finding.evidence
    assert rules.patches.match("GET", "/account", "invoice=../../etc/shadow") is not None


def test_signature_success_waits_while_the_404_size_is_unknown(make: Callable[[], Rules]) -> None:
    rules = make()
    rules.not_found[0] = None
    assert rules.check(path="/search", query="q=<script>alert(1)</script>", body=b"x" * 500) == []


def test_each_finding_is_reported_once_per_track(make: Callable[[], Rules]) -> None:
    rules = make()
    canary = {"body": ADMIN_EMAIL.encode()}
    assert rules.check(**canary) == ["canary_read"]
    assert rules.check(**canary, request_id="req-2") == []
    assert rules.check(**canary, request_id="req-3", track_id=OTHER) == ["canary_read"]


def test_memory_is_bounded(make: Callable[[], Rules], monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("MAX_SEEN", "MAX_TRACKS", "MAX_REFUSED"):
        monkeypatch.setattr(findings, name, 1)
    rules = make()
    rules.check(body=ADMIN_EMAIL.encode())
    rules.check(body=ADMIN_EMAIL.encode(), track_id=OTHER)
    assert rules.check(body=ADMIN_EMAIL.encode(), request_id="again") == ["canary_read"]
    rules.check(method="POST", path="/login", status=401)
    rules.check(method="POST", path="/api/session", status=401)
    rules.check(method="POST", path="/login", status=401, track_id=OTHER)
    flip = {"method": "POST", "path": "/api/session", "content_type": FORM, "request_body": SQLI}
    assert rules.check(**flip, status=302) == []  # the track's 401s were forgotten


def test_an_endpoint_too_long_for_a_patch_still_reports(
    make: Callable[[], Rules], caplog: pytest.LogCaptureFixture
) -> None:
    rules = make()
    long_path = "/x" * 1100
    with caplog.at_level(logging.WARNING):
        assert rules.check(path=long_path, query="f=../../etc/passwd", body=b"y" * 20) == [
            "signature_success"
        ]
    assert len(rules.patches) == 0 and "no virtual patch" in caplog.text


def test_concurrent_checks_report_a_finding_once(make: Callable[[], Rules]) -> None:
    rules = make()
    barrier = threading.Barrier(8)
    found: list[list[str]] = []

    def check(n: int) -> None:
        barrier.wait()
        found.append(rules.check(body=ADMIN_EMAIL.encode(), request_id=f"req-{n}"))

    pool = [threading.Thread(target=check, args=(n,)) for n in range(8)]
    for thread in pool:
        thread.start()
    for thread in pool:
        thread.join()
    assert sorted(found) == [[]] * 7 + [["canary_read"]]


def test_the_canary_file_is_read_again_when_it_changes(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    path = tmp_path / "canaries.json"
    canaries = Canaries(path)
    assert canaries.find(ADMIN_EMAIL.encode()) is None  # no file yet
    write_canaries(path, "first.value@mail.example")
    assert canaries.find(b"<p>first.value@mail.example</p>") is not None
    write_canaries(path, "second.value@mail.example", "")
    assert canaries.find(b"first.value@mail.example") is None
    assert canaries.find(b"second.value@mail.example") is not None
    with caplog.at_level(logging.WARNING):
        path.write_text("{not json", encoding="utf-8")
        assert canaries.find(b"second.value@mail.example") is None
    assert "no canaries" in caplog.text


def twin_404(status: int) -> type[BaseHTTPRequestHandler]:
    class Twin(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(status)
            self.send_header("Content-Length", "10")
            self.end_headers()
            self.wfile.write(b"Not found\n")

        def log_message(self, format: str, *args: Any) -> None:
            return None

    return Twin


def test_the_404_size_is_asked_of_the_twin_once_it_answers(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with socket_dir() as run:
        probe = NotFoundSize(run / "twin.sock")
        with caplog.at_level(logging.WARNING):
            assert probe() is None
        assert "404 probe of the twin failed" in caplog.text
        with serving(UnixHTTPServer(run / "twin.sock", twin_404(200))):
            assert probe() is None  # not a 404: no baseline
        with serving(UnixHTTPServer(run / "twin.sock", twin_404(404))):
            assert probe() == 10
        assert probe() == 10  # kept after the twin is gone
