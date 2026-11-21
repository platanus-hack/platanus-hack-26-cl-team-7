"""Generic builders shared by the test files.

make_request(**overrides) -> Request
    A Request with sane defaults (ts=1000.0, ip=DEFAULT_IP, user_agent=DEFAULT_UA, GET /, 200).
    Override any field by keyword, e.g. make_request(ts=5.0, path="/.env").

caddy_line(...) -> str
    One Caddy v2 JSON access-log line ("http.log.access" logger, "handled request" msg), as Caddy
    writes it: headers are lists of strings, request.client_ip and request.remote_ip are both set
    unless overridden, uri carries the raw path plus query. user_agent=None omits the header;
    client_ip=None omits client_ip. No trailing newline.

caddy_runtime_line(msg) -> str
    A non-access Caddy log line (e.g. startup / TLS messages) that the reader must ignore.

append_lines(path, lines)
    Append each line plus "\\n" to a file and flush, the way Caddy appends to its log.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from engine.models import Request

DEFAULT_IP = "203.0.113.7"
DEFAULT_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15"


def make_request(
    *,
    ts: float = 1000.0,
    ip: str = DEFAULT_IP,
    user_agent: str = DEFAULT_UA,
    method: str = "GET",
    path: str = "/",
    query: str = "",
    status: int = 200,
) -> Request:
    return Request(
        ts=ts,
        ip=ip,
        user_agent=user_agent,
        method=method,
        path=path,
        query=query,
        status=status,
    )


def caddy_line(
    *,
    ts: float = 1732176000.123456,
    method: str = "GET",
    uri: str = "/",
    status: int = 200,
    user_agent: str | None = DEFAULT_UA,
    client_ip: str | None = DEFAULT_IP,
    remote_ip: str = DEFAULT_IP,
    host: str = "shop.localhost",
    extra_headers: dict[str, list[str]] | None = None,
) -> str:
    return json.dumps(
        _access_entry(
            ts=ts,
            request=_request_block(
                method=method,
                uri=uri,
                user_agent=user_agent,
                client_ip=client_ip,
                remote_ip=remote_ip,
                host=host,
                extra_headers=extra_headers,
            ),
            status=status,
        )
    )


def caddy_runtime_line(msg: str = "server running") -> str:
    return json.dumps(
        {"level": "info", "ts": 1732176000.0, "logger": "http", "msg": msg, "name": "srv0"}
    )


def append_lines(path: Path, lines: list[str]) -> None:
    with path.open("a", encoding="utf-8") as handle:
        for line in lines:
            handle.write(line + "\n")
        handle.flush()


def _request_block(
    *,
    method: str,
    uri: str,
    user_agent: str | None,
    client_ip: str | None,
    remote_ip: str,
    host: str,
    extra_headers: dict[str, list[str]] | None,
) -> dict[str, Any]:
    headers: dict[str, list[str]] = {
        "Accept": ["text/html,application/xhtml+xml"],
        "Accept-Encoding": ["gzip, deflate, br"],
    }
    if user_agent is not None:
        headers["User-Agent"] = [user_agent]
    headers.update(extra_headers or {})
    block: dict[str, Any] = {
        "remote_ip": remote_ip,
        "remote_port": "52144",
        "proto": "HTTP/1.1",
        "method": method,
        "host": host,
        "uri": uri,
        "headers": headers,
    }
    if client_ip is not None:
        block["client_ip"] = client_ip
    return block


def _access_entry(*, ts: float, request: dict[str, Any], status: int) -> dict[str, Any]:
    return {
        "level": "info",
        "ts": ts,
        "logger": "http.log.access.log0",
        "msg": "handled request",
        "request": request,
        "bytes_read": 0,
        "user_id": "",
        "duration": 0.000812,
        "size": 1432,
        "status": status,
        "resp_headers": {
            "Content-Type": ["text/html; charset=utf-8"],
            "Server": ["Caddy"],
        },
    }
