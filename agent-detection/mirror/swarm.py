"""The swarm link: two identities that share one marker are one attacker.

SwarmLane is the LaneRouter with one more step. It takes the ordinary decision first, unchanged.
Then, only when the request asks for a marker that another identity was given (mirror.markers),
it links the two:

- the requester goes to the mirror: on its own track if it has one, else on the issuer's track,
  else on a new track opened with rule R1 (a marker is outside the route list) and SWARM_REASON;
- the issuer joins that track when it first read its robots.txt at most ISSUER_WINDOW seconds
  ago. An older marker may have travelled another way (a public robots.txt archive, a crawler
  that reads the file every day), so then only the requester is flagged.

So a request without another identity's marker gets exactly the LaneRouter's decision and events,
and the link can only move a request from real to mirror, never back. An identity that asks for
its own marker is not linked: that is one client ignoring robots.txt, which the rules judge.

The robots listener (run/robots.sock, beside the lane socket; mirror.robots) gives each identity
its marker. MIRROR_SWARM_LINK=0 turns the link off: the router is then the plain LaneRouter and
robots.txt is the shop's own.
"""

from __future__ import annotations

import logging
import os
import socketserver
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from mirror.contracts import TrackKey
from mirror.forwarded import Forwarded
from mirror.lane import Cause, Decision, LaneRouter
from mirror.markers import Markers
from mirror.robots import Robots, handler_for
from mirror.sockets import UnixHTTPServer

if TYPE_CHECKING:
    from mirror.cli import Router

SWITCH_ENV = "MIRROR_SWARM_LINK"
OFF = frozenset({"0", "false", "no", "off"})
ROBOTS_SOCKET = "robots.sock"
ISSUER_WINDOW = 3600.0
SWARM_REASON = "swarm link: asked for a decoy path that only another identity was given"
SWARM_CAUSE: Cause = ("R1", SWARM_REASON)
MARKER_PART = "marker"

log = logging.getLogger(__name__)


def enabled(env: Mapping[str, str] | None = None) -> bool:
    value = (os.environ if env is None else env).get(SWITCH_ENV, "1")
    return value.strip().lower() not in OFF


class SwarmLane(LaneRouter):
    """A LaneRouter that also links identities by marker. Safe to call from many threads."""

    def __init__(self, *parts: Any, markers: Markers) -> None:
        super().__init__(*parts)
        self.markers = markers

    def decide(self, fwd: Forwarded) -> Decision:
        decision = super().decide(fwd)
        issued = self.markers.issued(fwd.path)
        if issued is None or issued.identity == fwd.ip_ua_key.value:
            return decision
        issuer = TrackKey("ip_ua", issued.identity) if issued.age <= ISSUER_WINDOW else None
        try:
            return self._linked(fwd, issuer, decision)
        except Exception:  # a failed link must never undo the ordinary decision
            log.exception("swarm: link for %s failed; ordinary decision kept", fwd.request_id)
            return decision

    def _linked(self, fwd: Forwarded, issuer: TrackKey | None, decision: Decision) -> Decision:
        own = [fwd.ip_ua_key]
        if decision.lane != "mirror" and issuer is not None:
            decision = self.follow([issuer], own, fwd.request_id) or decision
        if decision.lane != "mirror":
            decision = self.open(fwd, SWARM_CAUSE, own)
        if decision.track_id and issuer is not None:
            self.link(decision.track_id, issuer, fwd.request_id, MARKER_PART)
        return decision


def robots_listener(router: Router) -> socketserver.BaseServer:
    """The robots.txt listener beside the lane socket; it marks only when the lane links."""
    lane, config = router.lane, router.config
    markers = lane.markers if isinstance(lane, SwarmLane) else None
    robots = Robots(config.real, config.twin, markers, router.reporter.emit)
    return UnixHTTPServer(config.lane.with_name(ROBOTS_SOCKET), handler_for(robots))


def lane_router(*parts: Any) -> LaneRouter:
    """The router's lane: with the swarm link unless MIRROR_SWARM_LINK turns it off."""
    return SwarmLane(*parts, markers=Markers()) if enabled() else LaneRouter(*parts)
