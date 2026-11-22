"""Check 9 (swarm link): two clean clients that share one robots.txt marker end on one track, and
a third clean client beside them is left alone.

All three are ::1 with their own User-Agent, so each is its own identity and none is the flagged
127.0.0.1. The scout reads robots.txt and browses; the worker asks for the scout's marker, as an
agent acts on shared notes; the bystander reads its own robots.txt and even asks for its own
marker. Only the scout and the worker may move to the twin.
"""

from __future__ import annotations

import time

from .context import V6, Ctx, in_logs
from .judge import MARKER
from .wire import sentinel

REAL, TWIN = (1, 0), (0, 1)
REASON = "swarm link"


def run(ctx: Ctx) -> None:
    scout, worker, bystander = (
        ctx.client(V6, f"swarm-{role}") for role in ("scout", "worker", "bystander")
    )
    robots = scout.send("GET", "/robots.txt")
    found = MARKER.search(robots.body)
    marker = found.group().decode() if found else "/no-marker/"
    own = MARKER.search(bystander.send("GET", "/robots.txt").body)
    own_marker = own.group().decode() if own else "/no-marker/"
    before = [
        ctx.send(scout, "GET", "/products", tag="s"),
        ctx.send(worker, "GET", "/", tag="s"),
        ctx.send(bystander, "GET", own_marker, tag="s"),
    ]
    since = time.time()
    linked = [
        ctx.send(worker, "GET", marker, tag="s"),
        ctx.send(scout, "GET", "/products", tag="s"),
        ctx.send(worker, "GET", "/api/products", tag="s"),
    ]
    after = ctx.send(bystander, "GET", "/products", tag="s")
    track, _ = ctx.find_track(V6, worker.ua, since)
    status, detail = sentinel("GET", f"/v1/tracks/{track}") if track else (0, {})
    shown = detail.get("track", detail) if status == 200 and isinstance(detail, dict) else {}
    keys = {key.get("value") for key in shown.get("keys", [])}
    parts = [
        (
            "robots.txt gives each client its own marker",
            robots.status == 200
            and bool(found)
            and bool(own)
            and marker != own_marker
            and scout.send("GET", "/robots.txt").body == robots.body,
        ),
        ("clean before the link", all(in_logs(sent) == REAL for sent in before)),
        ("worker and scout on the twin after it", all(in_logs(sent) == TWIN for sent in linked)),
        ("bystander still on the real shop", in_logs(after) == REAL),
        (
            "Sentinel shows one track with both identities",
            bool(track)
            and str(shown.get("reason", "")).startswith(REASON)
            and {f"{V6}|{scout.ua}", f"{V6}|{worker.ua}"} <= keys
            and f"{V6}|{bystander.ua}" not in keys,
        ),
    ]
    ctx.check(
        "9 swarm link",
        all(ok for _, ok in parts),
        (
            f"marker {marker}; track {track or 'none'} reason {shown.get('reason')!r}; "
            f"before {[in_logs(s) for s in before]} linked {[in_logs(s) for s in linked]} "
            f"bystander {in_logs(after)}; failed parts: {[name for name, ok in parts if not ok]}"
        ),
    )
