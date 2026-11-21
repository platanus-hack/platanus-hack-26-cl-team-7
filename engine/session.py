"""Sessions keyed by IP + User-Agent, with the sliding windows the rules read."""

from __future__ import annotations

from collections import deque
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

    def add(self, req: Request, match: RouteMatch | None) -> None:
        if self.request_count == 0:
            self.first_ts = self.last_ts = req.ts
        else:
            self.first_ts = min(self.first_ts, req.ts)
            self.last_ts = max(self.last_ts, req.ts)
        self.request_count += 1
        self.events.append(_event(req, match))
        self._prune()

    def count_exits(self, now: float, window: float) -> int:
        return sum(1 for event in self._within(now, window) if event.exit)

    def count_endpoints(self, now: float, window: float) -> int:
        endpoints = {event.endpoint for event in self._within(now, window)}
        endpoints.discard(None)
        return len(endpoints)

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
        session = self._sessions.get(req.session_id)
        if session is None:
            session = Session(req.ip, req.user_agent, self.max_window)
            self._sessions[session.id] = session
        return session

    def expire(self, now: float) -> None:
        idle = [
            key
            for key, session in self._sessions.items()
            if now - session.last_ts > self.idle_timeout
        ]
        for key in idle:
            del self._sessions[key]


def _event(req: Request, match: RouteMatch | None) -> Event:
    if match is None:
        return Event(req.ts, True, req.path)
    return Event(req.ts, False, None if match.asset else match.pattern)
