"""Markers: one decoy path per identity, given out in robots.txt, and who received it.

An identity is IP + User-Agent (the ip_ua key value). Its marker is /admin-backup-<12 hex>/, the
first hex digits of an HMAC of the identity under a secret this process draws at start, so the
same identity reads the same robots.txt every time and nobody can compute another identity's
marker. No page links to a marker and robots.txt forbids it: the only way to request one is to
have read that identity's robots.txt, or to have been told by whoever did.

The ledger keeps, per marker given out, the identity, when it first read its robots.txt and when
it last did, for TTL seconds after the last read and for at most `limit` markers (the oldest go
first). It lives in memory only: after a restart the secret is new, so no old marker matches.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

PREFIX = "/admin-backup-"
CODE_HEX = 12
TTL = 24 * 3600.0
LIMIT = 20_000
ROBOTS_PATH = "/robots.txt"
_MARKER = re.compile(rf"{re.escape(PREFIX)}([0-9a-f]{{{CODE_HEX}}})(?:/|$)")

Clock = Callable[[], float]


@dataclass(frozen=True, slots=True)
class Issued:
    identity: str  # the ip_ua key value the marker was given to
    age: float  # seconds since that identity first read its robots.txt (while the marker lived)


class Markers:
    """Safe to call from many threads."""

    def __init__(
        self, secret: bytes | None = None, *, clock: Clock = time.time, limit: int = LIMIT
    ) -> None:
        self._secret = secret or os.urandom(32)
        self._clock = clock
        self._limit = limit
        # code -> identity, first read, last read
        self._given: OrderedDict[str, tuple[str, float, float]] = OrderedDict()
        self._lock = threading.Lock()

    def __len__(self) -> int:
        return len(self._given)

    def path_for(self, identity: str) -> str:
        """The marker path of `identity`, recorded as read now. A marker that is still alive keeps
        its first read: reading again never makes an old marker look new."""
        raw = identity.encode("utf-8", "surrogatepass")
        code = hmac.new(self._secret, raw, hashlib.sha256).hexdigest()[:CODE_HEX]
        with self._lock:
            now = self._clock()
            self._expire(now)
            known = self._given.get(code)
            self._given[code] = (identity, now if known is None else known[1], now)
            self._given.move_to_end(code)
            while len(self._given) > self._limit:
                self._given.popitem(last=False)
        return f"{PREFIX}{code}/"

    def issued(self, path: str) -> Issued | None:
        """Who received the marker `path` starts with; None for any other path, a marker nobody
        was given (a guess) and one that expired."""
        match = _MARKER.match(path)
        if match is None:
            return None
        with self._lock:
            now = self._clock()
            self._expire(now)
            entry = self._given.get(match.group(1))
        return None if entry is None else Issued(entry[0], now - entry[1])

    def _expire(self, now: float) -> None:
        while self._given:
            code, (_, _, seen) = next(iter(self._given.items()))
            if seen >= now - TTL:
                return
            del self._given[code]


def with_marker(robots: bytes, marker: str) -> bytes:
    """`robots` (a robots.txt, maybe empty) with one more rule for every crawler: Disallow the
    marker. The rule joins the file's last group when that group is for every crawler."""
    agents = [
        line.partition(b":")[2].strip()
        for line in robots.splitlines()
        if line.strip().lower().startswith(b"user-agent:")
    ]
    head = robots if not robots or robots.endswith(b"\n") else robots + b"\n"
    group = b"" if agents and agents[-1] == b"*" else b"User-agent: *\n"
    gap = b"\n" if head and group else b""
    return head + gap + group + b"Disallow: " + marker.encode("ascii") + b"\n"
