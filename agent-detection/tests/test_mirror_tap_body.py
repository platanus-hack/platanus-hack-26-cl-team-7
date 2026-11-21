"""mirror.proxy without sockets: read_body() on each framing the tap may get, and forward() to a
missing shop for a client that has hung up."""

from __future__ import annotations

import io
from email.message import Message
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

import pytest

from mirror import proxy
from mirror.proxy import forward, read_body


def handler(raw: bytes, **headers: str) -> BaseHTTPRequestHandler:
    made = BaseHTTPRequestHandler.__new__(BaseHTTPRequestHandler)
    message: Message[str, str] = Message()
    for name, value in headers.items():
        message[name.replace("_", "-")] = value
    made.headers, made.rfile = message, io.BytesIO(raw)
    return made


def test_read_body_follows_content_length_and_chunks() -> None:
    assert read_body(handler(b"abcdef", Content_Length="3")).head == b"abc"
    assert read_body(handler(b"")).head == b""
    chunked = b"3;ext=1\r\nabc\r\n2\r\nde\r\n0\r\nTrailer: x\r\n\r\nNEXT"
    body = read_body(handler(chunked, Transfer_Encoding="gzip, chunked"))
    assert (body.head, body.chunked, body.rest) == (b"abcde", True, 0)


def test_read_body_leaves_the_rest_of_a_long_body_unread(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(proxy, "MAX_INSPECT", 4)
    body = read_body(handler(b"abcdefgh", Content_Length="8"))
    assert (body.head, body.rest, body.chunked) == (b"abcd", 4, False)


@pytest.mark.parametrize(
    ("raw", "headers"),
    [
        (b"", {"Content_Length": "-1"}),
        (b"", {"Content_Length": "ten"}),
        (b"ab", {"Content_Length": "5"}),
        (b"3\r\nabc", {"Transfer_Encoding": "chunked"}),
        (b"zz\r\n", {"Transfer_Encoding": "chunked"}),
        (b"-3\r\nabc\r\n", {"Transfer_Encoding": "chunked"}),
        (b"3\r\nab", {"Transfer_Encoding": "chunked"}),
        (b"3\r\nabcX\r\n0\r\n\r\n", {"Transfer_Encoding": "chunked"}),
        (b"9" * 2000, {"Transfer_Encoding": "chunked"}),
    ],
)
def test_read_body_refuses_framing_it_cannot_follow(raw: bytes, headers: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        read_body(handler(raw, **headers))


def test_a_chunked_body_larger_than_the_inspect_limit_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(proxy, "MAX_INSPECT", 4)
    with pytest.raises(ValueError, match="larger"):
        read_body(handler(b"5\r\nabcde\r\n0\r\n\r\n", Transfer_Encoding="chunked"))


class Gone(io.BufferedIOBase):
    def write(self, data: Any) -> int:
        raise BrokenPipeError("the client hung up")


def test_a_502_to_a_client_that_is_gone_closes_quietly(tmp_path: Path) -> None:
    client = handler(b"")
    client.wfile = Gone()
    client.command, client.path, client.request_version = "GET", "/", "HTTP/1.1"
    client.close_connection = False
    assert forward(client, tmp_path / "missing.sock", read_body(client)) is None
    assert client.close_connection
