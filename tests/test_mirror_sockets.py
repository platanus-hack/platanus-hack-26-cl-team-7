"""mirror.sockets: HTTP over AF_UNIX for the shops, router, tap and sync.

UnixHTTPServer(path, handler) binds a threading http.server to a socket path: it removes a stale
socket file, refuses a live socket or a non-socket file, chmods the socket 0600 and removes it
on close. UnixHTTPConnection(path, timeout) is http.client over that path.
"""

from __future__ import annotations

import socket
import stat
import tempfile
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import pytest

from mirror.sockets import LOCAL_PEER, UnixHTTPConnection, UnixHTTPServer

LOGGED: list[str] = []


class Echo(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers["Content-Length"]))
        reply = f"{self.command} {self.path} {self.headers['Host']} {self.address_string()} "
        self._send(reply.encode() + body)

    def do_GET(self) -> None:
        self._send(f"{self.client_address!r}".encode())

    def _send(self, body: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        LOGGED.append(f"{self.address_string()} {format % args}")


@pytest.fixture
def sock_dir() -> Iterator[Path]:
    # macOS caps AF_UNIX paths near 104 bytes; pytest's tmp_path can be longer.
    with tempfile.TemporaryDirectory(dir="/tmp") as name:
        yield Path(name)


def serve(path: Path) -> UnixHTTPServer:
    server = UnixHTTPServer(path, Echo)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def call(path: Path, method: str, url: str, body: bytes | None = None) -> tuple[int, bytes]:
    conn = UnixHTTPConnection(path, timeout=2.0)
    try:
        conn.request(method, url, body=body)
        response = conn.getresponse()
        return response.status, response.read()
    finally:
        conn.close()


def stop(server: UnixHTTPServer) -> None:
    server.shutdown()
    server.server_close()


def test_round_trip_over_the_socket(sock_dir: Path) -> None:
    server = serve(sock_dir / "shop.sock")
    try:
        status, body = call(sock_dir / "shop.sock", "POST", "/login?next=%2F", b"user=a")
        assert status == 200
        assert body == b"POST /login?next=%2F localhost local user=a"
        assert call(sock_dir / "shop.sock", "GET", "/")[1] == repr(LOCAL_PEER).encode()
        assert any(line.startswith('local "GET / HTTP/1.1" 200') for line in LOGGED)
    finally:
        stop(server)


def test_socket_is_owner_only(sock_dir: Path) -> None:
    server = serve(sock_dir / "real.sock")
    try:
        mode = (sock_dir / "real.sock").stat().st_mode
        assert stat.S_ISSOCK(mode)
        assert stat.S_IMODE(mode) == 0o600
    finally:
        stop(server)


def test_close_removes_its_own_socket_file(sock_dir: Path) -> None:
    path = sock_dir / "twin.sock"
    stop(serve(path))
    assert not path.exists()


def test_close_keeps_a_socket_file_that_another_server_replaced(sock_dir: Path) -> None:
    path = sock_dir / "lane.sock"
    first = UnixHTTPServer(path, Echo, bind_and_activate=False)
    first.server_bind()
    path.unlink()
    second = serve(path)
    try:
        first.server_close()
        assert call(path, "GET", "/")[0] == 200
    finally:
        stop(second)


def test_stale_socket_file_is_replaced(sock_dir: Path) -> None:
    path = sock_dir / "tap.sock"
    dead = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    dead.bind(str(path))
    dead.close()
    assert path.exists()
    server = serve(path)
    try:
        assert call(path, "GET", "/")[0] == 200
    finally:
        stop(server)


def test_live_socket_is_not_taken_over(sock_dir: Path) -> None:
    path = sock_dir / "sync.sock"
    server = serve(path)
    try:
        with pytest.raises(FileExistsError, match="in use"):
            UnixHTTPServer(path, Echo)
        assert call(path, "GET", "/")[0] == 200
    finally:
        stop(server)


def test_regular_file_is_never_removed(sock_dir: Path) -> None:
    path = sock_dir / "real.sock"
    path.write_text("not a socket", encoding="utf-8")
    with pytest.raises(FileExistsError, match="not a socket"):
        UnixHTTPServer(path, Echo)
    assert path.read_text(encoding="utf-8") == "not a socket"


def test_connection_to_a_missing_socket_fails_like_a_network_error(sock_dir: Path) -> None:
    conn = UnixHTTPConnection(sock_dir / "gone.sock", timeout=1.0)
    with pytest.raises(OSError):
        conn.request("GET", "/")
    assert conn.sock is None


def test_caller_host_header_wins(sock_dir: Path) -> None:
    server = serve(sock_dir / "real.sock")
    try:
        conn = UnixHTTPConnection(sock_dir / "real.sock")
        conn.request("POST", "/x", body=b"", headers={"Host": "shop.example"})
        assert b" shop.example " in conn.getresponse().read()
        conn.close()
    finally:
        stop(server)


def test_a_burst_of_connects_waits_in_the_listen_queue(sock_dir: Path) -> None:
    # A full Unix-socket queue refuses (macOS) or stalls (Linux) the next connect; Caddy opens
    # many connections at once, and socketserver's default queue holds only 5.
    path = sock_dir / "lane.sock"
    server = UnixHTTPServer(path, Echo)  # listening, but nothing accepts yet
    clients = [socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) for _ in range(32)]
    try:
        for client in clients:
            client.settimeout(1.0)
            client.connect(str(path))
    finally:
        for client in clients:
            client.close()
        server.server_close()
    assert server.request_queue_size == socket.SOMAXCONN
