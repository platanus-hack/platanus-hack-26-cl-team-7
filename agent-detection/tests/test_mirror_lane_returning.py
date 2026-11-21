"""mirror.lane: a client flagged before, whose keys expired, is flagged again when it returns.

The Detector keeps one verdict per (session, rule) for its whole life. The lane rearms a client
with no bound key, so that rule can open a new track; a client with a live track gets no new
verdict, so a live track never opens a second one.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from mirror import lane as lane_module
from mirror.contracts import TrackOpened
from mirror.keys import HOUR
from tests.test_mirror_lane import Harness, build, fwd


class Clock:
    """The time the lane and its key table read, moved by hand."""

    def __init__(self) -> None:
        self.now = 1_763_700_000.0

    def __call__(self) -> float:
        return self.now

    def later(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    clock = Clock()
    monkeypatch.setattr(lane_module, "time", SimpleNamespace(time=clock))
    return clock


@pytest.fixture
def lane(tmp_path: Path, clock: Clock) -> Harness:
    return build(tmp_path, clock=clock)


def opened(lane: Harness) -> list[TrackOpened]:
    return [event for event in lane.events if isinstance(event, TrackOpened)]


def test_a_critical_client_back_after_a_day_opens_a_new_track_at_once(
    lane: Harness, clock: Clock
) -> None:
    first = lane.router.decide(fwd("/.env"))
    clock.later(25 * HOUR)  # the ip key (1 h) and the ip + User-Agent key (24 h) are gone
    assert lane.keys.find([fwd().ip_ua_key, fwd().ip_key]) is None
    again = lane.router.decide(fwd("/search?q=%27+OR+1%3D1+--", n=1))
    assert (again.lane, again.opened) == ("mirror", True)
    assert again.track_id != first.track_id
    assert [event.track_id for event in opened(lane)] == [first.track_id, again.track_id]
    assert lane.router.decide(fwd("/products", n=2)).track_id == again.track_id
    clock.later(25 * HOUR)
    assert lane.router.decide(fwd("/.env", n=3)).opened is True  # and so on, every time


def test_a_noisy_client_back_after_a_day_trips_the_same_rule_again(
    lane: Harness, clock: Clock
) -> None:
    def probe(start: int) -> list[str]:
        return [lane.router.decide(fwd(f"/nope-{n}", n=n)).lane for n in range(start, start + 5)]

    assert probe(0) == ["real"] * 4 + ["mirror"]
    clock.later(25 * HOUR)
    assert probe(10) == ["real"] * 4 + ["mirror"]
    assert [event.rule for event in opened(lane)] == ["R1", "R1"]


def test_a_live_track_opens_no_second_track_however_often_the_rule_fires(
    lane: Harness, clock: Clock
) -> None:
    track = lane.router.decide(fwd("/.env")).track_id
    for n in range(1, 40):
        clock.later(2 * HOUR)  # the ip_ua key (24 h) stays alive, the ip key (1 h) does not
        decision = lane.router.decide(fwd("/.env", n=n))
        assert (decision.track_id, decision.opened) == (track, False)
    assert [event.track_id for event in opened(lane)] == [track]


def test_a_client_without_a_track_that_stays_clean_gets_no_track(
    lane: Harness, clock: Clock
) -> None:
    for n in range(30):
        clock.later(2 * HOUR)
        assert lane.router.decide(fwd("/products", n=n)).lane == "real"
    assert lane.events == []
