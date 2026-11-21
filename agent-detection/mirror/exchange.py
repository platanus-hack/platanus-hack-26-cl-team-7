"""One request the tap proxied to the twin, the twin's answer, and what the pair reveals.

From the request: the login username (form or JSON body), the body as form text (so the engine
signatures test it as they test a query string) and the hosts it names (each may get one egress
through the callback relay). From the answer: the twin-born values, which bind to the track and
follow the agent from any IP: token-like cookie values, tokens, usernames and emails. A value the
request itself sent is not twin-born (a login echoes its own username).
"""

from __future__ import annotations

import contextlib
import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, unquote_plus, urlencode, urlsplit

JSON_TYPE = "application/json"
LOGIN_FIELD = "username"
MAX_HOSTS = 8  # hosts granted per request
MAX_TWIN_BORN = 16  # values bound per answer
MAX_JSON_DEPTH = 8
# JSON fields that carry a twin user's identity or session; "token" values must look like one.
IDENTITY_FIELDS = frozenset({"user", "username", "email"})
SESSION_FIELDS = frozenset({"token"})
# A session token: long and free of the separators a cart or a preference cookie holds
# ("cart=1:2,3:1" is the same for many visitors and must never route anyone).
TOKEN = re.compile(r"[A-Za-z0-9_\-.~+/=]{16,4096}")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}")
# The scheme and authority of a URL the twin can fetch; "&" ends it, as it ends a form value.
URL = re.compile(r"\bhttps?://[^\s'\"<>/?#\\&]{1,255}", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class Exchange:
    track_id: str
    request_id: str
    method: str
    path: str  # raw, without the query
    query: str  # raw, without the "?"
    content_type: str  # of the request
    request_body: bytes  # what the tap read before it forwarded (at most its inspect limit)
    credentials: str  # the Cookie and Authorization values the request sent
    status: int
    response_type: str
    response_body: bytes  # the first bytes of the answer (at most the inspect limit)
    response_size: int  # every body byte the twin sent
    set_cookies: tuple[str, ...] = ()

    @property
    def body_form(self) -> str:
        return body_form(self.content_type, self.request_body)

    @property
    def sent(self) -> str:
        """Everything the request carried, decoded: a value in here is not twin-born."""
        text = self.request_body.decode("utf-8", "replace")
        return "\n".join((unquote_plus(self.query), text, unquote_plus(text), self.credentials))


def body_form(content_type: str, body: bytes) -> str:
    """The body as form text: a form as sent, a JSON object form-encoded the way the shop reads
    it (each value as str()), anything else as its text."""
    text = body.decode("utf-8", "replace")
    data = _json(content_type, text)
    if isinstance(data, dict):
        return urlencode({str(k): str(v) for k, v in data.items()})
    return text


def login_username(content_type: str, body: bytes) -> str:
    """The username a login POST sends, read as the shop reads it: a JSON body only as JSON."""
    text = body.decode("utf-8", "replace")
    if not _is_json(content_type):
        return dict(parse_qsl(text)).get(LOGIN_FIELD, "").strip()
    data = _json(content_type, text)
    value = data.get(LOGIN_FIELD) if isinstance(data, dict) else None
    return value.strip() if isinstance(value, str) else ""


def named_hosts(query: str, body: bytes) -> list[str]:
    """Hosts of the URLs in the query and the body (decoded, JSON slashes unescaped)."""
    text = body.decode("utf-8", "replace")
    found: dict[str, None] = {}
    for raw in (query, text):
        decoded = unquote_plus(unquote_plus(raw)).replace("\\/", "/")
        for match in URL.finditer(decoded):
            host = _host(match.group())
            if host:
                found.setdefault(host)
                if len(found) == MAX_HOSTS:
                    return list(found)
    return list(found)


def normal_host(host: str) -> str:
    return host.strip().rstrip(".").lower()


def twin_born_values(exchange: Exchange) -> list[str]:
    """The values the twin gave out in this answer, at most MAX_TWIN_BORN, in order found."""
    sent = exchange.sent
    found: dict[str, None] = {}
    for value in _candidates(exchange):
        if value and value not in sent:
            found.setdefault(value)
            if len(found) == MAX_TWIN_BORN:
                break
    return list(found)


def _candidates(exchange: Exchange) -> Iterator[str]:
    for header in exchange.set_cookies:
        _, _, value = header.partition(";")[0].partition("=")
        if TOKEN.fullmatch(value.strip().strip('"')):
            yield value.strip().strip('"')
    text = exchange.response_body.decode("utf-8", "replace")
    data = _json(exchange.response_type, text)
    if data is not None:
        yield from _identity(data, 0)
    for match in EMAIL.finditer(text):
        yield match.group()


def _identity(data: Any, depth: int) -> Iterator[str]:
    if depth > MAX_JSON_DEPTH or not isinstance(data, dict | list):
        return
    items = data.items() if isinstance(data, dict) else enumerate(data)
    for name, value in items:
        if isinstance(value, dict | list):
            yield from _identity(value, depth + 1)
        elif isinstance(value, str) and str(name).lower() in IDENTITY_FIELDS:
            yield value.strip()
        elif (
            isinstance(value, str)
            and str(name).lower() in SESSION_FIELDS
            and TOKEN.fullmatch(value)
        ):
            yield value


def _json(content_type: str, text: str) -> Any:
    """The parsed body when the content type says JSON and it parses; else None."""
    if not _is_json(content_type):
        return None
    with contextlib.suppress(ValueError, RecursionError):  # the request body is the attacker's
        return json.loads(text)
    return None


def _is_json(content_type: str) -> bool:
    return content_type.lower().startswith(JSON_TYPE)


def _host(url: str) -> str:
    try:
        host = urlsplit(url).hostname
    except ValueError:  # a bracketed host that is no IPv6 address
        return ""
    return normal_host(host or "")
