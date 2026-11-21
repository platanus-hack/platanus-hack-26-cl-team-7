"""The lane decision behind Caddy's forward_auth: GET /lane on run/lane.sock.

Caddy forwards the client's method and URI, its IP (X-Client-Ip, set from {remote_host}),
User-Agent, Cookie, Authorization and request id (X-Request-Id, set from {http.request.uuid}).
The lane runs the engine Detector on that request, as a library with the same rules, then picks:

1. a bound key, first a twin-born value in Cookie, Authorization or a query value, then IP +
   User-Agent, then IP: mirror, on that key's track; the request's own keys still unbound link
   to it (the IP only on an R3 critical verdict);
2. a verdict, or else a virtual patch: mirror, on a new track bound to IP + User-Agent (and the
   IP on an R3 critical verdict). The trigger request itself is mirrored, so a session cookie it
   carries is copied to the twin (POST /copy on run/sync.sock) before the answer;
3. else real.

The answer is always 200 with X-Lane and X-Track-Id (empty on real). Any failure answers real:
Caddy never sees an error from the lane, and a dead router fails open the same way.
"""

from __future__ import annotations

import http.client
import json
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from email.message import Message
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

from engine.detector import Detector
from engine.models import Request, RuleId, Verdict
from mirror.contracts import (
    MAX_TEXT,
    DeceptionEvent,
    Lane,
    TrackKey,
    TrackLinked,
    TrackOpened,
    event_id,
    new_track_id,
)
from mirror.forwarded import Forwarded
from mirror.keys import KeyTable
from mirror.patches import PatchBook
from mirror.sockets import UnixHTTPConnection

LANE_HEADER = "X-Lane"
TRACK_HEADER = "X-Track-Id"
COPY_PATH = "/copy"
COPY_TIMEOUT = 0.5

Emit = Callable[[DeceptionEvent], None]
Copy = Callable[[str], None]

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Decision:
    lane: Lane
    track_id: str = ""


REAL = Decision("real")


class LaneRouter:
    """Decides the lane for each forwarded request. Safe to call from many threads."""

    def __init__(
        self, detector: Detector, keys: KeyTable, patches: PatchBook, emit: Emit, copy: Copy
    ) -> None:
        self._detector, self._keys, self._patches = detector, keys, patches
        self._emit, self._copy = emit, copy
        self._lock = threading.Lock()  # the Detector is not thread-safe; one decision at a time

    def answer(self, headers: Message[str, str]) -> Decision:
        try:
            fwd = Forwarded.from_headers(headers)
        except ValueError as err:
            log.warning("lane: bad forwarded request (%s); real", err)
            return REAL
        try:
            return self.decide(fwd)
        except Exception:
            log.exception("lane: decision failed; real")
            return REAL

    def decide(self, fwd: Forwarded) -> Decision:
        now = time.time()
        with self._lock:
            req = Request(now, fwd.ip, fwd.user_agent, fwd.method, fwd.path, fwd.query)
            verdicts = self._detector.process(req)
            own = [fwd.ip_ua_key] + ([fwd.ip_key] if any(v.critical for v in verdicts) else [])
            hit = self._keys.find([*fwd.twin_born_keys(), fwd.ip_ua_key, fwd.ip_key])
            if hit is not None:
                for key in own:
                    self.link(hit[0], key, fwd.request_id)
                return Decision("mirror", hit[0])
            cause = _verdict_cause(verdicts) or self._patch_cause(fwd)
            if cause is None:
                return REAL
            track_id = new_track_id()
            for key in own:
                self._keys.bind(key, track_id)
            self._emit(_opened(fwd, track_id, cause, tuple(own), now))
        if fwd.cookie:
            self._copy(fwd.cookie)
        return Decision("mirror", track_id)

    def link(self, track_id: str, key: TrackKey, request_id: str, part: str = "") -> bool:
        """Bind `key` to the track and report track.linked; False when it was already bound."""
        if not self._keys.bind(key, track_id):
            return False
        self._emit(
            TrackLinked(
                event_id=event_id("track.linked", request_id, part or key.kind),
                track_id=track_id,
                ts=_ms(time.time()),
                key=key,
            )
        )
        return True

    def _patch_cause(self, fwd: Forwarded) -> tuple[RuleId, str] | None:
        patch = self._patches.match(fwd.method, fwd.path, fwd.query)
        if patch is None:
            return None
        target = patch.signature or f"{patch.method} {patch.endpoint}"
        return patch.rule, f"virtual patch {patch.finding_id}: {target}"


def handler_for(router: LaneRouter) -> type[BaseHTTPRequestHandler]:
    class LaneHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"  # Caddy keeps the connection for the next forward_auth

        def do_GET(self) -> None:
            decision = router.answer(self.headers)
            self.send_response(HTTPStatus.OK)
            self.send_header(LANE_HEADER, decision.lane)
            self.send_header(TRACK_HEADER, decision.track_id)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, format: str, *args: Any) -> None:
            log.debug(format, *args)

    return LaneHandler


def copy_session(sync_socket: Path, cookie: str, timeout: float = COPY_TIMEOUT) -> None:
    """Ask the sync service to copy the session `cookie` names, and its own account, to the twin.
    A failure is logged: the track stays mirrored, the twin just lacks that session."""
    connection = UnixHTTPConnection(sync_socket, timeout)
    body = json.dumps({"cookie": cookie}).encode()
    try:
        connection.request("POST", COPY_PATH, body, {"Content-Type": "application/json"})
        response = connection.getresponse()
        response.read()
        if response.status >= HTTPStatus.MULTIPLE_CHOICES:
            log.warning("copy on flag: sync answered %d", response.status)
    except (OSError, http.client.HTTPException) as err:
        log.warning("copy on flag failed: %s", err)
    finally:
        connection.close()


def _verdict_cause(verdicts: list[Verdict]) -> tuple[RuleId, str] | None:
    if not verdicts:
        return None
    first = max(verdicts, key=lambda verdict: verdict.critical)  # a critical one, if any
    return first.rule, first.reason


def _opened(
    fwd: Forwarded, track_id: str, cause: tuple[RuleId, str], keys: tuple[TrackKey, ...], now: float
) -> TrackOpened:
    rule, reason = cause
    return TrackOpened(
        event_id=event_id("track.opened", fwd.request_id),
        track_id=track_id,
        ts=_ms(now),
        ip=fwd.ip,
        user_agent=fwd.user_agent[:MAX_TEXT],
        rule=rule,
        reason=reason[:MAX_TEXT],
        keys=keys,
    )


def _ms(seconds: float) -> int:
    return int(seconds * 1000)
