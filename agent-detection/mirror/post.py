"""One POST of deception events to Sentinel, and how big its body may be.

Sentinel refuses a body over its limit (deception-routes.ts MAX_BODY_BYTES) by closing the
connection, so the router sees a broken pipe, never a 413. A batch is therefore cut by encoded
size before it is sent, not only by event count: json.dumps escapes each non-ASCII character as
6 bytes (12 outside the BMP), so 500 events of CJK text reach several times 8 MB.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from http.client import HTTPConnection, HTTPSConnection, InvalidURL
from typing import Any
from urllib.parse import urlsplit

from mirror.contracts import MAX_BATCH

POST_TIMEOUT = 2.0
SENTINEL_BODY_LIMIT = 16 * 1024 * 1024
MAX_BATCH_BYTES = SENTINEL_BODY_LIMIT // 2  # half of it, whatever the list's own punctuation adds
_HTTP: dict[str, type[HTTPConnection]] = {"http": HTTPConnection, "https": HTTPSConnection}

Wire = dict[str, Any]


def post_batch(url: str, token: str, batch: list[Wire], timeout: float = POST_TIMEOUT) -> int:
    """POST one batch; the HTTP status. `url` is the --sentinel base plus EVENTS_PATH."""
    target = urlsplit(url)
    connect = _HTTP.get(target.scheme)
    if connect is None or not target.hostname:
        raise InvalidURL(f"sentinel URL must be http(s)://host[:port]: {url!r}")
    connection = connect(target.hostname, target.port, timeout=timeout)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        connection.request("POST", target.path, json.dumps(batch).encode(), headers)
        response = connection.getresponse()
        response.read()
        return response.status
    finally:
        connection.close()


def wire_size(wire: Wire) -> int:
    """Bytes the event adds to a batch body: its JSON (all ASCII) and the ", " before the next."""
    return len(json.dumps(wire)) + 2


def by_size(events: list[Wire], limit: int) -> Iterator[list[Wire]]:
    """The events in order as parts of at most MAX_BATCH events and `limit` body bytes. An event
    over the limit by itself is a part of its own: the caller decides what to do with it."""
    part: list[Wire] = []
    size = 0
    for wire in events:
        cost = wire_size(wire)
        if part and (len(part) == MAX_BATCH or size + cost > limit):
            yield part
            part, size = [], 0
        part.append(wire)
        size += cost
    if part:
        yield part
