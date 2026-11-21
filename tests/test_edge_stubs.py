"""Shared harness for tests/test_edge_*.py: deploy/Caddyfile.local run by a real Caddy against
stub Unix-socket services. It holds no tests (the test_edge_ name keeps it with the edge tests).

The stubs stand in for the real shop (run/real.sock), the router's lane endpoint (run/lane.sock)
and its tap (run/tap.sock). The lane stub puts any User-Agent with "agent" in it on the mirror
lane. Every stub answers the same body, and each sends its own Server, Via and X-Powered-By
values, so a response header that survives the edge would tell the lanes apart. The tap also sends
a second, older Date, as a proxy that copies the twin's Date beside its own would. Each stub's
listen queue holds one connection, so a burst overflows it and refuses dials, as a busy router
would. A dropping stub reads the request and closes the connection without an answer. Caddy must
be on PATH (Homebrew caddy locally; CI needs an install step).
"""

from __future__ import annotations

import http.client
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from collections.abc import Iterator, Mapping
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
POLL_S = 0.02  # how often a stub's serve_forever checks for shutdown
# Caddyfile.local gives the lane endpoint 2 s to answer; the hang must outlast it.
LANE_HANG_S = 3.0
STALE_DATE = "Thu, 01 Jan 1970 00:00:00 GMT"
EXTRA_HEADERS = {"tap": (("Date", STALE_DATE),)}


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
    extra: tuple[tuple[str, str], ...] = ()
    drop: bool = False
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
            if stub.drop:
                self.close_connection = True
                return
            self.send_response(stub.status)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(BODY)))
            self.send_header("Via", f"1.1 {stub.name}")
            self.send_header("X-Powered-By", stub.name)
            for name, value in stub.extra:
                self.send_header(name, value)
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


class _TightServer(UnixHTTPServer):
    request_queue_size = 1


def serve(stub: Stub, path: Path) -> Stub:
    stub.server = _TightServer(path, _handler(stub))
    serving = threading.Thread(target=stub.server.serve_forever, args=(POLL_S,), daemon=True)
    serving.start()
    return stub


def leave_stale(path: Path) -> None:
    """A socket file with no server behind it, as a crashed process leaves: connects are refused."""
    with socket.socket(socket.AF_UNIX) as dead:
        dead.bind(str(path))


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
    pairs: list[tuple[str, str]]

    def count(self, name: str) -> int:
        return sum(key.lower() == name for key, _ in self.pairs)


@dataclass
class Edge:
    root: Path
    port: int
    real: Stub
    lane: Stub
    tap: Stub

    def send(
        self,
        method: str,
        path: str,
        ua: str = HUMAN_UA,
        body: bytes | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> Reply:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request(method, path, body=body, headers={"User-Agent": ua, **(headers or {})})
            res = conn.getresponse()
            pairs = res.getheaders()
            return Reply(res.status, {k.lower(): v for k, v in pairs}, res.read(), pairs)
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


def caddy_path() -> str:
    caddy_bin = shutil.which("caddy")
    assert caddy_bin, "caddy is not on PATH: install Caddy 2.11 (brew install caddy)"
    return caddy_bin


@pytest.fixture(name="edge")
def edge_fixture() -> Iterator[Edge]:
    caddy_bin = caddy_path()
    # macOS caps AF_UNIX paths near 104 bytes; pytest's tmp_path can be longer.
    with tempfile.TemporaryDirectory(dir="/tmp") as name:
        root = Path(name)
        (root / "run").mkdir()
        port = _free_port()
        stubs = [
            serve(Stub(name, extra=EXTRA_HEADERS.get(name, ())), root / "run" / f"{name}.sock")
            for name in ("real", "lane", "tap")
        ]
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
