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

from mirror.session_copy import copy_session
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
