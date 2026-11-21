"""The client request as Caddy's forward_auth sends it to GET /lane, and the keys it carries.

Caddy deletes client-sent X-Client-Ip and X-Request-Id first, then sets them from {remote_host}
and {http.request.uuid}, so neither can be forged. A request id that cannot form an eventId is
replaced by a fresh one; a missing or malformed client IP makes the request invalid (ValueError).
"""

from __future__ import annotations

import base64
import binascii
import re
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from email.message import Message
from urllib.parse import parse_qsl

from engine.models import session_key
from mirror.contracts import MAX_KEY_VALUE, TrackKey
from mirror.keys import twin_born_key

MAX_CANDIDATES = 16  # twin-born values tried per request, so a huge query costs no more
DEFAULT_URI = "/"
DEFAULT_METHOD = "GET"
_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")


@dataclass(frozen=True, slots=True)
class Forwarded:
    request_id: str
    method: str
    path: str  # raw, without the query
    query: str  # raw, without the "?"
    ip: str
    user_agent: str
    cookie: str = ""
    authorization: str = ""
    ip_key: TrackKey = field(init=False)
    ip_ua_key: TrackKey = field(init=False)

    def __post_init__(self) -> None:
        ip_ua = session_key(self.ip, self.user_agent)[:MAX_KEY_VALUE]
        object.__setattr__(self, "ip_key", TrackKey("ip", self.ip))
        object.__setattr__(self, "ip_ua_key", TrackKey("ip_ua", ip_ua))

    @classmethod
    def from_headers(cls, headers: Message[str, str]) -> Forwarded:
        path, _, query = (headers.get("X-Forwarded-Uri") or DEFAULT_URI).partition("?")
        request_id = headers.get("X-Request-Id", "")
        return cls(
            request_id=request_id if _REQUEST_ID.fullmatch(request_id) else uuid.uuid4().hex,
            method=headers.get("X-Forwarded-Method") or DEFAULT_METHOD,
            path=path,
            query=query,
            ip=headers.get("X-Client-Ip", ""),
            user_agent=headers.get("User-Agent", ""),
            cookie=headers.get("Cookie", ""),
            authorization=headers.get("Authorization", ""),
        )

    def twin_born_keys(self) -> list[TrackKey]:
        """Keys for the cookie values, the credential and the query values, at most
        MAX_CANDIDATES, without repeats. Values too short to bind are left out."""
        keys: dict[str, TrackKey] = {}
        for raw in self._candidates():
            key = twin_born_key(raw)
            if key is not None:
                keys.setdefault(key.value, key)
                if len(keys) == MAX_CANDIDATES:
                    break
        return list(keys.values())

    def _candidates(self) -> Iterator[str]:
        for pair in self.cookie.split(";"):
            _, sep, value = pair.partition("=")
            if sep:
                yield value.strip().strip('"')
        scheme, _, credential = self.authorization.strip().partition(" ")
        yield credential.strip() or scheme  # "Bearer <token>" gives the token; a bare value stays
        if scheme.lower() == "basic":
            yield _basic_user(credential.strip())
        for _, value in parse_qsl(self.query):
            yield value


def _basic_user(credential: str) -> str:
    try:
        decoded = base64.b64decode(credential, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return ""
    return decoded.partition(":")[0]
