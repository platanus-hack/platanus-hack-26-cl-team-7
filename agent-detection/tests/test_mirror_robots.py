"""mirror.robots: the shop's robots.txt with one marker per identity, over its Unix socket."""

from __future__ import annotations

import socket
import tempfile
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from email.message import Message
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from types import SimpleNamespace

import pytest
from test_mirror_swarm import build

from mirror.contracts import DeceptionEvent, TrackAction
from mirror.markers import Markers
from mirror.robots import BASE_TTL, FAIL_TTL, Robots, handler_for, identity_of
from mirror.sockets import UnixHTTPConnection, UnixHTTPServer
from mirror.swarm import ROBOTS_SOCKET, robots_listener

SHOP_ROBOTS = b"User-agent: *\nAllow: /\n"
TRACK = "trk_0123456789abcdef"
SCOUT = {"X-Client-Ip": "203.0.113.7", "User-Agent": "scout/1.0"}
ON_MIRROR = {"X-Lane": "mirror", "X-Track-Id": TRACK, "X-Request-Id": "req-7"}
WORKER = {"X-Client-Ip": "198.51.100.9", "User-Agent": "worker/1.0"}


@dataclass
class Shop:
    path: Path
    status: int = 200
    body: bytes = SHOP_ROBOTS
    seen: list[dict[str, str]] = field(default_factory=list)


def _serve(path: Path, handler: type[BaseHTTPRequestHandler]) -> UnixHTTPServer:
    server = UnixHTTPServer(path, handler)
    threading.Thread(target=server.serve_forever, args=(0.02,), daemon=True).start()
    return server


@pytest.fixture
def shop() -> Iterator[Shop]:
    # macOS caps AF_UNIX paths near 104 bytes; pytest's tmp_path can be longer.
    with tempfile.TemporaryDirectory(dir="/tmp") as name:
        state = Shop(Path(name) / "real.sock")

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self) -> None:
                state.seen.append(dict(self.headers.items()) | {"path": self.path})
                self.send_response(state.status)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(state.body)))
                self.end_headers()
                self.wfile.write(state.body)

            def log_message(self, format: str, *args: object) -> None:
                return None

        server = _serve(state.path, Handler)
        try:
            yield state
        finally:
            server.shutdown()
            server.server_close()


def robots_for(real: Path, markers: Markers | None, **more: object) -> Robots:
    return Robots(real, real.with_name("twin.sock"), markers, lambda _event: None, **more)


def message(headers: dict[str, str]) -> Message[str, str]:
    out: Message[str, str] = Message()
    for name, value in headers.items():
        out[name] = value
    return out


def get(path: Path, target: str, headers: dict[str, str]) -> tuple[int, dict[str, str], bytes]:
    conn = UnixHTTPConnection(path, timeout=5)
    try:
        conn.request("GET", target, headers=headers)
        answer = conn.getresponse()
        return answer.status, {k.lower(): v for k, v in answer.getheaders()}, answer.read()
    finally:
        conn.close()


def test_each_identity_reads_the_shops_file_plus_its_own_marker(shop: Shop) -> None:
    markers = Markers(b"secret")
    robots = robots_for(shop.path, markers)
    scout, worker = robots.page(message(SCOUT)), robots.page(message(WORKER))
    marker = markers.path_for("203.0.113.7|scout/1.0")
    assert (scout.status, scout.content_type) == (200, "text/plain")
    assert scout.body == SHOP_ROBOTS + b"Disallow: " + marker.encode() + b"\n"
    assert worker.body != scout.body and worker.body.startswith(SHOP_ROBOTS)
    assert robots.page(message(SCOUT)).body == scout.body, "the same file every time"


def test_the_shop_is_asked_once_per_ttl_and_never_sees_the_client(shop: Shop) -> None:
    now = [100.0]
    robots = robots_for(shop.path, Markers(b"secret"), clock=lambda: now[0])
    secret = SCOUT | {"Cookie": "session=abc", "Authorization": "Bearer abc"}
    for _ in range(3):
        robots.page(message(secret))
    assert [seen["path"] for seen in shop.seen] == ["/robots.txt"]
    assert not {"Cookie", "Authorization", "X-Client-Ip", "User-Agent"} & shop.seen[0].keys()
    now[0] += BASE_TTL
    shop.body = b"User-agent: *\nDisallow: /ftp\n"
    assert robots.page(message(SCOUT)).body.startswith(shop.body)
    assert len(shop.seen) == 2


def test_a_shop_without_the_file_gets_a_file_with_only_the_marker(shop: Shop) -> None:
    shop.status, shop.body = 404, b"<h1>Not found</h1>"
    markers = Markers(b"secret")
    page = robots_for(shop.path, markers).page(message(SCOUT))
    marker = markers.path_for("203.0.113.7|scout/1.0").encode()
    assert (page.status, page.body) == (200, b"User-agent: *\nDisallow: " + marker + b"\n")


def test_a_shop_that_is_down_still_gives_the_marker(tmp_path: Path) -> None:
    page = robots_for(tmp_path / "gone.sock", Markers(b"secret")).page(message(SCOUT))
    assert page.status == 200 and b"Disallow: /admin-backup-" in page.body


@pytest.mark.parametrize("status", [200, 404])
def test_without_markers_the_shops_answer_goes_out_as_it_is(shop: Shop, status: int) -> None:
    shop.status = status
    page = robots_for(shop.path, None).page(message(SCOUT))
    assert (page.status, page.body) == (status, SHOP_ROBOTS)


def test_without_markers_a_shop_that_is_down_is_a_bad_gateway(tmp_path: Path) -> None:
    assert robots_for(tmp_path / "gone.sock", None).page(message(SCOUT)).status == 502


def test_a_request_without_a_client_ip_gets_no_marker(shop: Shop) -> None:
    markers = Markers(b"secret")
    page = robots_for(shop.path, markers).page(message({"User-Agent": "scout/1.0"}))
    assert page.body == SHOP_ROBOTS and len(markers) == 0
    assert identity_of(message({"User-Agent": "x"})) is None
    assert identity_of(message({"X-Client-Ip": "203.0.113.7"})) == "203.0.113.7|"


def test_the_handler_answers_robots_only_and_forbids_caching(shop: Shop) -> None:
    sock = shop.path.with_name("robots.sock")
    server = _serve(sock, handler_for(robots_for(shop.path, Markers(b"secret"))))
    try:
        status, headers, body = get(sock, "/robots.txt?x=1", SCOUT)
        assert status == 200 and body.startswith(SHOP_ROBOTS) and b"/admin-backup-" in body
        assert headers["cache-control"] == "private, no-store"
        assert headers["content-length"] == str(len(body))
        assert get(sock, "/%72obots.txt", SCOUT)[2] == body, "Caddy matches the decoded path"
        assert get(sock, "/lane", SCOUT)[0] == 404
        assert get(sock, "/robots.txt.bak", SCOUT)[0] == 404
    finally:
        server.shutdown()
        server.server_close()


@pytest.mark.parametrize("swarm", [True, False])
def test_the_listener_marks_only_when_the_lane_links(
    shop: Shop, tmp_path: Path, swarm: bool
) -> None:
    lane = build(tmp_path, swarm=swarm).router
    sockets = {"lane": shop.path.with_name("lane.sock"), "real": shop.path, "twin": shop.path}
    reporter = SimpleNamespace(emit=lambda _event: None)
    router = SimpleNamespace(lane=lane, config=SimpleNamespace(**sockets), reporter=reporter)
    server = robots_listener(router)
    threading.Thread(target=server.serve_forever, args=(0.02,), daemon=True).start()
    try:
        _, _, body = get(shop.path.with_name(ROBOTS_SOCKET), "/robots.txt", SCOUT)
    finally:
        server.shutdown()
        server.server_close()
    assert (b"/admin-backup-" in body) is swarm
    if swarm:
        marker = body.split(b"Disallow: ")[-1].strip().decode()
        issued = lane.markers.issued(marker)
        assert issued is not None and issued.identity == "203.0.113.7|scout/1.0"


def test_a_shop_that_was_down_is_asked_again_soon_and_not_on_every_request(shop: Shop) -> None:
    now = [100.0]
    real = shop.path
    robots = robots_for(real, None, clock=lambda: now[0])
    shop.path = real.with_name("moved.sock")
    real.rename(shop.path)
    assert robots.page(message(SCOUT)).status == 502
    shop.path.rename(real)
    assert robots.page(message(SCOUT)).status == 502, "a failure is kept for FAIL_TTL"
    now[0] += FAIL_TTL
    assert robots.page(message(SCOUT)).status == 200
    assert len(shop.seen) == 1


def test_a_slow_twin_never_makes_a_real_lane_read_wait(shop: Shop) -> None:
    slow = shop.path.with_name("twin.sock")
    held = socket.socket(socket.AF_UNIX)
    held.bind(str(slow))
    held.listen(8)  # accepts connections and never answers
    robots = Robots(shop.path, slow, Markers(b"secret"), lambda _event: None)
    waiting = threading.Thread(target=robots.page, args=(message(SCOUT | ON_MIRROR),))
    waiting.start()
    try:
        started = time.monotonic()
        assert robots.page(message(SCOUT)).status == 200
        assert time.monotonic() - started < 1.0, "the real lane waited for the twin"
    finally:
        waiting.join()
        held.close()


def test_the_mirror_lane_reads_the_twins_file_and_never_the_real_one(shop: Shop) -> None:
    markers = Markers(b"secret")
    robots = Robots(shop.path.with_name("no-real.sock"), shop.path, markers, lambda _event: None)
    page = robots.page(message(SCOUT | ON_MIRROR))
    assert page.body.startswith(SHOP_ROBOTS) and len(shop.seen) == 1
    real = Robots(shop.path, shop.path.with_name("no-twin.sock"), markers, lambda _event: None)
    assert real.page(message(SCOUT)).body == page.body, "one identity, one file on both lanes"


def test_a_mirror_lane_read_is_reported_as_an_action_and_a_real_one_is_not(shop: Shop) -> None:
    events: list[DeceptionEvent] = []
    robots = Robots(shop.path, shop.path, Markers(b"secret"), events.append)
    sock = shop.path.with_name("robots.sock")
    server = _serve(sock, handler_for(robots))
    try:
        get(sock, "/robots.txt", SCOUT | {"X-Lane": "real", "X-Request-Id": "req-1"})
        _, _, body = get(sock, "/robots.txt?v=2", SCOUT | ON_MIRROR)
    finally:
        server.shutdown()
        server.server_close()
    [action] = events
    assert isinstance(action, TrackAction)
    assert (action.event_id, action.track_id) == ("track.action:req-7", TRACK)
    assert (action.method, action.path, action.query, action.status) == (
        "GET",
        "/robots.txt",
        "v=2",
        200,
    )
    assert action.response_body == body.decode() and action.request_body == ""


@pytest.mark.parametrize(
    "bad", [{"X-Track-Id": ""}, {"X-Track-Id": "not-a-track"}, {"X-Request-Id": "bad id!"}]
)
def test_a_mirror_read_without_usable_ids_is_answered_and_not_reported(
    shop: Shop, bad: dict[str, str]
) -> None:
    events: list[DeceptionEvent] = []
    robots = Robots(shop.path, shop.path, Markers(b"secret"), events.append)
    headers = message(SCOUT | ON_MIRROR | bad)
    page = robots.page(headers)
    robots.report(headers, "/robots.txt", page, 0.0)
    assert page.status == 200 and events == []
