"""mirror.tap: the tap on its Unix socket, between a client that sends what Caddy sends and stub
twin and real shops. Checks which shop gets each request, what is recorded, which twin-born
values bind, the relay grants and the listener wiring."""

from __future__ import annotations

import contextlib
import json
import logging
import socket
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

import pytest

from engine.config import load_thresholds
from engine.detector import Detector
from engine.routes import RouteTable
from mirror.canaries import Canaries
from mirror.contracts import DeceptionEvent, FindingConfirmed, TrackAction, TrackLinked
from mirror.egress import Grant, Grants
from mirror.findings import FindingRules
from mirror.keys import KeyTable, twin_born_key
from mirror.lane import LaneRouter
from mirror.logins import Logins
from mirror.patches import PatchBook
from mirror.sockets import UnixHTTPConnection, UnixHTTPServer
from mirror.tap import Tap, handler_for
from tests.test_mirror_tap_proxy import serving
from tests.test_twin_support import socket_dir

REPO = Path(__file__).resolve().parent.parent
TRACK = "trk_0123456789abcdef"
IP, UA = "203.0.113.7", "python-httpx/0.27.0"
TWIN_SESSION = "twin-session-value-0001"
WAIT = 5.0
USER = {"username": "leo.espinoza68", "email": "leo.espinoza68@yahoo.com", "id": 1}


@dataclass
class Shops:
    grants: Grants
    seen: list[tuple[str, str, str, dict[str, str]]] = field(default_factory=list)
    taken: list[Grant | None] = field(default_factory=list)


def shop_handler(shops: Shops, name: str) -> type[BaseHTTPRequestHandler]:
    class Shop(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            shops.seen.append((name, self.command, self.path, dict(self.headers.items())))
            shops.taken.append(shops.grants.take("cb.example"))
            self.send_response(200)
            if self.path.startswith("/api/users/"):
                user = {"username": "bob"} if self.path.endswith("/2") else USER
                reply, kind = json.dumps(user).encode(), "application/json"
            else:
                reply, kind = f"{name}: {body.decode()}".encode(), "text/plain"
            self.send_header("Content-Type", kind)
            self.send_header("Set-Cookie", f"session={TWIN_SESSION}; HttpOnly; Path=/")
            self.send_header("Content-Length", str(len(reply)))
            self.end_headers()
            self.wfile.write(reply)

        do_POST = do_GET

        def log_message(self, format: str, *args: Any) -> None:
            return None

    return Shop


@dataclass
class Stack:
    tap: Tap
    path: Path
    shops: Shops
    keys: KeyTable
    events: list[DeceptionEvent]
    done: threading.Semaphore  # released when the tap has handled a request, records and all
    real: set[str]  # the values the real database holds, for the tap's check before it binds

    def send(
        self, method: str, target: str, body: bytes = b"", headers: dict[str, str] | None = None
    ) -> tuple[int, bytes]:
        sent = {"X-Client-Ip": IP, "User-Agent": UA, "X-Request-Id": "req-1"} | (headers or {})
        connection = UnixHTTPConnection(self.path)
        try:
            connection.request(method, target, body, {k: v for k, v in sent.items() if v})
            response = connection.getresponse()
            answer = response.status, response.read()
        finally:
            connection.close()
        assert self.done.acquire(timeout=WAIT), "the tap never finished the request"
        return answer

    def mirror(
        self, target: str, body: bytes = b"", headers: dict[str, str] | None = None
    ) -> tuple[int, bytes]:
        lane = {"X-Lane": "mirror", "X-Track-Id": TRACK} | (headers or {})
        return self.send("POST" if body else "GET", target, body, lane)

    def of(self, kind: type[DeceptionEvent]) -> list[Any]:
        return [event for event in self.events if isinstance(event, kind)]


def counted(tap: Tap, done: threading.Semaphore) -> type[BaseHTTPRequestHandler]:
    """The tap's handler, plus a signal once the tap is done with a request (it records after the
    answer is out, so a client can finish reading first)."""

    class Counted(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self) -> None:
            tap.serve(self)
            done.release()

        do_POST = do_GET

        def log_message(self, format: str, *args: Any) -> None:
            return None

    return Counted


@pytest.fixture
def stack(tmp_path: Path) -> Iterator[Stack]:
    with serving_stack(tmp_path, set()) as running:
        yield running


@contextlib.contextmanager
def serving_stack(tmp_path: Path, real: set[str]) -> Iterator[Stack]:
    routes = RouteTable.from_yaml(REPO / "config" / "routes.yaml")
    detector = Detector(routes, load_thresholds(REPO / "config" / "rules.yaml"))
    keys = KeyTable.load(tmp_path / "keys.jsonl")
    patches = PatchBook.load(tmp_path / "patches.jsonl", routes)
    events: list[DeceptionEvent] = []
    canaries = tmp_path / "canaries.json"
    canary = {"kind": "admin_email", "table": "users", "column": "email", "rowId": 1}
    canaries.write_text(json.dumps({"canaries": [canary | {"value": USER["email"]}]}))
    lane = LaneRouter(detector, keys, patches, events.append, print)
    rules = FindingRules(Canaries(canaries), routes, patches, events.append, lambda: 10)
    grants = Grants()
    shops = Shops(grants)
    done = threading.Semaphore(0)
    with socket_dir() as run:
        logins = Logins(lane)
        sock = run / "real.sock", run / "twin.sock"
        tap = Tap(lane, logins, grants, rules, events.append, *sock, lambda v: frozenset(v) & real)
        with (
            serving(UnixHTTPServer(tap.real, shop_handler(shops, "real"))),
            serving(UnixHTTPServer(tap.twin, shop_handler(shops, "twin"))),
            serving(UnixHTTPServer(run / "tap.sock", counted(tap, done))) as front,
        ):
            yield Stack(tap, front.socket_path, shops, keys, events, done, real)


def test_a_mirror_request_goes_to_the_twin_and_is_recorded(stack: Stack) -> None:
    status, body = stack.mirror("/account?x=1", b"avatar_url=http://cb.example/a.png")
    assert (status, body) == (200, b"twin: avatar_url=http://cb.example/a.png")
    [(shop, method, path, headers)] = stack.shops.seen
    assert (shop, method, path) == ("twin", "POST", "/account?x=1")
    assert "X-Lane" not in headers and "X-Track-Id" not in headers
    assert headers["X-Client-Ip"] == IP
    [action] = stack.of(TrackAction)
    assert (action.event_id, action.track_id, action.method) == (
        "track.action:req-1",
        TRACK,
        "POST",
    )
    assert (action.path, action.query, action.status) == ("/account", "x=1", 200)
    assert action.request_body == "avatar_url=http://cb.example/a.png"
    assert action.response_body == body.decode()


def test_the_relay_grant_lives_only_while_the_twin_answers(stack: Stack) -> None:
    stack.mirror("/account", b"avatar_url=http://CB.example/a.png")
    [grant] = stack.shops.taken
    assert grant is not None and (grant.track_id, grant.request_id) == (TRACK, "req-1")
    stack.mirror(
        "/account", b"avatar_url=http://cb.example/b.png", headers={"X-Request-Id": "req-2"}
    )
    stack.mirror("/account", b"nothing named", headers={"X-Request-Id": "req-3"})
    assert stack.shops.taken[2] is None
    assert len(stack.tap.grants) == 0


def test_the_twin_born_values_of_an_answer_bind_to_the_track(stack: Stack) -> None:
    stack.mirror("/api/users/1")
    linked = stack.of(TrackLinked)
    assert [event.event_id for event in linked] == [
        f"track.linked:req-1:twin_born-{n}" for n in range(3)
    ]
    for value in (TWIN_SESSION, USER["username"], USER["email"]):
        key = twin_born_key(str(value))
        assert key is not None and stack.keys.find([key]) == (TRACK, key)
    [finding] = stack.of(FindingConfirmed)
    assert finding.kind == "canary_read" and finding.endpoint == "GET /api/users/{id}"


def test_a_value_too_short_to_tell_a_twin_apart_is_not_bound(stack: Stack) -> None:
    stack.mirror("/api/users/2")
    assert [event.event_id for event in stack.of(TrackLinked)] == ["track.linked:req-1:twin_born-0"]


def test_real_lane_requests_reach_the_real_shop_unrecorded(stack: Stack) -> None:
    assert stack.send("GET", "/products", headers={"X-Lane": "real"}) == (200, b"real: ")
    assert stack.send("POST", "/login", b"username=maria&password=pw") == (
        200,
        b"real: username=maria&password=pw",
    )
    assert [shop for shop, *_ in stack.shops.seen] == ["real", "real"]
    assert stack.events == [] and len(stack.tap.grants) == 0


def test_a_real_lane_login_with_a_twin_born_username_goes_to_the_twin(stack: Stack) -> None:
    stack.mirror("/api/users/1")
    login = b"username=leo.espinoza68&password=guess"
    elsewhere = {"X-Lane": "real", "X-Client-Ip": "192.0.2.80", "X-Request-Id": "req-5"}
    assert stack.send("POST", "/login", login, elsewhere)[1].startswith(b"twin:")
    assert stack.events[-2].event_id == "track.linked:req-5:ip_ua"
    action = stack.events[-1]
    assert isinstance(action, TrackAction) and action.track_id == TRACK


def test_a_failure_while_picking_a_login_lane_keeps_it_real(
    stack: Stack, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def broken(*_args: object) -> str:
        raise RuntimeError("keys broke")

    monkeypatch.setattr(Logins, "track_of", broken)
    with caplog.at_level(logging.ERROR):
        assert stack.send("POST", "/login", b"username=a&password=b")[1].startswith(b"real:")
    assert "login lane for req-1 failed; real" in caplog.text and stack.events == []


def test_a_mirror_request_with_an_unusable_track_id_is_not_recorded(stack: Stack) -> None:
    assert stack.mirror("/products", headers={"X-Track-Id": "trk_forged"})[1] == b"twin: "
    assert stack.events == []


def test_an_unusable_request_id_gets_a_fresh_one(stack: Stack) -> None:
    stack.mirror("/products", headers={"X-Request-Id": "has spaces"})
    [action] = stack.of(TrackAction)
    assert len(action.event_id.removeprefix("track.action:")) == 32


def test_an_unreadable_body_gets_400_and_the_connection_closes(stack: Stack) -> None:
    front = stack.path.with_name("plain.sock")
    server = UnixHTTPServer(front, handler_for(stack.tap))
    with serving(server), socket.socket(socket.AF_UNIX) as raw:
        raw.connect(str(front))
        raw.sendall(b"POST /login HTTP/1.1\r\nHost: x\r\nContent-Length: ten\r\n\r\n")
        answer = raw.makefile("rb").read()
    assert answer.startswith(b"HTTP/1.1 400 ")
    assert stack.shops.seen == []


def test_a_twin_that_cannot_be_reached_gives_502_and_no_record(stack: Stack) -> None:
    gone = replace(stack.tap, twin=stack.path.with_name("missing.sock"))
    front_path = stack.path.with_name("gone.sock")
    with serving(UnixHTTPServer(front_path, counted(gone, stack.done))) as front:
        lost = replace(stack, path=front.socket_path)
        assert lost.mirror("/account", b"avatar_url=http://cb.example/") == (502, b"")
    assert stack.events == [] and len(stack.tap.grants) == 0


def test_a_recording_failure_is_logged_after_the_answer(
    stack: Stack, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def broken(_: object) -> list[FindingConfirmed]:
        raise RuntimeError("rules broke")

    monkeypatch.setattr(stack.tap.findings, "check", broken)
    with caplog.at_level(logging.ERROR):
        assert stack.mirror("/products")[0] == 200
    assert "recording req-1 failed" in caplog.text


def test_parallel_mirror_requests_each_get_one_record(stack: Stack) -> None:
    def hit(n: int) -> None:
        stack.mirror(f"/products/{n}", headers={"X-Request-Id": f"req-p{n}"})

    pool = [threading.Thread(target=hit, args=(n,)) for n in range(8)]
    for thread in pool:
        thread.start()
    for thread in pool:
        thread.join()
    ids = sorted(action.event_id for action in stack.of(TrackAction))
    assert ids == sorted(f"track.action:req-p{n}" for n in range(8))
