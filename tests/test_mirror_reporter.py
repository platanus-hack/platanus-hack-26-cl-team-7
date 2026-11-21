"""mirror.reporter: batching, retry with backoff, spool while Sentinel is down, replay, bisect."""

from __future__ import annotations

import http.client
import json
import re
import threading
import time
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from mirror import reporter as r
from mirror.contracts import TrackKey, TrackLinked, event_id, to_wire
from mirror.journal import Journal
from mirror.reporter import SentinelReporter, post_batch

TRACK = "trk_0123456789abcdef"
TS = 1_763_700_000_000
WAIT = 5.0


def linked(n: int) -> TrackLinked:
    key = TrackKey("ip", "203.0.113.7")
    return TrackLinked(event_id("track.linked", f"r{n}"), TRACK, TS + n, key)


def ids(count: int, start: int = 0) -> list[str]:
    return [linked(n).event_id for n in range(start, start + count)]


class FakeSentinel:
    """Takes batches like POST /v1/deception/events. `answers` is consumed first: a status code
    or an exception per call; after that every batch gets 202 unless it holds an invalid id."""

    def __init__(self, *answers: int | Exception) -> None:
        self.answers = list(answers)
        self.calls = 0
        self.batches: list[list[str]] = []
        self.invalid: set[str] = set()

    def __call__(self, batch: list[dict[str, Any]]) -> int:
        self.calls += 1
        if self.answers:
            answer = self.answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer
        names = [event["eventId"] for event in batch]
        if self.invalid & set(names):
            return 422
        self.batches.append(names)
        return 202

    @property
    def received(self) -> list[str]:
        return [name for batch in self.batches for name in batch]


@pytest.fixture
def spool(tmp_path: Path) -> Path:
    return tmp_path / "run" / "mirror-spool.jsonl"


def spooled_ids(path: Path) -> list[str]:
    return [record["eventId"] for record in Journal(path).read()]


def wait_for(check: Callable[[], bool]) -> None:
    deadline = time.monotonic() + WAIT
    while not check():
        assert time.monotonic() < deadline, "condition not met in time"
        time.sleep(0.01)


def test_close_sends_what_is_queued_in_batches_of_at_most_500(spool: Path) -> None:
    sentinel = FakeSentinel()
    reporter = SentinelReporter(sentinel, spool)
    for n in range(1200):
        reporter.emit(linked(n))
    reporter.close()
    assert [len(batch) for batch in sentinel.batches] == [500, 500, 200]
    assert sentinel.received == ids(1200)
    assert not spool.exists()


def test_the_worker_delivers_promptly(spool: Path) -> None:
    sentinel = FakeSentinel()
    reporter = SentinelReporter(sentinel, spool, flush_interval=0.01)
    reporter.start()
    for n in range(3):
        reporter.emit(linked(n))
    wait_for(lambda: len(sentinel.received) == 3)
    reporter.close()
    assert sentinel.received == ids(3)


def test_while_down_events_spool_and_a_restart_replays_the_same_ids(spool: Path) -> None:
    down = FakeSentinel(OSError("refused"), OSError("refused"))
    reporter = SentinelReporter(down, spool)
    for n in range(1200):
        reporter.emit(linked(n))
    reporter.close()
    assert down.calls == 2  # one batch tried, the rest joined the spool, one replay tried
    assert sorted(spooled_ids(spool)) == sorted(ids(1200))
    up = FakeSentinel()
    SentinelReporter(up, spool).close()
    assert sorted(up.received) == sorted(ids(1200))
    assert max(len(batch) for batch in up.batches) == 500
    assert not spool.exists()
    assert not spool.with_name(spool.name + r.SENDING_SUFFIX).exists()


def test_the_worker_retries_with_backoff_until_sentinel_is_back(
    spool: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(r, "BACKOFF_START", 0.02)
    monkeypatch.setattr(r, "BACKOFF_MAX", 0.05)
    failures: list[int | Exception] = [503, OSError("down"), http.client.BadStatusLine("x"), 500]
    sentinel = FakeSentinel(*failures)
    reporter = SentinelReporter(sentinel, spool, flush_interval=0.01)
    reporter.start()
    reporter.emit(linked(0))
    wait_for(lambda: sentinel.received == ids(1))
    reporter.emit(linked(1))
    wait_for(lambda: sentinel.received == ids(2))
    reporter.close()
    waits = re.findall(r"retry in ([\d.]+)s", caplog.text)
    assert waits == ["0.02", "0.04", "0.05", "0.05"]
    assert not spool.exists()


@pytest.mark.parametrize("status", [401, 403, 408, 429, 500, 502])
def test_retryable_statuses_keep_the_events(spool: Path, status: int) -> None:
    sentinel = FakeSentinel(status, status)
    reporter = SentinelReporter(sentinel, spool)
    reporter.emit(linked(0))
    reporter.close()
    assert spooled_ids(spool) == ids(1)


@pytest.mark.parametrize("status", [400, 413, 422])
def test_an_invalid_lone_event_is_dropped(
    spool: Path, status: int, caplog: pytest.LogCaptureFixture
) -> None:
    sentinel = FakeSentinel(status)
    reporter = SentinelReporter(sentinel, spool)
    reporter.emit(linked(0))
    reporter.close()
    assert not spool.exists()
    assert f"sentinel refused {ids(1)[0]} ({status}); dropped" in caplog.text


def test_an_invalid_batch_is_split_until_only_the_bad_event_is_dropped(spool: Path) -> None:
    sentinel = FakeSentinel()
    sentinel.invalid = {linked(7).event_id}
    reporter = SentinelReporter(sentinel, spool)
    for n in range(10):
        reporter.emit(linked(n))
    reporter.close()
    assert sorted(sentinel.received) == sorted(name for name in ids(10) if name != ids(8)[7])
    assert not spool.exists()


def test_a_full_queue_spills_to_the_spool_and_loses_nothing(spool: Path) -> None:
    sentinel = FakeSentinel()
    reporter = SentinelReporter(sentinel, spool, queue_max=2)
    for n in range(5):
        reporter.emit(linked(n))
    assert spooled_ids(spool) == ids(3, start=2)
    reporter.close()
    assert sorted(sentinel.received) == sorted(ids(5))


def test_a_replay_that_fails_midway_keeps_only_the_rest(spool: Path) -> None:
    sending = Journal(spool.with_name(spool.name + r.SENDING_SUFFIX))
    sending.append([to_wire(linked(n)) for n in range(1200)])
    sending.append([{"type": "track.closed", "eventId": "x"}])
    sending.close()
    sentinel = FakeSentinel(202, OSError("down"))
    SentinelReporter(sentinel, spool).close()
    assert spooled_ids(sending.path) == ids(700, start=500)
    again = FakeSentinel()
    SentinelReporter(again, spool).close()
    assert again.received == ids(700, start=500)
    assert not sending.exists()


def test_emit_never_blocks_on_a_slow_sentinel(spool: Path) -> None:
    release = threading.Event()
    calls: list[int] = []

    def slow(batch: list[dict[str, Any]]) -> int:
        calls.append(len(batch))
        release.wait(WAIT)
        return 202

    reporter = SentinelReporter(slow, spool, flush_interval=0.01)
    reporter.start()
    reporter.emit(linked(0))
    wait_for(lambda: calls == [1])
    started = time.perf_counter()
    for n in range(1, 2001):
        reporter.emit(linked(n))
    assert time.perf_counter() - started < 0.5
    release.set()
    reporter.close()


class _Ingest(BaseHTTPRequestHandler):
    seen: list[tuple[str, str | None, list[dict[str, Any]]]] = []
    status = 202

    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).seen.append((self.path, self.headers["Authorization"], body))
        self.send_response(type(self).status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        return None


@pytest.fixture
def ingest() -> Iterator[str]:
    _Ingest.seen, _Ingest.status = [], 202
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Ingest)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()
    thread.join()


def test_post_batch_sends_the_bearer_token_and_json(ingest: str) -> None:
    batch = [to_wire(linked(0))]
    assert post_batch(ingest + r.EVENTS_PATH, "tok-1", batch) == 202
    _Ingest.status = 503
    assert post_batch(ingest + r.EVENTS_PATH, "tok-1", batch) == 503
    assert _Ingest.seen[0] == (r.EVENTS_PATH, "Bearer tok-1", batch)


def test_post_batch_refuses_a_non_http_url() -> None:
    with pytest.raises(http.client.InvalidURL):
        post_batch("ftp://127.0.0.1/v1/deception/events", "tok", [])


def test_to_sentinel_posts_to_the_events_path(ingest: str, spool: Path) -> None:
    reporter = SentinelReporter.to_sentinel(ingest + "/", "tok-2", spool)
    reporter.emit(linked(0))
    reporter.close()
    assert [(path, auth) for path, auth, _ in _Ingest.seen] == [(r.EVENTS_PATH, "Bearer tok-2")]
