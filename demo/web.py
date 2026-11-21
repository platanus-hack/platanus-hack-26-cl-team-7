"""Request and reply values shared by every shop handler, and the shop instance they run in."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from http.cookies import CookieError, SimpleCookie
from pathlib import Path
from typing import Any

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


def parse_cookies(header: str) -> dict[str, str]:
    jar: SimpleCookie = SimpleCookie()
    try:
        jar.load(header)
    except CookieError:
        return {}
    return {name: morsel.value for name, morsel in jar.items()}


def session_cookie(token: str) -> str:
    return f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; SameSite=Lax"


def cleared(name: str) -> str:
    return f"{name}=; Max-Age=0; Path=/"
