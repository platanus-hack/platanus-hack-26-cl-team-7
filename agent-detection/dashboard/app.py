"""Dashboard HTTP server: POST /webhook stores a verdict, GET /api/verdicts lists them newest
first, GET / serves the page that polls the list every second."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from dashboard.store import VerdictStore

PAGE = (Path(__file__).resolve().parent / "page.html").read_bytes()
# The engine copies the attacker's User-Agent into the verdict twice and JSON-escapes it, so one
# byte on the wire can become 12 bytes of body. Caddy refuses request headers above about 20 KB
# (431), which keeps a real verdict near 250 KB at most; the store clips long strings on write.
MAX_BODY = 1024 * 1024
DRAIN_LIMIT = 16 * MAX_BODY  # an oversize body is read and dropped up to this size, then 413


class DashboardServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], store: VerdictStore) -> None:
        super().__init__(address, DashboardHandler)
        self.store = store


class DashboardHandler(BaseHTTPRequestHandler):
    server_version = "AgentDetectDashboard/0"

    def do_GET(self) -> None:
        path = self.path.partition("?")[0]
        if path == "/":
            self._send(HTTPStatus.OK, "text/html; charset=utf-8", PAGE)
        elif path == "/api/verdicts":
            self._send_json(HTTPStatus.OK, self._store().recent())
        else:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path.partition("?")[0] != "/webhook":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        length = self._body_length()
        if length > MAX_BODY:
            self._discard(min(length, DRAIN_LIMIT))
            self.close_connection = True
            self.log_message("verdict body of %d bytes is over %d; not stored", length, MAX_BODY)
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "body too large"})
            return
        payload = self._read_object(length)
        if payload is None:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "body must be a JSON object"})
            return
        self._send_json(HTTPStatus.CREATED, {"id": self._store().add(payload)})

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        quiet_poll = (
            self.command == "GET" and isinstance(code, int) and code < HTTPStatus.BAD_REQUEST
        )
        if not quiet_poll:
            super().log_request(code, size)

    def _store(self) -> VerdictStore:
        server = self.server
        assert isinstance(server, DashboardServer)
        return server.store

    def _body_length(self) -> int:
        try:
            return int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return 0

    def _discard(self, length: int) -> None:
        while length > 0 and (chunk := self.rfile.read(min(length, 64 * 1024))):
            length -= len(chunk)

    def _read_object(self, length: int) -> dict[str, Any] | None:
        if length <= 0:
            return None
        try:
            payload = json.loads(self.rfile.read(length))
        except (ValueError, RecursionError):
            return None
        return payload if isinstance(payload, dict) else None

    def _send_json(self, status: HTTPStatus, data: Any) -> None:
        self._send(status, "application/json", json.dumps(data).encode("utf-8"))

    def _send(self, status: HTTPStatus, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def make_server(host: str, port: int, db: str | Path) -> DashboardServer:
    return DashboardServer((host, port), VerdictStore(db))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m dashboard", description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--db", type=Path, default=Path("verdicts.db"))
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    server = make_server(args.host, args.port, args.db)
    print(f"dashboard on http://{args.host}:{server.server_address[1]}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0
