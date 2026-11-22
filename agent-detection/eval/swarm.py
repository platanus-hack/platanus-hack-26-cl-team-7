"""The swarm test: scripted groups of clients sent through the lane router, with and without the
swarm link (mirror.swarm), and what each router did with them.

    uv run python -m eval.swarm

Each group runs on a fresh pair of routers: a plain LaneRouter and a SwarmLane. A client is one
identity (IP + User-Agent). "reads robots" is the request for /robots.txt plus the marker the
robots listener would give that identity. Every request happens at once, the hardest case for the
time windows of R1 and R2, so a group that stays clean here stays clean at any pace.

For each group the row gives: the identities, how many end on the mirror lane under each router,
how many of those only the link put there, the tracks they end on, and the requests of linked
identities that still reached the real shop after the first link.
"""

from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path

from engine.config import load_thresholds
from engine.detector import Detector
from engine.routes import RouteTable
from eval.swarm_groups import CONFIG, GROUPS, Run, Script
from mirror.contracts import DeceptionEvent, TrackOpened
from mirror.keys import KeyTable
from mirror.lane import LaneRouter
from mirror.markers import Markers
from mirror.patches import PatchBook
from mirror.swarm import SWARM_REASON, SwarmLane


@dataclass(frozen=True)
class Row:
    group: str
    identities: int
    mirror_plain: int  # identities the ordinary rules alone put on the mirror lane
    mirror_swarm: int  # the same with the swarm link
    linked: int  # identities only the link put there
    expected: int
    tracks: int  # tracks the mirrored identities end on, with the link
    real_after_link: int  # requests of linked identities that reached the real shop afterwards

    @property
    def ok(self) -> bool:
        return self.linked == self.expected and self.mirror_swarm >= self.mirror_plain


def _run(script: Script, folder: Path, *, swarm: bool) -> Run:
    routes = RouteTable.from_yaml(CONFIG / "routes.yaml")
    detector = Detector(routes, load_thresholds(CONFIG / "rules.yaml"))
    keys = KeyTable.load(folder / "keys.jsonl")
    patches = PatchBook.load(folder / "patches.jsonl", routes)
    markers = Markers()
    events: list[DeceptionEvent] = []
    parts = (detector, keys, patches, events.append, lambda _session: None)
    router = SwarmLane(*parts, markers=markers) if swarm else LaneRouter(*parts)
    run = Run(router, markers, events)
    try:
        for who, path in script(run):
            run.ask(who, path)
    finally:
        keys.close()
        patches.close()
    return run


def measure(script: Script, expected: int) -> Row:
    with tempfile.TemporaryDirectory() as plain_dir, tempfile.TemporaryDirectory() as swarm_dir:
        plain = _run(script, Path(plain_dir), swarm=False)
        swarm = _run(script, Path(swarm_dir), swarm=True)
    before, after = plain.mirrored(), swarm.mirrored()
    linked = after.keys() - before.keys()
    opened = [e for e in swarm.events if isinstance(e, TrackOpened)]
    by_link = {e.track_id for e in opened if e.reason == SWARM_REASON}
    first = next((n for n, (_, _, track) in enumerate(swarm.lanes) if track in by_link), None)
    late = (
        0
        if first is None
        else sum(who in linked and lane == "real" for who, lane, _ in swarm.lanes[first:])
    )
    return Row(
        group=script.__name__,
        identities=len({who for who, _, _ in swarm.lanes}),
        mirror_plain=len(before),
        mirror_swarm=len(after),
        linked=len(linked),
        expected=expected,
        tracks=len(set(after.values())),
        real_after_link=late,
    )


def table(rows: list[Row]) -> str:
    head = "| Group | Identities | Mirror, rules only | Mirror, with link | Linked | Expected | "
    lines = [head + "Tracks | Real after link | Pass |", "|" + " --- |" * 9]
    for row in rows:
        cells = (
            row.group,
            row.identities,
            row.mirror_plain,
            row.mirror_swarm,
            row.linked,
            row.expected,
            row.tracks,
            row.real_after_link,
            "yes" if row.ok else "NO",
        )
        lines.append("| " + " | ".join(str(cell) for cell in cells) + " |")
    return "\n".join(lines)


def main() -> int:
    rows = [measure(script, expected) for script, expected in GROUPS]
    print(table(rows))
    return 0 if all(row.ok for row in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
