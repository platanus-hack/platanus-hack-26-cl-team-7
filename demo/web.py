"""Request and reply values shared by every shop handler, and the shop instance they run in."""

from __future__ import annotations

import contextlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

JSON = "application/json"
TEXT = "text/plain; charset=utf-8"
HTML = "text/html; charset=utf-8"
SESSION_COOKIE = "session"
CART_COOKIE = "cart"
BEARER = "bearer "


@dataclass(frozen=True)
class Reply:
    status: int
    content_type: str
    body: bytes
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Shop:
    """One shop instance. Real and twin run the same code; only these three values differ.
    `egress_proxy` is the only way out to the network: without it, server-side fetches fail."""

    db: Path
    files: Path
    egress_proxy: str | None = None


@dataclass(frozen=True)
class Call:
    method: str
    path: str
    params: dict[str, str]
    query: dict[str, str]
    form: dict[str, str]
    shop: Shop
    cookies: dict[str, str] = field(default_factory=dict)
    authorization: str = ""

    @property
    def token(self) -> str:
        """The session token from `Authorization: Bearer ...`, else from the session cookie."""
        if self.authorization.lower().startswith(BEARER):
            return self.authorization[len(BEARER) :].strip()
        return self.cookies.get(SESSION_COOKIE, "")


def as_json(data: Any, status: int = 200, headers: dict[str, str] | None = None) -> Reply:
    return Reply(status, JSON, json.dumps(data).encode(), headers or {})


def parse_query(text: str) -> dict[str, str]:
    """Query or urlencoded form fields; an empty value (`?invoice=`) is kept, a repeat wins."""
    return dict(parse_qsl(text, keep_blank_values=True))


def parse_form(content_type: str, body: bytes) -> dict[str, str]:
    text = body.decode("utf-8", errors="replace")
    if content_type.startswith(JSON):
        with contextlib.suppress(ValueError):
            data = json.loads(text)
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
        return {}
    return parse_query(text)


def parse_cookies(header: str) -> dict[str, str]:
    """The name=value pairs of a Cookie header. A malformed pair is skipped, never the whole
    header, and of two cookies with one name the first wins, as browsers send the closer one
    first."""
    jar: dict[str, str] = {}
    for pair in header.split(";"):
        name, sep, value = pair.partition("=")
        if sep and name.strip():
            jar.setdefault(name.strip(), value.strip())
    return jar


def session_cookie(token: str) -> str:
    return f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; SameSite=Lax"


def cleared(name: str) -> str:
    return f"{name}=; Max-Age=0; Path=/"
