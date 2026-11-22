"""What the checks share: the run's markers, its clients, the flagged client's track and results.

Every request a check must find in a log carries a marker query value `e2e=<run><tag><n>`, unique
in the run and of fixed width, so run/real.log and run/twin.log tell which shop answered it.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .stack import RUN, text
from .wire import Client, Reply, Stream, Tally, sentinel

POLL = 0.05
RECORD_LIMIT = 2.0  # seconds within which Sentinel must show a track and each action
WAIT_LIMIT = 10.0  # how long a poll waits before it reports "never"
BROWSER = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/18.1 Safari/605.1.15"
)
DEMO_LOGIN = "username=alice&password=wonderland"  # demo.seed's documented demo customer
DEMO_USER = "alice"
# The shop's planted login flaw (demo.auth): it signs in as the first user without a password. On
# the twin this is how an attacker gets a session, since the twin holds no real password.
TWIN_BYPASS = "username=%27+OR+1%3D1+--&password=anything"
REAL_DB = RUN / "real.db"
V4, V6 = "127.0.0.1", "::1"


@dataclass(frozen=True)
class Sent:
    at: float  # time.time() just before the request left
    who: str
    method: str
    path: str
    query: str
    marker: str
    reply: Reply


@dataclass(frozen=True)
class Result:
    name: str
    passed: bool
    evidence: str


@dataclass
class Ctx:
    run: str
    token: str
    stream: Stream
    tally: Tally = field(default_factory=Tally)  # every reply a track client got after the flag
    pre: list[Sent] = field(default_factory=list)  # tagged requests before the flag
    on_track: list[Sent] = field(default_factory=list)  # tagged requests that must reach the twin
    track_v6_agents: set[str] = field(default_factory=set)  # ::1 clients linked to the track
    lags: list[tuple[str, float | None]] = field(default_factory=list)
    results: list[Result] = field(default_factory=list)
    numbers: dict[str, float] = field(default_factory=dict)
    track: str = ""
    flag_at: float = 0.0
    real_cookie: str = ""
    twin_cookie: str = ""
    before: dict[str, tuple[int, str]] = field(default_factory=dict)
    _n: int = 0

    def agent(self, role: str) -> str:
        return f"{BROWSER} e2e-{self.run}-{role}"

    def client(self, ip: str, role: str, *, cookie: str = "", tracked: bool = False) -> Client:
        tally = self.tally if tracked else None
        if tracked and ip == V6:
            self.track_v6_agents.add(self.agent(role))
        return Client(ip, self.agent(role), cookie, tally=tally)

    def check(self, name: str, passed: bool, evidence: str) -> None:
        self.results.append(Result(name, passed, evidence))
        print(f"{'PASS' if passed else 'FAIL'} {name}: {evidence}", flush=True)

    def send(self, client: Client, method: str, path: str, form: str = "", tag: str = "x") -> Sent:
        """One request with a fresh marker appended to its query."""
        self._n += 1
        marker = f"e2e={self.run}{tag}{self._n:04d}"
        base, _, query = path.partition("?")
        query = f"{query}&{marker}" if query else marker
        at = time.time()
        reply = client.send(method, f"{base}?{query}", form)
        return Sent(at, client.ua, method, base, query, marker, reply)

    def to_track(self, client: Client, method: str, path: str, form: str = "", *,
                 wait: bool = True) -> Sent:
        """A request that must reach the twin on the flagged track; with `wait`, also how long
        Sentinel took to show it as an action (in `lags`)."""
        sent = self.send(client, method, path, form, "t")
        self.on_track.append(sent)
        if wait and self.track:
            self.lags.append((f"{method} {sent.path}", self.wait_action(sent)))
        return sent

    def detail(self) -> dict[str, Any]:
        status, body = sentinel("GET", f"/v1/tracks/{self.track}")
        return body if status == 200 and isinstance(body, dict) else {}

    def wait_action(self, sent: Sent, limit: float = WAIT_LIMIT) -> float | None:
        """Seconds from sending until GET /v1/tracks/:id lists the request; None if it never did."""
        while time.time() - sent.at < limit:
            if any(a["method"] == sent.method and a["path"] == sent.path
                   and a["query"] == sent.query for a in self.detail().get("actions", [])):
                return time.time() - sent.at
            time.sleep(POLL)
        return None

    def find_track(self, ip: str, agent: str, since: float) -> tuple[str, float | None]:
        """The id of the track this client opened after `since`, and how long Sentinel took."""
        while time.time() - since < WAIT_LIMIT:
            status, page = sentinel("GET", "/v1/tracks?range=5m&limit=200")
            for item in page.get("items", []) if status == 200 else []:
                if (item["ip"], item["userAgent"]) == (ip, agent) and \
                        item["openedAt"] >= int(since * 1000) - 1000:
                    return item["trackId"], time.time() - since
            time.sleep(POLL)
        return "", None


def wait_until(condition: Callable[[], bool], limit: float, every: float = POLL) -> bool:
    deadline = time.monotonic() + limit
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(every)
    return condition()


def in_logs(sent: Sent) -> tuple[int, int]:
    """How often the marker shows in run/real.log and run/twin.log."""
    return text("real.log").count(sent.marker), text("twin.log").count(sent.marker)


def session_of(reply: Reply) -> str:
    """The `session=<token>` pair of a reply's Set-Cookie, or ""."""
    for value in reply.header("Set-Cookie"):
        pair = value.split(";", 1)[0].strip()
        if pair.startswith("session=") and len(pair) > len("session="):
            return pair
    return ""


def user_of(reply: Reply) -> object:
    """The signed-in user GET /api/session reports, or the status when it is not JSON."""
    try:
        body = reply.json()
    except ValueError:
        return f"HTTP {reply.status}"
    return body.get("user") if isinstance(body, dict) else body
