"""mirror.reporter: a batch is cut to what Sentinel's body limit takes. Sentinel closes the
connection on a body over its limit (no 413 reaches the router), so a batch of escaped non-ASCII
text must be split before the send, and an event no body can carry is dropped, counted and logged,
not replayed forever."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from mirror import post
from mirror import reporter as r
from mirror.contracts import MAX_BATCH, MAX_BODY, TrackAction, event_id, to_wire
from mirror.journal import Journal
from mirror.post import SENTINEL_BODY_LIMIT, by_size, wire_size
from mirror.reporter import SentinelReporter
from tests.test_mirror_reporter import linked, spooled_ids, wait_for

REPO = Path(__file__).resolve().parent.parent
TRACK = "trk_0123456789abcdef"
SENDING = ".sending"


def action(n: int, text: str = "界") -> TrackAction:
    """A track action with both bodies full; each CJK character escapes to 6 bytes of JSON."""
    body = text * MAX_BODY
    ident, ts = event_id("track.action", f"r{n}"), 1_763_700_000_000 + n
    return TrackAction(ident, TRACK, ts, "POST", "/account", "", 200, 1, body, body)


class SizeLimitedSentinel:
    """Takes a batch like Sentinel: over the body limit it drops the connection, as Hono does."""

    def __init__(self) -> None:
        self.sizes: list[int] = []
        self.received: list[str] = []

    def __call__(self, batch: list[dict[str, Any]]) -> int:
        size = len(json.dumps(batch))
        if size > SENTINEL_BODY_LIMIT:
            raise BrokenPipeError(32, "Broken pipe")
        self.sizes.append(size)
        self.received += [wire["eventId"] for wire in batch]
        return 202


def test_the_limit_matches_the_one_sentinel_enforces() -> None:
    source = (REPO.parent / "apps/sentinel/src/deception-routes.ts").read_text(encoding="utf-8")
    found = re.search(r"MAX_BODY_BYTES = (\d+) \* 1024 \* 1024", source)
    assert found is not None
    assert int(found.group(1)) * 1024 * 1024 == SENTINEL_BODY_LIMIT


def test_events_that_escape_large_are_split_so_sentinel_gets_every_one(tmp_path: Path) -> None:
    sentinel = SizeLimitedSentinel()
    reporter = SentinelReporter(sentinel, tmp_path / "spool.jsonl")
    for n in range(200):  # about 20 MB of JSON in one queue batch, over the 16 MB limit
        reporter.emit(action(n))
    reporter.close()
    assert sentinel.received == [event_id("track.action", f"r{n}") for n in range(200)]
    assert len(sentinel.sizes) >= 3 and max(sentinel.sizes) <= post.MAX_BATCH_BYTES
    assert not (tmp_path / "spool.jsonl").exists()
    assert reporter.dropped == 0


def test_a_spool_of_large_events_is_replayed_in_parts_and_cleared(tmp_path: Path) -> None:
    spool = tmp_path / "spool.jsonl"
    held = Journal(spool.with_name(spool.name + SENDING))
    held.append([to_wire(action(n)) for n in range(200)])
    held.close()
    sentinel = SizeLimitedSentinel()
    SentinelReporter(sentinel, spool).close()
    assert len(sentinel.received) == 200 and max(sentinel.sizes) <= post.MAX_BATCH_BYTES
    assert spooled_ids(spool) == []


def test_an_event_no_body_can_carry_is_dropped_counted_and_never_retried(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(r, "MAX_BATCH_BYTES", 50_000)
    sentinel = SizeLimitedSentinel()
    reporter = SentinelReporter(sentinel, tmp_path / "spool.jsonl", flush_interval=0.01)
    reporter.start()
    reporter.emit(action(0))
    reporter.emit(linked(1))
    wait_for(lambda: sentinel.received == [linked(1).event_id])
    reporter.close()
    assert reporter.dropped == 1
    assert f"{event_id('track.action', 'r0')} is over 50000 bytes; dropped" in caplog.text
    assert spooled_ids(tmp_path / "spool.jsonl") == []


def test_an_oversized_event_found_in_a_replay_is_dropped_too(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(r, "MAX_BATCH_BYTES", 50_000)
    spool = tmp_path / "spool.jsonl"
    held = Journal(spool)
    held.append([to_wire(action(0)), to_wire(linked(1))])
    held.close()
    sentinel = SizeLimitedSentinel()
    reporter = SentinelReporter(sentinel, spool)
    reporter.close()
    assert sentinel.received == [linked(1).event_id] and reporter.dropped == 1
    assert spooled_ids(spool) == []


def test_by_size_keeps_order_and_bounds_count_and_bytes() -> None:
    events = [to_wire(linked(n)) for n in range(1200)]
    parts = list(by_size(events, post.MAX_BATCH_BYTES))
    assert [len(part) for part in parts] == [MAX_BATCH, MAX_BATCH, 200]
    assert [wire for part in parts for wire in part] == events
    each = wire_size(events[0])
    sized = list(by_size(events[:10], 3 * each))
    assert [len(part) for part in sized] == [3, 3, 3, 1]
    big = to_wire(action(0))
    assert [len(part) for part in by_size([events[0], big, events[1]], 1000)] == [1, 1, 1]
    assert list(by_size([], 1000)) == []
