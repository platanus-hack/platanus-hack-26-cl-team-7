"""The tap on run/tap.sock: Caddy's upstream for every mirror-lane request and every login POST.

Caddy has set X-Lane and X-Track-Id from the lane endpoint, and X-Client-Ip and X-Request-Id.
Per request the tap reads the body (mirror.proxy.read_body), then:

- on the real lane, a login POST may move to the mirror lane (mirror.logins). Every other request
  goes to run/real.sock as it came, and is not recorded;
- on the mirror lane, it grants the callback relay one egress to a host the request names, then
  proxies to run/twin.sock (mirror.proxy: status, headers and body bytes as the twin sent them).

After a twin answer the tap reports one track.action (bodies cut at MAX_BODY), binds the answer's
twin-born values to the track (mirror.exchange) and runs the finding rules (mirror.findings).
"""

from __future__ import annotations

import logging
import re
import socketserver
import time
import uuid
from dataclasses import dataclass
from email.message import Message
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import TYPE_CHECKING, Any

from mirror.canaries import Canaries
from mirror.contracts import ID_HEX, MAX_BODY, MAX_URI, TRACK_PREFIX, TrackAction, event_id
from mirror.egress import Grants
from mirror.exchange import Exchange, named_hosts, twin_born_values
from mirror.findings import FindingRules, NotFoundSize
from mirror.keys import twin_born_key
from mirror.lane import LANE_HEADER, TRACK_HEADER, Emit, LaneRouter
from mirror.logins import Logins
from mirror.proxy import forward, read_body
from mirror.sockets import UnixHTTPServer

if TYPE_CHECKING:
    from mirror.cli import Router

MIRROR = "mirror"
TWIN_BORN_PART = "twin_born"
_TRACK_ID = re.compile(rf"{TRACK_PREFIX}[0-9a-f]{{{ID_HEX}}}")

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Tap:
    lane: LaneRouter
    logins: Logins
    grants: Grants
    findings: FindingRules
    emit: Emit
    real: Path
    twin: Path

    def serve(self, handler: BaseHTTPRequestHandler) -> None:
        started, ts = time.monotonic(), int(time.time() * 1000)
        try:
            body = read_body(handler)
        except ValueError as err:
            log.warning("tap: unreadable body (%s)", err)
            handler.close_connection = True
            handler.send_error(HTTPStatus.BAD_REQUEST)
            return
        headers = handler.headers
        request_id = _request_id(headers.get("X-Request-Id", ""))
        path, _, query = handler.path.partition("?")
        mirror = headers.get(LANE_HEADER) == MIRROR
        if mirror:  # a mirror request without a usable track id goes to the twin unrecorded
            track = headers.get(TRACK_HEADER, "")
            track = track if _TRACK_ID.fullmatch(track) else ""
        else:
            track = self._login_track(handler.command, path, headers, body.head, request_id)
            mirror = bool(track)
        if track:
            self.grants.grant(track, request_id, named_hosts(query, body.head))
        try:
            answer = forward(handler, self.twin if mirror else self.real, body)
        finally:
            self.grants.revoke(request_id)
        if not track or answer is None:
            return
        exchange = Exchange(
            track_id=track,
            request_id=request_id,
            method=handler.command,
            path=path or "/",
            query=query,
            content_type=headers.get("Content-Type", ""),
            request_body=body.head,
            credentials=f"{headers.get('Cookie', '')}\n{headers.get('Authorization', '')}",
            status=answer.status,
            response_type=answer.content_type,
            response_body=answer.kept,
            response_size=answer.size,
            set_cookies=answer.set_cookies,
        )
        try:
            self._record(exchange, ts, int((time.monotonic() - started) * 1000))
        except Exception:  # the answer is out; a recording failure must not break the connection
            log.exception("tap: recording %s failed", request_id)

    def _login_track(
        self, method: str, path: str, headers: Message[str, str], body: bytes, request_id: str
    ) -> str:
        """The mirror track a real-lane request moves to; any failure keeps it real, as the lane
        endpoint answers real on any failure."""
        try:
            return self.logins.track_of(method, path, headers, body, request_id)
        except Exception:
            log.exception("tap: login lane for %s failed; real", request_id)
            return ""

    def _record(self, ex: Exchange, ts: int, duration_ms: int) -> None:
        self.emit(
            TrackAction(
                event_id=event_id("track.action", ex.request_id),
                track_id=ex.track_id,
                ts=ts,
                method=ex.method,
                path=ex.path[:MAX_URI],
                query=ex.query[:MAX_URI],
                status=ex.status,
                duration_ms=duration_ms,
                request_body=ex.request_body[:MAX_BODY].decode("utf-8", "replace"),
                response_body=ex.response_body[:MAX_BODY].decode("utf-8", "replace"),
            )
        )
        for n, value in enumerate(twin_born_values(ex)):
            key = twin_born_key(value)
            if key is not None:
                self.lane.link(ex.track_id, key, ex.request_id, f"{TWIN_BORN_PART}-{n}")
        self.findings.check(ex)


def _request_id(raw: str) -> str:
    """Caddy's request id, which the lane's events carry too; a fresh one if it is unusable."""
    try:
        event_id("track.action", raw)
    except ValueError:
        return uuid.uuid4().hex
    return raw


def handler_for(tap: Tap) -> type[BaseHTTPRequestHandler]:
    class TapHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"  # Caddy keeps its connections to the tap

        def do_GET(self) -> None:
            tap.serve(self)

        do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_GET

        def log_message(self, format: str, *args: Any) -> None:
            log.debug(format, *args)

    return TapHandler


def tap_listener(router: Router) -> socketserver.BaseServer:
    config, emit = router.config, router.reporter.emit
    logins = Logins(router.lane, router.patches)
    not_found = NotFoundSize(config.twin)
    rules = FindingRules(Canaries(config.canaries), router.routes, router.patches, emit, not_found)
    tap = Tap(router.lane, logins, router.grants, rules, emit, config.real, config.twin)
    return UnixHTTPServer(config.tap, handler_for(tap))
