"""The swarm link must not change what the router decides for traffic that shares no marker.

Every labeled request of the eval data (humans, scanners, the CSIC attacks; both splits) goes
through a plain LaneRouter and through a SwarmLane, at the time the log gives. Each identity has
read its robots.txt first, so every one of them holds a marker. The two routers must take the same
lane for every request and report the same events.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path
from typing import Any

import pytest
from test_mirror_swarm import Harness, build

import mirror.lane
from eval.dataset import SPLITS, load_split
from mirror.contracts import DeceptionEvent
from mirror.forwarded import Forwarded

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "eval" / "data"


def _shape(events: list[DeceptionEvent]) -> Iterator[dict[str, Any]]:
    """Events without what two routers cannot share: the clock reading, and the random track ids,
    which are numbered here in order of first use."""
    order: dict[str, int] = {}
    for event in events:
        fields = asdict(event) | {"type": event.TYPE, "ts": 0}
        fields["track_id"] = order.setdefault(event.track_id, len(order))
        yield fields


@pytest.mark.parametrize("split", SPLITS)
def test_labeled_traffic_takes_the_same_lanes_with_and_without_the_link(
    split: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    requests = load_split(DATA / split).requests
    assert len(requests) > 1000, "the eval data is missing"
    now = [requests[0].ts]
    monkeypatch.setattr(mirror.lane.time, "time", lambda: now[0])
    plain: Harness = build(tmp_path / "plain", swarm=False, clock=lambda: now[0])
    swarm: Harness = build(tmp_path / "swarm", swarm=True, clock=lambda: now[0])
    for identity in {req.session_id for req in requests}:
        swarm.markers.path_for(identity)
    mirrored = 0
    for n, req in enumerate(requests):
        now[0] = req.ts
        fwd = Forwarded(f"req-{n}", req.method, req.path, req.query, req.ip, req.user_agent)
        expected, got = plain.router.decide(fwd), swarm.router.decide(fwd)
        assert got.lane == expected.lane, f"request {n} {req.method} {req.path} by {req.ip}"
        mirrored += got.lane == "mirror"
    assert 0 < mirrored < len(requests), "the data must exercise both lanes"
    assert list(_shape(swarm.events)) == list(_shape(plain.events))
    assert not any("swarm link" in str(getattr(e, "reason", "")) for e in swarm.events)
