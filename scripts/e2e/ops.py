"""Checks 7 (humans) and 8 (resilience).

Humans: the human sessions of the eval tune split go straight to GET /lane on run/lane.sock, as
Caddy's forward_auth would ask, each session from offset 0 at its recorded pace (the engine reads
the router's clock, so a faster replay would squeeze a session into the R2 window).
"""

from __future__ import annotations

import json
import secrets
import threading
import time
from pathlib import Path

from . import stack
from .context import V4, V6, Ctx, in_logs, wait_until
from .judge import human_visits
from .wire import NET_ERRORS, Lane, sentinel

TUNE = Path("eval/data/tune")
LANE_SOCKET = "run/lane.sock"  # relative: macOS caps AF_UNIX paths near 104 bytes
SPOOL = ("mirror-spool.jsonl", "mirror-spool.jsonl.sending")
OUTAGE_PATHS = ("/", "/products", "/products/2", "/api/products", "/search?q=pear")
EVENTS = "/v1/deception/events"
REUSED = "IDEMPOTENCY_KEY_REUSED"
SLOW_POLL = 0.25  # a track detail holds up to 200 actions with their bodies


class Humans(threading.Thread):
    def __init__(self, run: str, speed: float) -> None:
        super().__init__(name="humans", daemon=True)
        self.run_id, self.speed = run, speed
        self.visits = human_visits(TUNE)
        self.ips = {visit.entry.ip for visit in self.visits}
        self.answered = self.mirrored = self.errors = 0
        self.tracks: set[str] = set()
        self.started_ms = 0  # Sentinel's tracks from an earlier run do not count

    def run(self) -> None:
        lane, started = Lane(LANE_SOCKET), time.monotonic()
        self.started_ms = int(time.time() * 1000)
        for n, visit in enumerate(self.visits):
            time.sleep(max(0.0, started + visit.offset / self.speed - time.monotonic()))
            entry = visit.entry
            try:
                answer, track = lane.ask({
                    "X-Forwarded-Method": entry.method, "X-Forwarded-Uri": entry.uri,
                    "X-Client-Ip": entry.ip, "User-Agent": entry.user_agent,
                    "X-Request-Id": f"e2e-{self.run_id}-h{n:05d}",
                })
            except NET_ERRORS:
                self.errors += 1
                continue
            self.answered += 1
            if answer != "real" or track:
                self.mirrored += 1
                self.tracks.add(track)
        lane.close()


def humans_result(ctx: Ctx, humans: Humans) -> None:
    opened = [t["trackId"] for t in _all_tracks()
              if t["ip"] in humans.ips and int(str(t["openedAt"])) >= humans.started_ms]
    ctx.numbers["human_tracks_opened"] = len(opened) + len(humans.tracks - set(opened))
    passed = humans.answered == len(humans.visits) and not humans.mirrored and not opened
    ctx.check("7 humans", passed, (
        f"{len(humans.visits)} requests of {len({v.entry.session for v in humans.visits})} human "
        f"sessions (eval/data/tune) replayed through GET /lane at {humans.speed}x their recorded "
        f"pace: {humans.answered} answered, {humans.errors} errors, {humans.mirrored} mirror "
        f"answers; Sentinel tracks with a human IP: {len(opened)}"
    ))


def _all_tracks() -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    cursor = ""
    while True:
        status, page = sentinel("GET", f"/v1/tracks?range=1h&limit=200{cursor}")
        items += page["items"] if status == 200 else []
        if status != 200 or not page.get("nextCursor"):
            return items
        cursor = f"&cursor={page['nextCursor']}"


def fail_open(ctx: Ctx) -> tuple[bool, str]:
    pid = stack.kill("router")
    clean = ctx.client(V6, "fail-open")
    sent = [ctx.send(clean, "GET", path, tag="f") for path in ("/", "/products", "/api/products")]
    opened = all(s.reply.status == 200 and in_logs(s) == (1, 0) for s in sent)
    stack.start_router()
    back = ctx.to_track(ctx.client(V4, "agent", tracked=True), "GET", "/products", wait=False)
    passed = opened and in_logs(back) == (0, 1)
    return passed, (
        f"router (pid {pid}) stopped: {len(sent)} clean GETs answered "
        f"{[s.reply.status for s in sent]} by the real shop (real.log/twin.log "
        f"{[in_logs(s) for s in sent]}) in {max(s.reply.ms for s in sent):.0f} ms at worst; "
        f"restarted: flagged IP still to twin {in_logs(back)}"
    )


def sentinel_outage(ctx: Ctx) -> tuple[bool, str]:
    connects = ctx.stream.connects
    pid = stack.kill("sentinel")
    agent = ctx.client(V4, "agent", tracked=True)
    sent = [ctx.to_track(agent, "GET", path, wait=False) for path in OUTAGE_PATHS]
    spooled = wait_until(lambda: stack.size(SPOOL[0]) > 0, 5.0)
    spool_bytes = stack.size(SPOOL[0])
    stack.start_sentinel()
    restarted = time.time()

    def present() -> bool:
        queries = {a["query"] for a in ctx.detail().get("actions", [])}
        return all(s.query in queries for s in sent)

    arrived = wait_until(present, 60.0, every=SLOW_POLL)
    arrival = time.time() - restarted
    bodies = [str(row[0]) for row in stack.sentinel_rows(stack.ACTION_QUERIES, ctx.track,
                                                          "track.action")]
    copies = [sum(s.marker in body for body in bodies) for s in sent]
    drained = wait_until(lambda: not any(stack.size(name) for name in SPOOL), 30.0)
    resumed = wait_until(lambda: ctx.stream.connects > connects, 10.0)
    passed = spooled and arrived and copies == [1] * len(sent) and drained
    return passed, (
        f"Sentinel (pid {pid}) stopped; {len(sent)} mirrored requests sent; spool "
        f"{spool_bytes} B; restarted, all {len(sent)} actions on the track after {arrival:.1f} s "
        f"({arrived}); stored copies per eventId {copies}; spool drained {drained}; SSE "
        f"reconnected {resumed}"
    )


def idempotency(ctx: Ctx) -> tuple[bool, str]:
    request_id, track = f"e2e-{ctx.run}-idem", f"trk_{secrets.token_hex(8)}"
    now = int(time.time() * 1000)
    batch = [
        {"type": "track.opened", "eventId": f"track.opened:{request_id}", "trackId": track,
         "ts": now, "ip": "192.0.2.10", "userAgent": "e2e-idempotency-probe", "rule": "R3",
         "reason": "e2e idempotency probe", "keys": [{"kind": "ip", "value": "192.0.2.10"}]},
        {"type": "track.action", "eventId": f"track.action:{request_id}", "trackId": track,
         "ts": now + 1, "method": "GET", "path": "/", "query": "", "status": 200,
         "durationMs": 1, "requestBody": "", "responseBody": ""},
    ]
    ids = json.dumps([event["eventId"] for event in batch])
    first = sentinel("POST", EVENTS, batch, ctx.token)
    rows = _rows(ids)
    second = sentinel("POST", EVENTS, batch, ctx.token)
    rows += _rows(ids)
    reused = sentinel("POST", EVENTS, [{**batch[1], "status": 500}], ctx.token)
    passed = (
        first == (202, {"accepted": 2, "duplicates": 0})
        and second == (202, {"accepted": 0, "duplicates": 2})
        and rows[0] == rows[2] == len(batch) and rows[1] == rows[3]
        and reused[0] == 422 and REUSED in json.dumps(reused[1])
    )
    return passed, (
        f"batch of {len(batch)} posted twice: {first} then {second}; rows with these eventIds "
        f"{rows[0]} -> {rows[2]}, all deception_events rows {rows[1]} -> {rows[3]}; same eventId "
        f"with another body: {reused[0]} {json.dumps(reused[1])[:160]}"
    )


def _rows(ids: str) -> list[int]:
    """Rows stored with these eventIds, and all deception_events rows."""
    return [stack.sentinel_count(stack.COUNT_EVENT_IDS, ids),
            stack.sentinel_count(stack.COUNT_EVENTS)]


def resilience(ctx: Ctx, parts: dict[str, tuple[bool, str]]) -> None:
    ctx.check("8 resilience", all(ok for ok, _ in parts.values()),
              "; ".join(f"[{name}: {'ok' if ok else 'FAILED'}] {text}"
                        for name, (ok, text) in parts.items()))
