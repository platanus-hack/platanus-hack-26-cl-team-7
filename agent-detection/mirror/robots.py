"""GET /robots.txt on run/robots.sock: the shop's robots.txt plus one marker per identity.

Caddy sends every GET /robots.txt here, on both lanes, so the lanes answer alike. The answer is
the shop's own robots.txt (the real shop's on the real lane, the twin's on the mirror lane; fetched
with a fixed request that carries nothing of the client's, and kept BASE_TTL seconds) with one
more line: Disallow for the marker of the identity Caddy names in X-Client-Ip and User-Agent
(mirror.markers). A shop without the file gets a file with only that line. Without markers (the
swarm link is off) or without a client IP (the request did not come through Caddy) the shop's
answer goes out as it is. A shop that does not answer is asked again FAIL_TTL seconds later.

A mirror-lane request is reported as a track.action, as the tap reports every other one.
"""

from __future__ import annotations

import http.client
import logging
import threading
import time
from dataclasses import dataclass, field
from email.message import Message
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from engine.models import session_key
from mirror.contracts import MAX_BODY, MAX_KEY_VALUE, MAX_URI, TrackAction, event_id
from mirror.lane import LANE_HEADER, TRACK_HEADER, Emit
from mirror.markers import ROBOTS_PATH, Clock, Markers, with_marker
from mirror.sockets import UnixHTTPConnection

BASE_TTL = 60.0
FAIL_TTL = 5.0  # a shop that did not answer is asked again this soon
FETCH_TIMEOUT = 2.0
MAX_BASE = 64 * 1024  # a robots.txt past this is cut; crawlers read no more than 500 KiB anyway
TEXT = "text/plain; charset=utf-8"
MIRROR = "mirror"

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Page:
    status: int
    content_type: str
    body: bytes


@dataclass(slots=True)
class Robots:
    real: Path
    twin: Path
    markers: Markers | None  # None: the swarm link is off
    emit: Emit
    clock: Clock = time.monotonic
    _kept: dict[Path, tuple[float, Page]] = field(default_factory=dict)  # shop -> until, page
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def page(self, headers: Message[str, str]) -> Page:
        mirror = headers.get(LANE_HEADER) == MIRROR
        base, identity = self._shop(self.twin if mirror else self.real), identity_of(headers)
        if self.markers is None or identity is None:
            return base
        marker = self.markers.path_for(identity)
        if base.status != HTTPStatus.OK:
            return Page(HTTPStatus.OK, TEXT, with_marker(b"", marker))
        return Page(base.status, base.content_type, with_marker(base.body, marker))

    def report(self, headers: Message[str, str], target: str, page: Page, started: float) -> None:
        """One track.action for a mirror-lane request; nothing on the real lane."""
        track = headers.get(TRACK_HEADER, "")
        if headers.get(LANE_HEADER) != MIRROR or not track:
            return
        path, _, query = target.partition("?")
        try:
            self.emit(
                TrackAction(
                    event_id=event_id("track.action", headers.get("X-Request-Id", "")),
                    track_id=track,
                    ts=int(time.time() * 1000),
                    method="GET",
                    path=path[:MAX_URI],
                    query=query[:MAX_URI],
                    status=page.status,
                    duration_ms=int((time.monotonic() - started) * 1000),
                    request_body="",
                    response_body=page.body[:MAX_BODY].decode("utf-8", "replace"),
                )
            )
        except ValueError as err:  # a track or request id Caddy did not set: nothing to record
            log.warning("robots: action not recorded (%s)", err)

    def _shop(self, shop: Path) -> Page:
        """The shop's answer, kept BASE_TTL seconds, or FAIL_TTL when the shop did not answer. The
        fetch runs outside the lock, so a slow twin never makes a real-lane read wait."""
        with self._lock:
            now, kept = self.clock(), self._kept.get(shop)
            if kept is not None and now < kept[0]:
                return kept[1]
        fetched = self._fetch(shop)
        page = fetched or Page(HTTPStatus.BAD_GATEWAY, TEXT, b"")
        with self._lock:
            self._kept[shop] = (now + (BASE_TTL if fetched else FAIL_TTL), page)
        return page

    @staticmethod
    def _fetch(shop: Path) -> Page | None:
        conn = UnixHTTPConnection(shop, timeout=FETCH_TIMEOUT)
        try:
            conn.request("GET", ROBOTS_PATH)
            answer = conn.getresponse()
            body = answer.read(MAX_BASE)
            return Page(answer.status, answer.getheader("Content-Type") or TEXT, body)
        except (OSError, http.client.HTTPException) as err:
            log.warning("robots: %s did not answer (%s)", shop.name, err)
            return None
        finally:
            conn.close()


def identity_of(headers: Message[str, str]) -> str | None:
    """The ip_ua key value mirror.forwarded gives the same client; None without a client IP."""
    ip = headers.get("X-Client-Ip", "")
    return session_key(ip, headers.get("User-Agent", ""))[:MAX_KEY_VALUE] if ip else None


def handler_for(robots: Robots) -> type[BaseHTTPRequestHandler]:
    class RobotsHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"  # Caddy keeps its connections

        def do_GET(self) -> None:
            started = time.monotonic()
            if unquote(self.path.partition("?")[0]) != ROBOTS_PATH:  # Caddy sends nothing else
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            page = robots.page(self.headers)
            self.send_response(page.status)
            self.send_header("Content-Type", page.content_type)
            self.send_header("Cache-Control", "private, no-store")  # one marker per identity
            self.send_header("Content-Length", str(len(page.body)))
            self.end_headers()
            self.wfile.write(page.body)
            robots.report(self.headers, self.path, page, started)

        def log_message(self, format: str, *args: Any) -> None:
            log.debug(format, *args)

    return RobotsHandler
