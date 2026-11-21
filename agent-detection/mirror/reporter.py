"""Sends deception events to Sentinel (POST /v1/deception/events) without ever blocking a caller.

emit() queues an event, or spools it when the bounded queue is full. One worker sends a batch of
at most MAX_BATCH events per FLUSH_INTERVAL: a first event and what follows it in the interval.
A batch with no answer or a status outside 2xx and INVALID is spooled (run/mirror-spool.jsonl),
later batches join it, and the worker backs off (BACKOFF_START doubling up to BACKOFF_MAX), then
replays the spool with the same eventIds, so Sentinel counts a resent event as a duplicate; a crash
mid-replay keeps the rest. Past spool_max bytes, new events are lost and counted in `dropped`, so
an outage cannot fill the disk. An INVALID batch is halved until the bad event alone is dropped.
A batch is also cut to MAX_BATCH_BYTES of body (mirror.post), since an oversized body never gets
a 413; a single event over that is dropped and counted too, never retried.
"""

from __future__ import annotations

import contextlib
import logging
import queue
import threading
import time
from collections.abc import Callable
from functools import partial
from http.client import HTTPException
from pathlib import Path

from mirror.contracts import MAX_BATCH, DeceptionEvent, from_wire, to_wire
from mirror.journal import Journal
from mirror.post import MAX_BATCH_BYTES, Wire, by_size, post_batch, wire_size

EVENTS_PATH = "/v1/deception/events"
QUEUE_MAX = 10_000
FLUSH_INTERVAL = 0.25
BACKOFF_START = 0.25
BACKOFF_MAX = 30.0
CLOSE_TIMEOUT = 5.0
SPOOL_MAX_BYTES = 64 * 1024 * 1024  # about 4,000 track actions with both 8 KB bodies full
INVALID = frozenset({400, 413, 422})
SENDING_SUFFIX = ".sending"

Post = Callable[[list[Wire]], int]  # HTTP status; raises OSError or HTTPException on no answer

log = logging.getLogger(__name__)


class SentinelReporter:
    def __init__(
        self,
        post: Post,
        spool: str | Path,
        *,
        queue_max: int = QUEUE_MAX,
        flush_interval: float = FLUSH_INTERVAL,
        spool_max: int = SPOOL_MAX_BYTES,
    ) -> None:
        self._post, self._flush_interval = post, flush_interval
        self._queue: queue.Queue[DeceptionEvent] = queue.Queue(queue_max)
        self._spool, self._sending = Journal(spool), Journal(f"{spool}{SENDING_SUFFIX}")
        self._spool_max, self._spool_full, self._spill_lock = spool_max, False, threading.Lock()
        self.dropped, self._backoff, self._retry_at = 0, 0.0, 0.0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="mirror-reporter", daemon=True)

    @classmethod
    def to_sentinel(cls, sentinel: str, token: str, spool: str | Path) -> SentinelReporter:
        return cls(partial(post_batch, sentinel.rstrip("/") + EVENTS_PATH, token), spool)

    def start(self) -> None:
        self._thread.start()

    def emit(self, event: DeceptionEvent) -> None:
        try:
            self._queue.put_nowait(event)
        except queue.Full:
            self._spill([to_wire(event)])

    def close(self, timeout: float = CLOSE_TIMEOUT) -> None:
        """Stop the worker after one last send of what is queued; what fails stays spooled."""
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout)
        else:
            self._cycle(final=True)
        self._spool.close()
        self._sending.close()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self._cycle(final=False)
            except Exception:  # the worker must outlive any one bad batch or disk error
                log.exception("reporter: send cycle failed")
                self._stop.wait(self._flush_interval)
        self._cycle(final=True)

    def _cycle(self, *, final: bool) -> None:
        while batch := self._take(wait=not final):
            self._deliver(batch)
            if not final:
                break
        if self._spooled() and (final or time.monotonic() >= self._retry_at):
            self._replay()

    def _take(self, *, wait: bool) -> list[Wire]:
        """With `wait`, the first event in one interval and what follows it in the next."""
        try:
            first = self._queue.get(block=wait, timeout=self._flush_interval)
        except queue.Empty:
            return []
        batch = [to_wire(first)]
        closes = time.monotonic() + (self._flush_interval if wait else 0.0)
        while len(batch) < MAX_BATCH:
            try:
                batch.append(to_wire(self._queue.get(timeout=max(closes - time.monotonic(), 0))))
            except queue.Empty:
                break
        return batch

    def _deliver(self, batch: list[Wire]) -> None:
        for part in by_size(batch, MAX_BATCH_BYTES):
            if self._spooled() or time.monotonic() < self._retry_at or not self._send(part):
                self._spill(part)

    def _send(self, batch: list[Wire]) -> bool:
        """True when Sentinel took the batch or refused it for good; False to keep it."""
        if len(batch) == 1 and wire_size(batch[0]) > MAX_BATCH_BYTES:  # no body could carry it
            log.error("%s is over %d bytes; dropped", batch[0].get("eventId"), MAX_BATCH_BYTES)
            self.dropped += 1
            return True
        try:
            status = self._post(batch)
        except (OSError, HTTPException) as err:
            return self._failed(f"no answer: {err}")
        if 200 <= status < 300:
            self._backoff = 0.0
            return True
        if status in INVALID:
            if len(batch) == 1:
                log.error("sentinel refused %s (%d); dropped", batch[0].get("eventId"), status)
                return True
            half = len(batch) // 2
            return self._send(batch[:half]) and self._send(batch[half:])
        return self._failed(f"status {status}")

    def _failed(self, why: str) -> bool:
        self._backoff = min(max(2 * self._backoff, BACKOFF_START), BACKOFF_MAX)
        self._retry_at = time.monotonic() + self._backoff
        log.warning("sentinel %s; spooling, retry in %.2fs", why, self._backoff)
        return False

    def _spill(self, batch: list[Wire]) -> None:
        with self._spill_lock:
            held = 0
            for journal in (self._spool, self._sending):
                with contextlib.suppress(FileNotFoundError):  # replay may move it meanwhile
                    held += journal.path.stat().st_size
            if held < self._spool_max:
                self._spool_full = False
                self._spool.append(batch)
                return
            if not self._spool_full:
                log.error("spool holds %d bytes, its limit; new events are dropped", held)
            self._spool_full, self.dropped = True, self.dropped + len(batch)

    def _spooled(self) -> bool:
        return self._spool.exists() or self._sending.exists()

    def _replay(self) -> None:
        if not self._sending.exists():
            self._spool.move_to(self._sending.path)
        events = [wire for wire in self._sending.read() if _valid(wire)]
        sent = 0
        for part in by_size(events, MAX_BATCH_BYTES):
            if not self._send(part):
                if sent:
                    self._sending.rewrite(events[sent:])
                return
            sent += len(part)
        self._sending.remove()


def _valid(wire: Wire) -> bool:
    try:
        from_wire(wire)
    except (TypeError, ValueError) as err:
        log.warning("spool: dropped a bad event: %s", err)
        return False
    return True
