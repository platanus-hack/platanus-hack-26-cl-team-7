"""Sessions keyed by IP + User-Agent, with the sliding windows the rules read."""

from __future__ import annotations

import heapq
from collections import Counter, deque
from typing import NamedTuple

from engine.config import Thresholds
from engine.models import Request, session_key
from engine.routes import RouteMatch

DEFAULT_MAX_WINDOW = 300.0


class Event(NamedTuple):
    """One request as the rules see it.

    endpoint is None for asset routes, the route pattern for listed routes and the raw path
    for exits.
    """

    ts: float
    exit: bool
    endpoint: str | None


class _Window:
    """Running counts for the events with ts in [newest - span, newest].

    A min-heap by ts keeps the counts exact when lines arrive slightly out of order, and each
    request costs O(log n) instead of a scan of the whole window.
    """

    def __init__(self, span: float) -> None:
        self.span = span
        self.exits = 0
        self.endpoints: Counter[str] = Counter()
        self._heap: list[tuple[float, int, Event]] = []

    def push(self, seq: int, event: Event, newest: float) -> None:
        heapq.heappush(self._heap, (event.ts, seq, event))
        self._tally(event, 1)
        start = newest - self.span
        while self._heap and self._heap[0][0] < start:
            self._tally(heapq.heappop(self._heap)[2], -1)

    def _tally(self, event: Event, step: int) -> None:
        self.exits += step if event.exit else 0
        if event.endpoint is not None:
            self.endpoints[event.endpoint] += step
            if self.endpoints[event.endpoint] == 0:
                del self.endpoints[event.endpoint]


class Session:
    def __init__(self, ip: str, user_agent: str, max_window: float = DEFAULT_MAX_WINDOW) -> None:
        self.id = session_key(ip, user_agent)
        self.ip = ip
        self.user_agent = user_agent
        self.max_window = max_window
        self.request_count = 0
        self.first_ts = 0.0
        self.last_ts = 0.0
        self.events: deque[Event] = deque()
        self._windows: dict[float, _Window] = {}

    def add(self, req: Request, match: RouteMatch | None) -> None:
        if self.request_count == 0:
            self.first_ts = self.last_ts = req.ts
        else:
            self.first_ts = min(self.first_ts, req.ts)
            self.last_ts = max(self.last_ts, req.ts)
        self.request_count += 1
        event = _event(req, match)
        self.events.append(event)
        for tracked in self._windows.values():
            tracked.push(self.request_count, event, self.last_ts)
        self._prune()

    def count_exits(self, now: float, window: float) -> int:
        tracked = self._tracked(now, window)
        if tracked is not None:
            return tracked.exits
        return sum(1 for event in self._within(now, window) if event.exit)

    def count_endpoints(self, now: float, window: float) -> int:
        tracked = self._tracked(now, window)
        if tracked is not None:
            return len(tracked.endpoints)
        endpoints = {event.endpoint for event in self._within(now, window)}
        endpoints.discard(None)
        return len(endpoints)

    def _tracked(self, now: float, span: float) -> _Window | None:
        """The running window for a query anchored at the newest ts, else None (scan)."""
        if now != self.last_ts or span > self.max_window:
            return None
        tracked = self._windows.get(span)
        if tracked is None:
            tracked = self._windows[span] = _Window(span)
            for seq, event in enumerate(self.events):
                tracked.push(-1 - seq, event, self.last_ts)
        return tracked

    def _within(self, now: float, window: float) -> list[Event]:
        start = now - window
        return [event for event in self.events if start <= event.ts <= now]

    def _prune(self) -> None:
        cutoff = self.last_ts - self.max_window
        while self.events and self.events[0].ts < cutoff:
            self.events.popleft()


class SessionStore:
    def __init__(
        self, idle_timeout: float = 1800.0, max_window: float = DEFAULT_MAX_WINDOW
    ) -> None:
        self.idle_timeout = idle_timeout
        self.max_window = max_window
        self._sessions: dict[str, Session] = {}

    @classmethod
    def for_thresholds(cls, thresholds: Thresholds) -> SessionStore:
        window = max(thresholds.r1_window, thresholds.r2_window)
        return cls(idle_timeout=thresholds.idle_timeout, max_window=window)

    def __len__(self) -> int:
        return len(self._sessions)

    def get_or_create(self, req: Request) -> Session:
        """The live session for req; a session idle longer than idle_timeout starts over."""
        session = self._sessions.get(req.session_id)
        if session is None or (session.request_count > 0 and self._is_idle(session, req.ts)):
            session = Session(req.ip, req.user_agent, self.max_window)
            self._sessions[session.id] = session
        return session

    def expire(self, now: float) -> None:
        idle = [key for key, session in self._sessions.items() if self._is_idle(session, now)]
        for key in idle:
            del self._sessions[key]

    def _is_idle(self, session: Session, now: float) -> bool:
        return now - session.last_ts > self.idle_timeout


def _event(req: Request, match: RouteMatch | None) -> Event:
    if match is None:
        return Event(req.ts, True, req.path)
    return Event(req.ts, False, None if match.asset else match.pattern)
