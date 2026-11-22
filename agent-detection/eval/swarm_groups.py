"""The scripted groups of the swarm test (eval.swarm): who asks for what, in which order.

A client is one identity (IP + User-Agent). A script yields its steps one at a time and may read
`run.notes`, the marker each client got from its own robots.txt, as an agent reads shared notes.
Each group names the identities a correct swarm link must add to the mirror lane.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

from engine.routes import load_route_entries
from eval.synthetic import synthetic_humans
from mirror.contracts import DeceptionEvent
from mirror.forwarded import Forwarded
from mirror.lane import LaneRouter
from mirror.markers import ROBOTS_PATH, Markers

CONFIG = Path(__file__).resolve().parent.parent / "config"
PAGES = ("/", "/products", "/products/1", "/search", "/cart", "/api/products")
Client = tuple[str, str]  # IP, User-Agent
Step = tuple[Client, str]  # who asks for which path; "robots" reads robots.txt


@dataclass
class Run:
    """One router and what it decided for a script."""

    router: LaneRouter
    markers: Markers
    events: list[DeceptionEvent] = field(default_factory=list)
    lanes: list[tuple[Client, str, str]] = field(default_factory=list)  # who, lane, track
    notes: dict[Client, str] = field(default_factory=dict)  # each client's own marker

    def ask(self, who: Client, path: str) -> None:
        fwd = Forwarded(f"req-{len(self.lanes)}", "GET", path, "", who[0], who[1])
        decision = self.router.decide(fwd)
        self.lanes.append((who, decision.lane, decision.track_id))
        if path == ROBOTS_PATH:
            self.notes[who] = self.markers.path_for(fwd.ip_ua_key.value)

    def mirrored(self) -> dict[Client, str]:
        """The track of each identity whose last request took the mirror lane."""
        last = {who: (lane, track) for who, lane, track in self.lanes}
        return {who: track for who, (lane, track) in last.items() if lane == "mirror"}


Script = Callable[[Run], Iterator[Step]]


def _clients(count: int, block: int, agent: str = "agent") -> list[Client]:
    return [(f"198.51.{block}.{n + 1}", f"{agent}/{n + 1}.0") for n in range(count)]


def swarm_shared(run: Run) -> Iterator[Step]:
    """A scout reads robots.txt and shares what it found; five workers act on the notes."""
    scout, *workers = _clients(6, 10)
    yield scout, ROBOTS_PATH
    yield from ((scout, page) for page in PAGES[:3])
    for worker in workers:
        yield worker, PAGES[0]
        yield worker, run.notes[scout]
    for who in (scout, *workers):
        yield from ((who, page) for page in PAGES[3:])


def rotating_agent(run: Run) -> Iterator[Step]:
    """One address that sends each request under another User-Agent."""
    faces = [("198.51.11.1", f"browser/{n}.0") for n in range(6)]
    yield faces[0], ROBOTS_PATH
    for n, face in enumerate(faces[1:]):
        yield face, PAGES[n]
        yield face, run.notes[faces[0]]
    yield faces[0], PAGES[0]


def swarm_isolated(run: Run) -> Iterator[Step]:
    """The same agents with no shared memory: each acts on its own robots.txt only."""
    for who in _clients(6, 12):
        yield who, ROBOTS_PATH
        yield who, run.notes[who]
        yield from ((who, page) for page in PAGES[:3])


def swarm_stripping(run: Run) -> Iterator[Step]:
    """A swarm that shares its findings but drops every path with a long random part."""
    scout, *workers = _clients(6, 13)
    yield scout, ROBOTS_PATH
    for worker in workers:
        yield from ((worker, page) for page in PAGES[:4])


def crawler_fleet(run: Run) -> Iterator[Step]:
    """A crawler on many addresses: one reads robots.txt, all obey it."""
    fleet = [(f"198.51.14.{n + 1}", "Mozilla/5.0 (compatible; Examplebot/2.1)") for n in range(8)]
    yield fleet[0], ROBOTS_PATH
    for who in fleet:
        yield from ((who, page) for page in PAGES)


def shared_address(run: Run) -> Iterator[Step]:
    """Many people behind one address, each with another browser; some read robots.txt."""
    people = [("198.51.15.1", f"Mozilla/5.0 Browser/{n}.0") for n in range(12)]
    for n, who in enumerate(people):
        if n % 3 == 0:
            yield who, ROBOTS_PATH
        yield from ((who, page) for page in PAGES[:5])


def solo_scanner(run: Run) -> Iterator[Step]:
    """One scanner that ignores robots.txt: the ordinary rules judge it, with no link."""
    [who] = _clients(1, 16, "scanner")
    yield who, ROBOTS_PATH
    yield who, run.notes[who]
    yield from ((who, f"/missing-{n}") for n in range(6))


def humans(run: Run) -> Iterator[Step]:
    """Synthetic human sessions (eval.synthetic); every one of them holds a marker."""
    patterns = [dict(entry) for entry in load_route_entries(CONFIG / "routes.yaml")]
    for session in synthetic_humans(patterns, count=200, seed=7):
        first = session[0]
        yield (first.ip, first.user_agent), ROBOTS_PATH
        yield from (((req.ip, req.user_agent), req.path) for req in session)


GROUPS: tuple[tuple[Script, int], ...] = (  # the script, and the identities a link must add
    (swarm_shared, 6),
    (rotating_agent, 6),
    (swarm_isolated, 0),
    (swarm_stripping, 0),
    (crawler_fleet, 0),
    (shared_address, 0),
    (solo_scanner, 0),
    (humans, 0),
)
