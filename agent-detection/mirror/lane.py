"""The lane decision behind Caddy's forward_auth: GET /lane on run/lane.sock.

Caddy forwards the client's method and URI, IP (X-Client-Ip, from {remote_host}), User-Agent,
Cookie, Authorization and request id (X-Request-Id, from {http.request.uuid}). The lane runs the
engine Detector on that request, as a library with the same rules, then picks:

1. a bound key (a twin-born value in Cookie, Authorization or the query, then IP + User-Agent,
   then IP): mirror on that key's track, and the request's own keys link to it;
2. a verdict, or else a virtual patch: mirror on a new track bound to the own keys. The trigger
   request itself is mirrored, so its session (the Cookie header, else a Bearer token) is copied
   to the twin before the answer (mirror.session_copy). A client with no bound key starts over:
   the Detector rearms its session, so a client whose keys expired can be flagged again;
3. else real.

The own keys are IP + User-Agent, and the IP on an R3 critical verdict. The answer is always 200
with X-Lane and X-Track-Id (empty on real); any failure answers real, as a dead router fails open.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from email.message import Message
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
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
from mirror.patches import Patch, PatchBook

LANE_HEADER = "X-Lane"
TRACK_HEADER = "X-Track-Id"

Emit = Callable[[DeceptionEvent], None]
Copy = Callable[[str], None]
Cause = tuple[RuleId, str]  # the rule and reason a track opens with

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Decision:
    lane: Lane
    track_id: str = ""
    opened: bool = False  # this request opened the track


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
        req = Request(time.time(), fwd.ip, fwd.user_agent, fwd.method, fwd.path, fwd.query)
        known = [*fwd.twin_born_keys(), fwd.ip_ua_key, fwd.ip_key]
        with self._lock:
            hit = self._keys.find(known)
            if hit is None:  # no live track: a rule this client fired before may fire again
                self._detector.rearm(req.session_id)
            verdicts = self._detector.process(req)
            own = [fwd.ip_ua_key] + ([fwd.ip_key] if any(v.critical for v in verdicts) else [])
            if hit is not None:
                return self._join(hit[0], own, fwd.request_id)
            patch = self._patches.match(fwd.method, fwd.path, fwd.query)
            cause = _verdict_cause(verdicts) or patch_cause(patch)
            if cause is None:
                return REAL
            decision = self._start(fwd, cause, own)
        return self._copied(fwd, decision)

    def open(self, fwd: Forwarded, cause: Cause, own: list[TrackKey]) -> Decision:
        """Mirror on a new track bound to the `own` keys, as a verdict does: report track.opened
        and copy the session to the twin. The tap calls it for a login body a patch covers."""
        return self._copied(fwd, self._start(fwd, cause, own))

    def follow(
        self, known: list[TrackKey], own: list[TrackKey], request_id: str
    ) -> Decision | None:
        """Mirror on the track of the first bound key in `known`, linking the request's `own` keys
        to it; None when none is bound. The tap calls it for a login with a twin-born username."""
        hit = self._keys.find(known)
        return None if hit is None else self._join(hit[0], own, request_id)

    def _join(self, track_id: str, own: list[TrackKey], request_id: str) -> Decision:
        for key in own:
            self.link(track_id, key, request_id)
        return Decision("mirror", track_id)

    def link(self, track_id: str, key: TrackKey, request_id: str, part: str = "") -> bool:
        """Bind `key` to the track and report track.linked; False when it was already bound."""
        if not self._keys.bind(key, track_id):
            return False
        linked = event_id("track.linked", request_id, part or key.kind)
        self._emit(TrackLinked(event_id=linked, track_id=track_id, ts=_ms(time.time()), key=key))
        return True

    def _start(self, fwd: Forwarded, cause: Cause, own: list[TrackKey]) -> Decision:
        """Bind the `own` keys to a new track and report it; when another request bound the first
        key meanwhile, follow that track instead. A track is never taken over."""
        track_id = new_track_id()
        if not self._keys.bind(own[0], track_id):
            return self.follow(own[:1], own[1:], fwd.request_id) or REAL
        for key in own[1:]:
            self._keys.bind(key, track_id)
        self._emit(_opened(fwd, track_id, cause, tuple(own)))
        return Decision("mirror", track_id, opened=True)

    def _copied(self, fwd: Forwarded, decision: Decision) -> Decision:
        """Copy a new track's session to the twin, outside the lane lock: it can take a while."""
        if decision.opened and fwd.session:
            self._copy(fwd.session)
        return decision


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


def _verdict_cause(verdicts: list[Verdict]) -> Cause | None:
    if not verdicts:
        return None
    first = max(verdicts, key=lambda verdict: verdict.critical)  # a critical one, if any
    return first.rule, first.reason


def patch_cause(patch: Patch | None) -> Cause | None:
    if patch is None:
        return None
    target = patch.signature or f"{patch.method} {patch.endpoint}"
    return patch.rule, f"virtual patch {patch.finding_id}: {target}"


def _opened(fwd: Forwarded, track_id: str, cause: Cause, keys: tuple[TrackKey, ...]) -> TrackOpened:
    rule, reason = cause
    return TrackOpened(
        event_id=event_id("track.opened", fwd.request_id),
        track_id=track_id,
        ts=_ms(time.time()),
        ip=fwd.ip,
        user_agent=fwd.user_agent[:MAX_TEXT],
        rule=rule,
        reason=reason[:MAX_TEXT],
        keys=keys,
    )


def _ms(seconds: float) -> int:
    return int(seconds * 1000)
