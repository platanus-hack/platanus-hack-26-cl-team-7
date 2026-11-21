"""Sends deception events to Sentinel (POST /v1/deception/events) without ever blocking a caller.

emit() puts an event on a bounded queue and returns; when the queue is full the event goes
straight to the spool file. One worker thread sends batches of at most MAX_BATCH events, waiting
at most FLUSH_INTERVAL for the first one. A batch that fails (network error, 5xx, 401, 403, 408,
429) goes to the spool (run/mirror-spool.jsonl) and the worker backs off, doubling from
BACKOFF_START to BACKOFF_MAX; while the spool holds events, new batches join it. Replay moves the
spool aside and sends it in batches with the same eventIds, so Sentinel counts an event sent
twice as a duplicate; a crash mid-replay leaves the rest in the moved file for the next try.
A batch Sentinel refuses as invalid (400, 413, 422) is split in half until the bad event stands
alone; that one is logged and dropped, since resending it can never succeed.
"""

from __future__ import annotations

import http.client
import json
import logging
import queue
import threading
import time
from collections.abc import Callable
from functools import partial
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from mirror.contracts import MAX_BATCH, DeceptionEvent, from_wire, to_wire
from mirror.journal import Journal

EVENTS_PATH = "/v1/deception/events"
QUEUE_MAX = 10_000
FLUSH_INTERVAL = 0.25
POST_TIMEOUT = 2.0
BACKOFF_START = 0.25
BACKOFF_MAX = 30.0
CLOSE_TIMEOUT = 5.0
RETRYABLE = frozenset({401, 403, 408, 429})  # and every 5xx
INVALID = frozenset({400, 413, 422})
SENDING_SUFFIX = ".sending"
_CONNECTIONS: dict[str, type[http.client.HTTPConnection]] = {
    "http": http.client.HTTPConnection,
    "https": http.client.HTTPSConnection,
}

Wire = dict[str, Any]
Post = Callable[[list[Wire]], int]  # HTTP status; raises OSError or HTTPException on no answer

log = logging.getLogger(__name__)


def post_batch(url: str, token: str, batch: list[Wire], timeout: float = POST_TIMEOUT) -> int:
    """POST one batch; the HTTP status. `url` is the --sentinel base plus EVENTS_PATH."""
    target = urlsplit(url)
    connection_type = _CONNECTIONS.get(target.scheme)
    if connection_type is None or not target.hostname:
        raise http.client.InvalidURL(f"sentinel URL must be http(s)://host[:port]: {url!r}")
    connection = connection_type(target.hostname, target.port, timeout=timeout)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        connection.request("POST", target.path, json.dumps(batch).encode(), headers)
        response = connection.getresponse()
        response.read()
        return response.status
    finally:
        connection.close()


class SentinelReporter:
    def __init__(
        self,
        post: Post,
        spool: str | Path,
        *,
        clock: Callable[[], float] = time.monotonic,
        queue_max: int = QUEUE_MAX,
        flush_interval: float = FLUSH_INTERVAL,
    ) -> None:
        self._post = post
        self._clock = clock
        self._flush_interval = flush_interval
        self._queue: queue.Queue[DeceptionEvent] = queue.Queue(queue_max)
        self._spool = Journal(spool)
        self._sending = Journal(Path(spool).with_name(Path(spool).name + SENDING_SUFFIX))
        self._backoff = 0.0
        self._retry_at = 0.0
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
            self._spool.append([to_wire(event)])

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
        if self._spooled() and (final or self._clock() >= self._retry_at):
            self._replay()

    def _take(self, *, wait: bool) -> list[Wire]:
        try:
            first = self._queue.get(block=wait, timeout=self._flush_interval)
        except queue.Empty:
            return []
        batch = [to_wire(first)]
        while len(batch) < MAX_BATCH:
            try:
                batch.append(to_wire(self._queue.get_nowait()))
            except queue.Empty:
                break
        return batch

    def _deliver(self, batch: list[Wire]) -> None:
        if self._spooled() or self._clock() < self._retry_at or not self._send(batch):
            self._spool.append(batch)

    def _send(self, batch: list[Wire]) -> bool:
        """True when Sentinel took the batch or refused it for good; False to keep it."""
        try:
            status = self._post(batch)
        except (OSError, http.client.HTTPException) as err:
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
        self._retry_at = self._clock() + self._backoff
        log.warning("sentinel %s; spooling, retry in %.2fs", why, self._backoff)
        return False

    def _spooled(self) -> bool:
        return self._spool.exists() or self._sending.exists()

    def _replay(self) -> None:
        if not self._sending.exists():
            self._spool.move_to(self._sending.path)
        events = [wire for wire in self._sending.read() if _valid(wire)]
        for start in range(0, len(events), MAX_BATCH):
            if not self._send(events[start : start + MAX_BATCH]):
                if start:
                    self._sending.rewrite(events[start:])
                return
        self._sending.remove()


def _valid(wire: Wire) -> bool:
    try:
        from_wire(wire)
    except (TypeError, ValueError) as err:
        log.warning("spool: dropped a bad event: %s", err)
        return False
    return True
