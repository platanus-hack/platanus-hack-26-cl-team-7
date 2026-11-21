"""Byte-exact HTTP proxying from an http.server handler to a shop on a Unix socket.

read_body() reads what the tap must see before it picks a shop: a Content-Length body up to
MAX_INSPECT bytes (the rest streams after), or a whole chunked body up to MAX_INSPECT. forward()
sends the request as it came (method, target, headers in order, body bytes), without hop-by-hop
headers and without the lane headers, so no shop can echo them. The answer goes back with the
shop's status, reason, headers and body bytes, in COPY_CHUNK pieces: a Content-Length body as it
is, any other body chunked. forward() keeps the first MAX_INSPECT body bytes for the recording
and the rules. A shop it cannot reach gives 502 with no body.
"""

from __future__ import annotations

import http.client
import logging
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from io import BufferedIOBase
from pathlib import Path

from mirror.lane import LANE_HEADER, TRACK_HEADER
from mirror.sockets import UnixHTTPConnection

MAX_INSPECT = 256 * 1024  # the shop reads at most 64 KB of a body and serves files to 256 KB
COPY_CHUNK = 64 * 1024
UPSTREAM_TIMEOUT = 30.0  # the twin's own fetch through the relay takes up to 3 s
MAX_CHUNK_LINE = 1024
CHUNKED = "chunked"
LAST_CHUNK = b"0\r\n\r\n"
NO_BODY = frozenset({HTTPStatus.NO_CONTENT, HTTPStatus.NOT_MODIFIED})
HOP_BY_HOP = frozenset(
    {"connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding"}
    | {"upgrade"}
)
NOT_FORWARDED = HOP_BY_HOP | {LANE_HEADER.lower(), TRACK_HEADER.lower()}

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Body:
    head: bytes  # what the tap read before it forwarded
    rest: int = 0  # Content-Length bytes still unread
    chunked: bool = False


@dataclass(frozen=True, slots=True)
class Answer:
    status: int
    content_type: str
    set_cookies: tuple[str, ...]
    kept: bytes  # the first MAX_INSPECT body bytes
    size: int  # every body byte


def read_body(handler: BaseHTTPRequestHandler) -> Body:
    """Raises ValueError for a framing the tap cannot follow (the connection must close)."""
    if CHUNKED in handler.headers.get("Transfer-Encoding", "").lower():
        return Body(_dechunk(handler.rfile), chunked=True)
    length = int(handler.headers.get("Content-Length") or 0)
    if length < 0:
        raise ValueError(f"negative Content-Length {length}")
    head = handler.rfile.read(min(length, MAX_INSPECT))
    if len(head) < min(length, MAX_INSPECT):
        raise ValueError("the body ends early")
    return Body(head, length - len(head))


def forward(handler: BaseHTTPRequestHandler, upstream: Path, body: Body) -> Answer | None:
    """Proxy the request to `upstream` and stream the answer back; None when it gave none."""
    connection = UnixHTTPConnection(upstream, UPSTREAM_TIMEOUT)
    try:
        response = _send(connection, handler, body)
    except (OSError, http.client.HTTPException, ValueError) as err:
        log.warning("tap: no answer from %s: %s", upstream, err)
        connection.close()
        handler.close_connection = handler.close_connection or body.rest > 0
        try:
            handler.send_response_only(HTTPStatus.BAD_GATEWAY)
            handler.send_header("Content-Length", "0")
            handler.end_headers()
        except OSError:  # the client is gone as well
            handler.close_connection = True
        return None
    try:
        return _stream(handler, response)
    finally:
        connection.close()


def _send(
    connection: UnixHTTPConnection, handler: BaseHTTPRequestHandler, body: Body
) -> http.client.HTTPResponse:
    connection.putrequest(handler.command, handler.path, skip_host=True, skip_accept_encoding=True)
    for name, value in handler.headers.items():
        if name.lower() not in NOT_FORWARDED:
            connection.putheader(name, value)
    if body.chunked:
        connection.putheader("Transfer-Encoding", CHUNKED)
    connection.endheaders()
    first = body.head
    if body.chunked:  # the whole body as one chunk, then the last chunk
        first = (_chunk(body.head) if body.head else b"") + LAST_CHUNK
    left = body.rest
    try:
        if first:
            connection.send(first)
        while left:
            data = handler.rfile.read(min(left, COPY_CHUNK))
            if not data:
                raise ValueError("the client's body ends early")
            connection.send(data)
            left -= len(data)
    except (BrokenPipeError, ConnectionResetError):  # the shop answered before it read it all,
        # as the shop does past 64 KB; its answer is still there to read
        handler.close_connection = handler.close_connection or left > 0
    return connection.getresponse()


def _stream(handler: BaseHTTPRequestHandler, response: http.client.HTTPResponse) -> Answer:
    has_body = handler.command != "HEAD" and response.status not in NO_BODY
    chunked = has_body and (response.chunked or response.getheader("Content-Length") is None)
    kept, size = bytearray(), 0
    try:
        handler.send_response_only(response.status, response.reason)
        for name, value in response.msg.items():
            if name.lower() not in HOP_BY_HOP:
                handler.send_header(name, value)
        if chunked:
            handler.send_header("Transfer-Encoding", CHUNKED)
        handler.end_headers()
        while has_body and (piece := response.read1(COPY_CHUNK)):
            size += len(piece)
            kept += piece[: max(MAX_INSPECT - len(kept), 0)]
            handler.wfile.write(_chunk(piece) if chunked else piece)
        if chunked:
            handler.wfile.write(LAST_CHUNK)
        elif has_body and response.length:  # read1() ends quietly when the shop closes early
            raise http.client.IncompleteRead(bytes(kept), response.length)
    except (OSError, http.client.HTTPException) as err:
        log.warning("tap: answer cut short: %s", err)
        handler.close_connection = True
    content_type = response.getheader("Content-Type") or ""
    cookies = tuple(response.msg.get_all("Set-Cookie") or ())
    return Answer(response.status, content_type, cookies, bytes(kept), size)


def _dechunk(stream: BufferedIOBase) -> bytes:
    data = bytearray()
    while True:
        line = stream.readline(MAX_CHUNK_LINE)
        if not line.endswith(b"\n"):
            raise ValueError("a chunk size line is cut or too long")
        size = int(line.partition(b";")[0].strip(), 16)
        if size < 0:
            raise ValueError("a negative chunk size")
        if size == 0:
            trailer = stream.readline(MAX_CHUNK_LINE)
            while trailer.strip():
                trailer = stream.readline(MAX_CHUNK_LINE)
            return bytes(data)
        if len(data) + size > MAX_INSPECT:
            raise ValueError("the chunked body is larger than the tap reads")
        piece = stream.read(size)
        if len(piece) < size or stream.readline(MAX_CHUNK_LINE).strip():
            raise ValueError("a chunk is cut or not followed by CRLF")
        data += piece


def _chunk(data: bytes) -> bytes:
    return b"%x\r\n%s\r\n" % (len(data), data)
