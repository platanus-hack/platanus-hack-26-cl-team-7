"""mirror.proxy: the tap's byte-exact proxying to a shop on a Unix socket, through a front server
that runs read_body() and forward() as the tap does, against an upstream stub shop."""

from __future__ import annotations

import contextlib
import http.client
import json
import socket
import socketserver
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

import pytest

from mirror import proxy
from mirror.proxy import Answer, forward, read_body
from mirror.sockets import UnixHTTPConnection, UnixHTTPServer
from tests.test_twin_support import socket_dir

BINARY = bytes(range(256)) * 3
WAIT = 5.0
POLL = 0.02  # how often a test server checks for shutdown


@contextlib.contextmanager
def serving[S: socketserver.BaseServer](server: S) -> Iterator[S]:
    """Serve on a thread until the block ends; shared by the tap and relay tests."""
    thread = threading.Thread(target=server.serve_forever, args=(POLL,), daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@dataclass
class Stack:
    front: Path
    upstream: Path
    answers: list[Answer | None] = field(default_factory=list)
    seen: list[dict[str, Any]] = field(default_factory=list)

    def answered(self, count: int = 1) -> list[Answer | None]:
        """The front's answers once it has recorded `count`: a client may finish reading first."""
        deadline = time.monotonic() + WAIT
        while len(self.answers) < count:
            assert time.monotonic() < deadline, "the front never recorded its answer"
            time.sleep(0.005)
        return self.answers


def upstream_handler(stack: Stack) -> type[BaseHTTPRequestHandler]:
    class Upstream(BaseHTTPRequestHandler):  # HTTP/1.0, as the shop answers
        def do_GET(self) -> None:
            if self.path == "/early":  # answers before it reads the body, then closes
                self.send_response_only(200)
                self.send_header("Content-Length", "5")
                self.end_headers()
                self.wfile.write(b"early")
                return
            chunked = "chunked" in self.headers.get("Transfer-Encoding", "")
            length = int(self.headers.get("Content-Length") or 0)
            body = read_body(self).head if chunked else self.rfile.read(length)
            if len(body) < length:  # the tap gave up on a client that stopped sending
                return
            seen = {"method": self.command, "path": self.path, "body": body.decode()}
            stack.seen.append(seen | {"headers": self.headers.items(), "chunked": chunked})
            self.send_response_only(201 if self.path == "/exact" else 200, "Made It")
            self.send_header("Server", "DemoShop/0.1")
            if self.path == "/exact":
                for name, value in (("Set-Cookie", "a=1"), ("Set-Cookie", "b=2"), ("X-Dup", "1")):
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(BINARY)))
                self.end_headers()
                self.wfile.write(BINARY)
            elif self.path == "/chunked":
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                self.wfile.write(b"5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n")
            elif self.path == "/close":  # no length: the body ends when the connection does
                self.end_headers()
                self.wfile.write(b"until close")
            elif self.path == "/drop":
                self.send_header("Content-Length", "100")
                self.end_headers()
                self.wfile.write(b"only ten b")
            else:
                reply = json.dumps(stack.seen[-1]).encode()
                self.send_header("Content-Length", str(len(reply)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(reply)

        do_HEAD = do_POST = do_GET

        def log_message(self, format: str, *args: Any) -> None:
            return None

    return Upstream


def front_handler(stack: Stack) -> type[BaseHTTPRequestHandler]:
    class Front(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self) -> None:
            stack.answers.append(forward(self, stack.upstream, read_body(self)))

        do_HEAD = do_POST = do_GET

        def log_message(self, format: str, *args: Any) -> None:
            return None

    return Front


@pytest.fixture
def stack() -> Iterator[Stack]:
    with socket_dir() as run:
        made = Stack(run / "front.sock", run / "up.sock")
        with (
            serving(UnixHTTPServer(made.upstream, upstream_handler(made))),
            serving(UnixHTTPServer(made.front, front_handler(made))),
        ):
            yield made


def call(
    stack: Stack, method: str, path: str, body: Any = None, **headers: str
) -> tuple[http.client.HTTPResponse, bytes]:
    connection = UnixHTTPConnection(stack.front)
    try:
        chunked = headers.pop("chunked", "") == "yes"
        connection.request(method, path, body, headers, encode_chunked=chunked)
        response = connection.getresponse()
        return response, response.read()
    finally:
        connection.close()


def test_status_reason_headers_and_body_bytes_pass_as_the_shop_sent_them(stack: Stack) -> None:
    response, data = call(stack, "GET", "/exact")
    assert (response.status, response.reason, data) == (201, "Made It", BINARY)
    assert response.getheaders() == [
        ("Server", "DemoShop/0.1"),
        ("Set-Cookie", "a=1"),
        ("Set-Cookie", "b=2"),
        ("X-Dup", "1"),
        ("Content-Length", str(len(BINARY))),
    ]
    [answer] = stack.answered()
    assert answer == Answer(201, "", ("a=1", "b=2"), BINARY, len(BINARY))


def test_the_request_reaches_the_shop_without_lane_or_hop_by_hop_headers(stack: Stack) -> None:
    sent = {"X-Lane": "mirror", "X-Track-Id": "trk_0123456789abcdef", "X-Client-Ip": "::1"}
    sent |= {"Keep-Alive": "timeout=5", "TE": "trailers", "X-Custom": "kept"}
    call(stack, "POST", "/echo?q=%27+or+1%3D1", b"user=a&pw=b", **sent)
    [seen] = stack.seen
    assert (seen["method"], seen["path"], seen["body"]) == (
        "POST",
        "/echo?q=%27+or+1%3D1",
        "user=a&pw=b",
    )
    names = [name.lower() for name, _ in seen["headers"]]
    assert names == ["host", "accept-encoding", "content-length", "x-client-ip", "x-custom"]
    assert seen["headers"][0] == ("Host", "localhost")


def test_a_body_past_the_inspect_limit_streams_on_and_only_its_head_is_kept(
    stack: Stack, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(proxy, "MAX_INSPECT", 8)
    monkeypatch.setattr(proxy, "COPY_CHUNK", 5)
    long = b"field=" + b"x" * 40
    response, data = call(stack, "POST", "/echo", long, **{"Content-Type": "text/plain"})
    assert stack.seen[0]["body"] == long.decode()
    [answer] = stack.answered()
    assert answer is not None
    assert answer.kept == data[:8] and answer.size == len(data)


def test_a_chunked_request_reaches_the_shop_chunked(stack: Stack) -> None:
    call(stack, "POST", "/echo", iter([b"user=", b"agent"]), chunked="yes")
    [seen] = stack.seen
    assert (seen["body"], seen["chunked"]) == ("user=agent", True)
    assert "content-length" not in [name.lower() for name, _ in seen["headers"]]


@pytest.mark.parametrize(
    ("path", "body"), [("/chunked", b"hello world"), ("/close", b"until close")]
)
def test_an_answer_without_a_length_goes_back_chunked(stack: Stack, path: str, body: bytes) -> None:
    response, data = call(stack, "GET", path)
    assert data == body
    assert response.getheader("Transfer-Encoding") == "chunked"


def test_one_client_connection_carries_many_requests(stack: Stack) -> None:
    connection = UnixHTTPConnection(stack.front)
    try:
        for path in ("/chunked", "/exact", "/close", "/echo"):
            connection.request("GET", path)
            response = connection.getresponse()
            assert response.read() and response.status in (200, 201)
    finally:
        connection.close()
    assert len(stack.answered(4)) == 4


def test_head_keeps_the_shop_length_and_sends_no_body(stack: Stack) -> None:
    response, data = call(stack, "HEAD", "/echo")
    assert data == b""
    assert int(response.getheader("Content-Length") or 0) > 0


def test_a_shop_that_cannot_be_reached_gives_502_with_no_body(tmp_path: Path) -> None:
    with socket_dir() as run:
        stack = Stack(run / "front.sock", run / "missing.sock")
        with serving(UnixHTTPServer(stack.front, front_handler(stack))):
            response, data = call(stack, "POST", "/login", b"username=a&password=b")
    assert (response.status, data, response.getheader("Content-Length")) == (502, b"", "0")
    assert stack.answered() == [None]


def test_a_shop_that_drops_mid_body_cuts_the_answer_and_the_connection(stack: Stack) -> None:
    with pytest.raises(http.client.IncompleteRead):
        call(stack, "GET", "/drop")
    [answer] = stack.answered()
    assert answer is not None and answer.kept == b"only ten b"


def test_a_shop_that_answers_before_reading_the_body_still_answers(
    stack: Stack, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(proxy, "MAX_INSPECT", 8)
    sends: list[int] = []
    send = UnixHTTPConnection.send

    def closed_after_the_head(self: UnixHTTPConnection, data: Any) -> None:
        if self.socket_path == stack.upstream:  # the tap's side; the test client sends as usual
            sends.append(len(data))
            if len(sends) > 2:  # the headers and the head went out; the rest breaks the pipe
                raise BrokenPipeError("the shop closed")
        send(self, data)

    monkeypatch.setattr(UnixHTTPConnection, "send", closed_after_the_head)
    assert call(stack, "POST", "/early", b"x" * 40)[1] == b"early"
    assert sends[1] == 8  # the head; the shop may close before it, or before the rest


def test_a_client_body_that_ends_early_gets_502(
    stack: Stack, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(proxy, "MAX_INSPECT", 8)
    with socket.socket(socket.AF_UNIX) as raw:
        raw.connect(str(stack.front))
        raw.sendall(b"POST /echo HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\n" + b"y" * 20)
        raw.shutdown(socket.SHUT_WR)
        assert raw.makefile("rb").read().startswith(b"HTTP/1.1 502 ")
    assert stack.answered() == [None]
