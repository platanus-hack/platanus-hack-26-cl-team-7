"""Acceptance tests for engine.webhook.post_verdict (stdlib JSON POST, never raises)."""

from __future__ import annotations

import json
import socket
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from engine.models import Verdict
from engine.webhook import post_verdict


@dataclass(frozen=True)
class Captured:
    method: str
    path: str
    content_type: str
    body: bytes


@dataclass
class Receiver:
    url: str
    received: list[Captured]


def _verdict() -> Verdict:
    return Verdict(
        session_id="198.51.100.9|curl/8.0",
        ip="198.51.100.9",
        user_agent="curl/8.0",
        rule="R3",
        reason="sensitive path /.env",
        critical=True,
        ts=1700000000.5,
        request_count=1,
        extra={"path": "/.env"},
    )


def _handler(store: list[Captured], status: int) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            ctype = self.headers.get("Content-Type", "")
            store.append(Captured("POST", self.path, ctype, body))
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()

    return Handler


def _serve(status: int) -> Iterator[Receiver]:
    store: list[Captured] = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(store, status))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield Receiver(f"http://127.0.0.1:{server.server_address[1]}/webhook", store)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture
def receiver() -> Iterator[Receiver]:
    yield from _serve(200)


@pytest.fixture
def failing_receiver() -> Iterator[Receiver]:
    yield from _serve(500)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        port: int = sock.getsockname()[1]
        return port


def test_posts_verdict_as_json_and_returns_true(receiver: Receiver) -> None:
    verdict = _verdict()
    assert post_verdict(receiver.url, verdict) is True
    assert len(receiver.received) == 1
    got = receiver.received[0]
    assert got.method == "POST"
    assert got.path == "/webhook"
    assert got.content_type.split(";")[0].strip() == "application/json"
    assert json.loads(got.body.decode("utf-8")) == verdict.to_dict()


def test_each_call_posts_exactly_once(receiver: Receiver) -> None:
    verdict = _verdict()
    assert post_verdict(receiver.url, verdict) is True
    assert post_verdict(receiver.url, verdict) is True
    assert len(receiver.received) == 2


def test_returns_false_without_raising_when_server_is_down(
    capfd: pytest.CaptureFixture[str],
) -> None:
    url = f"http://127.0.0.1:{_free_port()}/webhook"
    started = time.monotonic()
    assert post_verdict(url, _verdict(), timeout=1.0) is False
    assert time.monotonic() - started < 3.0
    assert capfd.readouterr().err.strip() != ""


def test_returns_false_on_unresolvable_host() -> None:
    assert post_verdict("http://nonexistent.invalid/webhook", _verdict(), timeout=1.0) is False


def test_returns_false_on_server_error_status(failing_receiver: Receiver) -> None:
    assert post_verdict(failing_receiver.url, _verdict(), timeout=1.0) is False
    assert len(failing_receiver.received) == 1


def test_returns_false_when_server_never_answers() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as silent:
        silent.bind(("127.0.0.1", 0))
        silent.listen(1)
        url = f"http://127.0.0.1:{silent.getsockname()[1]}/webhook"
        started = time.monotonic()
        assert post_verdict(url, _verdict(), timeout=0.5) is False
        assert time.monotonic() - started < 3.0


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://127.0.0.1/x", "http:///nohost"])
def test_rejects_non_http_urls_without_raising(url: str) -> None:
    assert post_verdict(url, _verdict(), timeout=0.5) is False


def test_keeps_query_string_in_request_target(receiver: Receiver) -> None:
    assert post_verdict(f"{receiver.url}?token=abc", _verdict()) is True
    assert receiver.received[0].path == "/webhook?token=abc"
