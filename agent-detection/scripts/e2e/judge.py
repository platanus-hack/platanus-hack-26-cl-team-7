"""Pure judgements of the e2e harness: latency percentiles, lane parity, leaks, stream lags and the
Caddy log entries (run/access.log and the eval human split). No I/O on the stack, so
tests/test_e2e_judge.py runs all of it offline.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

IGNORED_HEADERS = frozenset({"date"})
SET_COOKIE = "set-cookie"
SESSION_VALUE = re.compile(r"(?<![\w-])session=[^;]*")
BLANK_SESSION = "session=<value>"
# The decoy path robots.txt gives each client (mirror.markers): it differs per client, not per lane.
MARKER = re.compile(rb"/admin-backup-[0-9a-f]{12}/")
BLANK_MARKER = b"/admin-backup-<marker>/"
HUMAN = "human"
# What a twin answer must never show: our sockets, the run folder, the loopback address the
# services listen on, the relay port and host paths.
LEAKS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("socket path", re.compile(r"[\w.-]+\.sock\b")),
    ("run folder", re.compile(r"(?<![\w.-])run/")),
    ("loopback address", re.compile(r"127\.0\.0\.1")),
    ("relay port", re.compile(r"\b8097\b")),
    ("filesystem path", re.compile(r"(?:/Users|/private|/tmp|/var|/home|/opt|/etc|/root)/\w")),
    ("data file", re.compile(r"\b(?:real|twin)(?:\.db|-files)\b")),
)


@dataclass(frozen=True)
class Answer:
    """One response as lane parity compares it."""

    status: int
    headers: tuple[tuple[str, str], ...]
    body: bytes


def comparable(status: int, headers: Iterable[tuple[str, str]], body: bytes) -> Answer:
    """The response without Date and with session cookie values and robots.txt markers blanked.
    Header names are lower case and sorted, so only names and values count, not their order."""
    kept = sorted(_normal(name.lower(), value) for name, value in headers)
    shown = tuple(pair for pair in kept if pair[0] not in IGNORED_HEADERS)
    return Answer(status, shown, MARKER.sub(BLANK_MARKER, body))


def _normal(name: str, value: str) -> tuple[str, str]:
    if name == SET_COOKIE:
        return name, SESSION_VALUE.sub(BLANK_SESSION, value)
    return name, value


def differences(real: Answer, twin: Answer) -> list[str]:
    """How the twin's answer differs from the real one; empty when they match."""
    found: list[str] = []
    if real.status != twin.status:
        found.append(f"status {real.status} != {twin.status}")
    if real.headers != twin.headers:
        only_real = sorted(set(real.headers) - set(twin.headers))
        only_twin = sorted(set(twin.headers) - set(real.headers))
        found.append(f"headers real-only {only_real} twin-only {only_twin}")
    if real.body != twin.body:
        at = next((i for i, (a, b) in enumerate(zip(real.body, twin.body, strict=False)) if a != b),
                  min(len(real.body), len(twin.body)))
        found.append(f"body {len(real.body)} B != {len(twin.body)} B, first difference at {at}")
    return found


def leaks(text: str) -> list[str]:
    """Each leak pattern that matches `text`, with the first match."""
    found: list[str] = []
    for name, pattern in LEAKS:
        match = pattern.search(text)
        if match:
            found.append(f"{name}: {match.group()!r}")
    return found


def percentile(values: Sequence[float], q: float) -> float:
    """Nearest-rank percentile of `values`, q in (0, 100]."""
    if not values or not 0 < q <= 100:
        raise ValueError("percentile needs values and 0 < q <= 100")
    ordered = sorted(values)
    return ordered[max(1, math.ceil(q / 100 * len(ordered))) - 1]


def stream_lags(seen: Sequence[tuple[float, int]], sent: Sequence[float]) -> list[float | None]:
    """For the k-th request sent to a track (at sent[k - 1]), the seconds until the stream first
    showed that track with at least k actions; None when it never did. `seen` is (time, actions)
    per streamed track change, in arrival order."""
    lags: list[float | None] = []
    for k, at in enumerate(sent, start=1):
        first = next((when for when, count in seen if count >= k), None)
        lags.append(None if first is None else max(0.0, first - at))
    return lags


@dataclass(frozen=True)
class Entry:
    """One handled request of a Caddy JSON access log, with the fields engine.logreader reads."""

    ts: float
    ip: str
    user_agent: str
    method: str
    uri: str

    @property
    def session(self) -> str:
        return f"{self.ip}|{self.user_agent}"  # engine.models.session_key


def access_entry(line: str) -> Entry | None:
    """The entry of one log line, or None when the line is not a handled request."""
    try:
        entry = json.loads(line)
    except ValueError:
        return None
    if not isinstance(entry, dict):
        return None
    request, ts, status = entry.get("request"), entry.get("ts"), entry.get("status")
    if not isinstance(request, dict) or not _number(status) or isinstance(ts, bool) \
            or not isinstance(ts, int | float):
        return None
    headers = request.get("headers")
    agents = headers.get("User-Agent") if isinstance(headers, dict) else None
    agent = agents[0] if isinstance(agents, list) and agents else ""
    ip = request.get("client_ip") or request.get("remote_ip") or ""
    method, uri = request.get("method"), request.get("uri")
    if not isinstance(method, str) or not isinstance(uri, str):
        return None
    return Entry(float(ts), str(ip), str(agent), method, uri)


def _number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def access_entries(text: str) -> list[Entry]:
    return [entry for line in text.splitlines() if (entry := access_entry(line)) is not None]


@dataclass(frozen=True)
class Visit:
    """A human request to replay: its delay after the first request of its session."""

    offset: float
    entry: Entry


def human_visits(split: Path) -> list[Visit]:
    """Every request of the sessions labeled human in the split's <name>.jsonl and
    <name>.labels.json pairs, each session moved to start at offset 0, in offset order."""
    entries: list[Entry] = []
    for log in sorted(split.glob("*.jsonl")):
        labels = json.loads(log.with_name(f"{log.stem}.labels.json").read_text("utf-8"))
        humans = {sid for sid, label in labels["sessions"].items() if label == HUMAN}
        text = log.read_text("utf-8", "replace")
        entries.extend(e for e in access_entries(text) if e.session in humans)
    first: dict[str, float] = {}
    for entry in entries:
        first[entry.session] = min(first.get(entry.session, entry.ts), entry.ts)
    visits = [Visit(entry.ts - first[entry.session], entry) for entry in entries]
    return sorted(visits, key=lambda visit: visit.offset)
