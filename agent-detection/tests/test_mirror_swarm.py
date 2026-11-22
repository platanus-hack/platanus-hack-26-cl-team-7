"""mirror.swarm: the marker link between two identities, and what it must leave alone."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from engine.config import load_thresholds
from engine.detector import Detector
from engine.routes import RouteTable
from mirror.contracts import DeceptionEvent, TrackKey, TrackLinked, TrackOpened
from mirror.forwarded import Forwarded
from mirror.keys import Clock, KeyTable
from mirror.lane import REAL, LaneRouter
from mirror.markers import Markers
from mirror.patches import PatchBook
from mirror.swarm import ISSUER_WINDOW, SWARM_REASON, SWITCH_ENV, SwarmLane, enabled, lane_router

REPO = Path(__file__).resolve().parent.parent
SCOUT = ("203.0.113.7", "scout/1.0")
WORKER = ("198.51.100.9", "worker/1.0")
THIRD = ("192.0.2.44", "third/1.0")


class Ticker:
    def __init__(self) -> None:
        self.now = time.time()

    def __call__(self) -> float:
        return self.now


@dataclass
class Harness:
    router: LaneRouter
    markers: Markers
    clock: Ticker
    events: list[DeceptionEvent] = field(default_factory=list)
    copies: list[str] = field(default_factory=list)
    sent: int = 0

    def get(self, who: tuple[str, str], path: str, **more: str) -> str:
        """The lane of one GET by `who`; the track id when it is the mirror."""
        self.sent += 1
        fields = {"request_id": f"req-{self.sent}", "method": "GET", "path": path, "query": ""}
        decision = self.router.decide(Forwarded(**fields, ip=who[0], user_agent=who[1], **more))
        return decision.track_id if decision.lane == "mirror" else decision.lane

    def marker(self, who: tuple[str, str]) -> str:
        """`who` reads its robots.txt (an ordinary request too) and gets its marker."""
        assert self.get(who, "/robots.txt") == "real"
        return self.markers.path_for(key(who).value)

    def linked(self) -> list[tuple[str, str]]:
        return [(e.key.kind, e.key.value) for e in self.events if isinstance(e, TrackLinked)]


def key(who: tuple[str, str]) -> TrackKey:
    return TrackKey("ip_ua", f"{who[0]}|{who[1]}")


def build(tmp_path: Path, *, swarm: bool = True, clock: Clock | None = None) -> Harness:
    ticker = Ticker()
    routes = RouteTable.from_yaml(REPO / "config" / "routes.yaml")
    detector = Detector(routes, load_thresholds(REPO / "config" / "rules.yaml"))
    keys = KeyTable.load(tmp_path / "keys.jsonl", clock=clock or ticker)
    patches = PatchBook.load(tmp_path / "patches.jsonl", routes)
    markers = Markers(b"test-secret", clock=clock or ticker)
    events: list[DeceptionEvent] = []
    copies: list[str] = []
    parts = (detector, keys, patches, events.append, copies.append)
    router = SwarmLane(*parts, markers=markers) if swarm else LaneRouter(*parts)
    return Harness(router, markers, ticker, events, copies)


@pytest.fixture
def lane(tmp_path: Path) -> Harness:
    return build(tmp_path)


def test_reading_robots_and_ordinary_pages_stays_real(lane: Harness) -> None:
    lane.marker(SCOUT)
    assert lane.get(SCOUT, "/products") == "real"
    assert lane.get(WORKER, "/products") == "real"
    assert lane.events == []


def test_asking_for_another_identitys_marker_puts_both_on_one_track(lane: Harness) -> None:
    marker = lane.marker(SCOUT)
    track = lane.get(WORKER, marker, cookie="session=worker-cookie")
    assert track.startswith("trk_")
    opened, linked = lane.events
    assert isinstance(opened, TrackOpened) and isinstance(linked, TrackLinked)
    assert (opened.ip, opened.rule, opened.reason) == (WORKER[0], "R1", SWARM_REASON)
    assert opened.keys == (key(WORKER),)
    assert (linked.track_id, linked.key) == (track, key(SCOUT))
    assert linked.event_id == "track.linked:req-2:marker"
    assert lane.copies == ["session=worker-cookie"]
    assert lane.get(SCOUT, "/products") == track, "the scout is now on the worker's track"
    assert lane.get(WORKER, "/products") == track


def test_asking_for_its_own_marker_links_nothing(lane: Harness) -> None:
    marker = lane.marker(SCOUT)
    assert lane.get(SCOUT, marker) == "real"
    assert lane.get(SCOUT, marker + "notes/") == "real"
    assert lane.events == []


def test_one_address_that_changes_its_user_agent_is_linked(lane: Harness) -> None:
    rotated = (SCOUT[0], "Mozilla/5.0 (rotated)")
    marker = lane.marker(SCOUT)
    track = lane.get(rotated, marker)
    assert track.startswith("trk_")
    assert lane.get(SCOUT, "/") == track


@pytest.mark.parametrize(
    "path", ["/admin-backup-0123456789ab/", "/admin-backup-", "/admin-backup", "/admin"]
)
def test_a_guessed_marker_links_nothing(lane: Harness, path: str) -> None:
    lane.marker(SCOUT)
    assert lane.get(WORKER, path) == "real"
    assert lane.events == []


def test_a_requester_already_on_a_track_brings_the_issuer_to_it(lane: Harness) -> None:
    marker = lane.marker(SCOUT)
    track = lane.get(WORKER, "/.env")
    assert track.startswith("trk_")
    assert lane.get(WORKER, marker) == track
    assert lane.linked() == [("ip_ua", key(SCOUT).value)]
    assert lane.get(SCOUT, "/") == track


def test_a_requester_joins_the_track_the_issuer_is_already_on(lane: Harness) -> None:
    marker = lane.marker(SCOUT)
    track = lane.get(SCOUT, "/.env")
    assert lane.get(WORKER, marker) == track
    opened = [e for e in lane.events if isinstance(e, TrackOpened)]
    assert len(opened) == 1, "no second track"
    assert ("ip_ua", key(WORKER).value) in lane.linked()


def test_two_identities_on_two_tracks_keep_their_tracks(lane: Harness) -> None:
    marker = lane.marker(SCOUT)
    scout_track, worker_track = lane.get(SCOUT, "/.env"), lane.get(WORKER, "/.git/config")
    assert scout_track != worker_track
    before = len(lane.events)
    assert lane.get(WORKER, marker) == worker_track
    assert lane.get(SCOUT, "/") == scout_track, "a track is never taken over"
    assert len(lane.events) == before


def test_three_identities_end_on_one_track(lane: Harness) -> None:
    marker = lane.marker(SCOUT)
    track = lane.get(WORKER, marker)
    assert lane.get(THIRD, marker) == track
    assert {lane.get(who, "/") for who in (SCOUT, WORKER, THIRD)} == {track}


def test_an_old_marker_flags_only_the_one_that_asks(lane: Harness) -> None:
    marker = lane.marker(SCOUT)
    lane.clock.now += ISSUER_WINDOW + 1
    track = lane.get(WORKER, marker)
    assert track.startswith("trk_")
    assert lane.linked() == []
    assert lane.get(SCOUT, "/products") == "real", "an archive may have published the old marker"


def test_reading_robots_again_does_not_reopen_the_window(lane: Harness) -> None:
    marker = lane.marker(SCOUT)
    lane.clock.now += ISSUER_WINDOW + 1
    assert lane.marker(SCOUT) == marker, "a crawler that reads the file again keeps its marker"
    lane.clock.now += 60
    assert lane.get(WORKER, marker).startswith("trk_")
    assert lane.linked() == []
    assert lane.get(SCOUT, "/products") == "real"


def test_a_marker_inside_the_window_links_the_issuer(lane: Harness) -> None:
    marker = lane.marker(SCOUT)
    lane.clock.now += ISSUER_WINDOW
    track = lane.get(WORKER, marker)
    assert lane.get(SCOUT, "/products") == track


def test_a_failed_link_keeps_the_ordinary_decision(
    lane: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = lane.marker(SCOUT)
    track = lane.get(WORKER, "/.env")

    ordinary = lane.router.link

    def broken(track_id: str, linked: TrackKey, request_id: str, part: str = "") -> bool:
        if part == "marker":
            raise OSError("journal is gone")
        return ordinary(track_id, linked, request_id, part)

    monkeypatch.setattr(lane.router, "link", broken)
    assert lane.get(WORKER, marker) == track, "a mirror request never falls back to real"
    assert lane.linked() == [], "the marker link itself did fail"


def test_the_plain_router_ignores_markers(tmp_path: Path) -> None:
    plain = build(tmp_path, swarm=False)
    marker = plain.marker(SCOUT)
    assert plain.get(WORKER, marker) == "real"
    assert plain.events == []


@pytest.mark.parametrize(
    ("value", "on"),
    [(None, True), ("1", True), ("yes", True), ("0", False), ("off", False), (" FALSE ", False)],
)
def test_the_switch_turns_the_link_off(value: str | None, on: bool) -> None:
    env = {} if value is None else {SWITCH_ENV: value}
    assert enabled(env) is on


def test_the_router_is_plain_when_the_switch_is_off(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    parts = build(tmp_path)
    args = (None, parts.router._keys, None, parts.events.append, parts.copies.append)
    monkeypatch.setenv(SWITCH_ENV, "0")
    assert type(lane_router(*args)) is LaneRouter
    monkeypatch.delenv(SWITCH_ENV)
    assert type(lane_router(*args)) is SwarmLane
    assert REAL.lane == "real"
