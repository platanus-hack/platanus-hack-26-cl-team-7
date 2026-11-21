"""mirror.session_copy: copy on flag asks the sync service (POST /copy on run/sync.sock) to copy a
session to the twin, and only logs when sync fails or cannot be reached."""

from __future__ import annotations

import json
import tempfile
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import pytest

from mirror.session_copy import copy_session, real_values
from mirror.sockets import UnixHTTPServer


@pytest.fixture
def sock_dir() -> Iterator[Path]:
    # macOS caps AF_UNIX paths near 104 bytes; pytest's tmp_path can be longer.
    with tempfile.TemporaryDirectory(dir="/tmp") as name:
        yield Path(name)


class SyncHandler(BaseHTTPRequestHandler):
    bodies: list[tuple[str, dict[str, str]]] = []
    status = 200

    def do_POST(self) -> None:
        length = int(self.headers["Content-Length"])
        type(self).bodies.append((self.path, json.loads(self.rfile.read(length))))
        self.send_response(type(self).status)
        self.send_header("Content-Length", "0")
        self.end_headers()


@pytest.mark.parametrize("status", [200, 500])
def test_copy_session_posts_the_session_to_sync(
    sock_dir: Path, status: int, caplog: pytest.LogCaptureFixture
) -> None:
    SyncHandler.bodies, SyncHandler.status = [], status
    server = UnixHTTPServer(sock_dir / "sync.sock", SyncHandler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        copy_session(sock_dir / "sync.sock", "session=real-cookie-1")
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    assert SyncHandler.bodies == [("/copy", {"cookie": "session=real-cookie-1"})]
    assert ("sync answered 500" in caplog.text) is (status == 500)


def test_copy_session_logs_when_sync_is_down(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    copy_session(tmp_path / "missing.sock", "session=x")
    assert "copy on flag failed" in caplog.text


class ValuesHandler(BaseHTTPRequestHandler):
    seen: list[tuple[str, dict[str, list[str]]]] = []
    answer: tuple[int, bytes] = (200, b"")

    def do_POST(self) -> None:
        length = int(self.headers["Content-Length"])
        type(self).seen.append((self.path, json.loads(self.rfile.read(length))))
        status, body = type(self).answer
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (200, b'{"real": ["leo.espinoza68", 7]}', frozenset({"leo.espinoza68"})),
        (200, b'{"real": []}', frozenset()),
        (500, b'{"error": "copy failed"}', None),
        (200, b"not json", None),
        (200, b'["leo.espinoza68"]', None),
        (200, b'{"real": "leo.espinoza68"}', None),
    ],
)
def test_real_values_asks_sync_which_values_the_real_database_holds(
    sock_dir: Path, status: int, body: bytes, expected: frozenset[str] | None
) -> None:
    ValuesHandler.seen, ValuesHandler.answer = [], (status, body)
    server = UnixHTTPServer(sock_dir / "sync.sock", ValuesHandler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        found = real_values(sock_dir / "sync.sock", ["leo.espinoza68", "twin-session-value-0001"])
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    assert found == expected
    assert ValuesHandler.seen == [
        ("/real-values", {"values": ["leo.espinoza68", "twin-session-value-0001"]})
    ]


def test_real_values_is_none_when_sync_is_down(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    assert real_values(tmp_path / "missing.sock", ["leo.espinoza68"]) is None
    assert "real values: sync failed" in caplog.text
