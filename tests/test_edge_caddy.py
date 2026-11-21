"""deploy/Caddyfile.local run by a real Caddy against stub Unix-socket services.

The stubs stand in for the real shop (run/real.sock), the router's lane endpoint (run/lane.sock)
and its tap (run/tap.sock). The lane stub puts any User-Agent with "agent" in it on the mirror
lane. Every stub answers the same body, and each sends its own Server, Via and X-Powered-By
values, so a response header that survives the edge would tell the lanes apart. Caddy must be on
PATH (Homebrew caddy locally; CI needs an install step).
"""

from __future__ import annotations

import http.client
import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import pytest

from mirror.sockets import UnixHTTPServer

REPO = Path(__file__).resolve().parents[1]
CADDYFILE = REPO / "deploy" / "Caddyfile.local"
BODY = b"same body on both lanes"
TRACK_ID = "trk_0123456789abcdef"
AGENT_UA = "python-agent/1.0"
HUMAN_UA = "Mozilla/5.0"
FORGED = {
    "X-Lane": "mirror",
    "X-Track-Id": "trk_forgedforgedforg",
    "X-Client-Ip": "203.0.113.66",
    "X-Request-Id": "forged-request-id",
}
SOFTWARE_HEADERS = ("server", "via", "x-powered-by", "x-lane", "x-track-id")
STARTUP_S = 10.0
# Caddyfile.local gives the lane endpoint 2 s to answer; the hang must outlast it.
LANE_HANG_S = 3.0


@dataclass
class Received:
    method: str
    path: str
    headers: dict[str, str]
    body: bytes


@dataclass
class Stub:
    name: str
    seen: list[Received] = field(default_factory=list)
    hang_s: float = 0.0
    status: int = http.client.OK
    server: UnixHTTPServer | None = None

    def close(self) -> None:
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.server = None


def _handler(stub: Stub) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self) -> None:
            self._answer()

        def do_POST(self) -> None:
            self._answer()

        def _answer(self) -> None:
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            stub.seen.append(Received(self.command, self.path, dict(self.headers.items()), body))
            time.sleep(stub.hang_s)
            self.send_response(stub.status)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(BODY)))
            self.send_header("Via", f"1.1 {stub.name}")
            self.send_header("X-Powered-By", stub.name)
            if stub.name == "lane":
                mirror = AGENT_UA in self.headers.get("User-Agent", "")
                self.send_header("X-Lane", "mirror" if mirror else "real")
                self.send_header("X-Track-Id", TRACK_ID if mirror else "")
            self.end_headers()
            self.wfile.write(BODY)

        def version_string(self) -> str:
            return f"{stub.name}/1.0"

        def log_message(self, format: str, *args: object) -> None:
            return None

    return Handler


def _serve(stub: Stub, path: Path) -> Stub:
    stub.server = UnixHTTPServer(path, _handler(stub))
    threading.Thread(target=stub.server.serve_forever, daemon=True).start()
    return stub


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
        return port


@dataclass
class Reply:
    status: int
    headers: dict[str, str]
    body: bytes


@dataclass
class Edge:
    root: Path
    port: int
    real: Stub
    lane: Stub
    tap: Stub

    def send(
        self, method: str, path: str, ua: str = HUMAN_UA, body: bytes | None = None, **extra: str
    ) -> Reply:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request(method, path, body=body, headers={"User-Agent": ua, **extra})
            res = conn.getresponse()
            headers = {k.lower(): v for k, v in res.getheaders()}
            return Reply(res.status, headers, res.read())
        finally:
            conn.close()


def _wait_listening(port: int, caddy: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + STARTUP_S
    while time.monotonic() < deadline:
        assert caddy.poll() is None, "caddy exited during startup"
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.05)
    raise AssertionError("caddy did not listen in time")


@pytest.fixture
def edge() -> Iterator[Edge]:
    caddy_bin = shutil.which("caddy")
    assert caddy_bin, "caddy is not on PATH: install Caddy 2.11 (brew install caddy)"
    # macOS caps AF_UNIX paths near 104 bytes; pytest's tmp_path can be longer.
    with tempfile.TemporaryDirectory(dir="/tmp") as name:
        root = Path(name)
        (root / "run").mkdir()
        port = _free_port()
        stubs = [_serve(Stub(n), root / "run" / f"{n}.sock") for n in ("real", "lane", "tap")]
        # The Caddyfile's socket and log paths are relative, so they resolve inside root.
        command = [caddy_bin, "run", "--config", str(CADDYFILE), "--adapter", "caddyfile"]
        env = {**os.environ, "STACK_EDGE_PORT": str(port)}
        caddy = subprocess.Popen(command, cwd=root, env=env, stderr=subprocess.DEVNULL)
        try:
            _wait_listening(port, caddy)
            yield Edge(root, port, *stubs)
        finally:
            caddy.terminate()
            caddy.wait(timeout=10)
            for stub in stubs:
                stub.close()


def test_real_lane_reaches_the_real_shop_with_edge_set_headers_only(edge: Edge) -> None:
    reply = edge.send("GET", "/products?id=7", **FORGED)
    assert (reply.status, reply.body) == (200, BODY)
    assert edge.tap.seen == []
    [asked] = edge.lane.seen
    assert (asked.method, asked.path) == ("GET", "/lane")
    assert asked.headers["X-Forwarded-Method"] == "GET"
    assert asked.headers["X-Forwarded-Uri"] == "/products?id=7"
    assert asked.headers["X-Client-Ip"] == "127.0.0.1"
    assert asked.headers["User-Agent"] == HUMAN_UA
    assert "X-Lane" not in asked.headers and "X-Track-Id" not in asked.headers
    [served] = edge.real.seen
    assert served.path == "/products?id=7"
    assert served.headers["X-Lane"] == "real" and "X-Track-Id" not in served.headers
    assert served.headers["X-Client-Ip"] == "127.0.0.1"
    request_id = served.headers["X-Request-Id"]
    assert request_id == asked.headers["X-Request-Id"] != FORGED["X-Request-Id"]
    assert len(request_id) == len("00000000-0000-0000-0000-000000000000")


def test_each_request_gets_its_own_request_id(edge: Edge) -> None:
    edge.send("GET", "/")
    edge.send("GET", "/")
    ids = {seen.headers["X-Request-Id"] for seen in edge.real.seen}
    assert len(ids) == len(edge.real.seen) == 2


def test_mirror_lane_reaches_the_tap_with_its_track_and_body(edge: Edge) -> None:
    reply = edge.send("POST", "/api/cart", ua=AGENT_UA, body=b'{"sku": 1}', **FORGED)
    assert (reply.status, reply.body) == (200, BODY)
    assert edge.real.seen == []
    [served] = edge.tap.seen
    assert (served.method, served.path, served.body) == ("POST", "/api/cart", b'{"sku": 1}')
    assert served.headers["X-Lane"] == "mirror" and served.headers["X-Track-Id"] == TRACK_ID
    assert served.headers["X-Client-Ip"] == "127.0.0.1"
    [asked] = edge.lane.seen
    assert asked.headers["X-Forwarded-Method"] == "POST" and asked.body == b""


@pytest.mark.parametrize("path", ["/login", "/api/session"])
def test_login_posts_take_the_tap_on_the_real_lane_too(edge: Edge, path: str) -> None:
    edge.send("POST", path, body=b"username=ana&password=x")
    [served] = edge.tap.seen
    assert (served.path, served.body) == (path, b"username=ana&password=x")
    assert served.headers["X-Lane"] == "real" and "X-Track-Id" not in served.headers
    assert edge.real.seen == []


def test_login_page_get_and_other_posts_stay_on_the_real_shop(edge: Edge) -> None:
    edge.send("GET", "/login")
    edge.send("POST", "/api/cart", body=b"{}")
    edge.send("POST", "/login/extra", body=b"{}")
    assert [s.path for s in edge.real.seen] == ["/login", "/api/cart", "/login/extra"]
    assert edge.tap.seen == []


def test_both_lanes_answer_with_identical_headers(edge: Edge) -> None:
    real = edge.send("GET", "/products")
    mirror = edge.send("GET", "/products", ua=AGENT_UA)
    assert len(edge.real.seen) == len(edge.tap.seen) == 1
    for reply in (real, mirror):
        assert not set(SOFTWARE_HEADERS) & reply.headers.keys(), reply.headers
    real.headers.pop("date")
    mirror.headers.pop("date")
    assert real.headers == mirror.headers
    assert real.body == mirror.body


def test_fails_open_to_the_real_shop_when_the_lane_socket_is_gone(edge: Edge) -> None:
    edge.lane.close()
    assert not (edge.root / "run" / "lane.sock").exists()
    page = edge.send("GET", "/products", ua=AGENT_UA, **FORGED)
    login = edge.send("POST", "/login", body=b"username=ana&password=x")
    assert (page.status, page.body) == (200, BODY) and login.status == 200
    assert not set(SOFTWARE_HEADERS) & page.headers.keys(), page.headers
    assert edge.tap.seen == []
    first, second = edge.real.seen
    assert first.path == "/products" and second.body == b"username=ana&password=x"
    for served in (first, second):
        assert "X-Lane" not in served.headers and "X-Track-Id" not in served.headers
        assert served.headers["X-Client-Ip"] == "127.0.0.1"
        assert served.headers["X-Request-Id"] != FORGED["X-Request-Id"]


def test_fails_open_when_the_lane_endpoint_does_not_answer_in_time(edge: Edge) -> None:
    edge.lane.hang_s = LANE_HANG_S
    started = time.monotonic()
    reply = edge.send("GET", "/products", ua=AGENT_UA)
    assert (reply.status, reply.body) == (200, BODY)
    assert time.monotonic() - started < LANE_HANG_S
    assert [s.path for s in edge.real.seen] == ["/products"] and edge.tap.seen == []


@pytest.mark.parametrize("status", [http.client.FOUND, http.client.INTERNAL_SERVER_ERROR])
def test_lane_error_answer_is_never_shown_and_counts_as_the_real_lane(
    edge: Edge, status: int
) -> None:
    edge.lane.status = status
    reply = edge.send("GET", "/products", ua=AGENT_UA)
    assert (reply.status, reply.body) == (200, BODY)
    assert not set(SOFTWARE_HEADERS) & reply.headers.keys(), reply.headers
    [served] = edge.real.seen
    assert "X-Lane" not in served.headers and "X-Track-Id" not in served.headers
    assert edge.tap.seen == []


def test_tap_failure_never_falls_through_to_real_data(edge: Edge) -> None:
    edge.tap.close()
    reply = edge.send("GET", "/api/users/1", ua=AGENT_UA)
    assert reply.status == http.client.BAD_GATEWAY
    assert edge.real.seen == []


def test_access_log_keeps_its_redaction(edge: Edge) -> None:
    edge.send("GET", "/rest/user/change-password?current=a&new=b&repeat=b", Cookie="sid=1")
    log = edge.root / "run" / "access.log"
    deadline = time.monotonic() + STARTUP_S
    while not (log.exists() and log.read_text().strip()) and time.monotonic() < deadline:
        time.sleep(0.05)
    entry = json.loads(log.read_text().splitlines()[-1])
    assert "Cookie" not in entry["request"]["headers"]
    assert entry["request"]["uri"].endswith("current=REDACTED&new=REDACTED&repeat=REDACTED")
