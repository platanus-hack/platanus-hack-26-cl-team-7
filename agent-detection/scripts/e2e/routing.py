"""Checks 2 (recording), 4 (follow keys) and 3a (real data untouched): one client browses the
real shop and signs in there, sends GET /.env (an R3 critical flag) and goes on. accounting()
judges check 1 and 3b once the whole run is over.

Client A is 127.0.0.1 with one User-Agent. After the flag every request from 127.0.0.1 (the R3 ip
key) must reach the twin, and so must a twin-issued session cookie sent from ::1 with a new
User-Agent. The router is restarted once in the middle: the keys must survive it.

Copy on flag writes a masked account (demo.own): on the twin the copied session is signed in under
a masked name, and the real password is refused, because the twin holds none. The twin-issued
session comes from the shop's planted login flaw (TWIN_BYPASS), as an attacker would get one.
"""

from __future__ import annotations

import time

from . import stack
from .context import (
    DEMO_LOGIN,
    DEMO_USER,
    REAL_DB,
    RECORD_LIMIT,
    TWIN_BYPASS,
    V4,
    V6,
    Ctx,
    in_logs,
    session_of,
    user_of,
    wait_until,
)
from .judge import access_entries, stream_lags

STREAM_SETTLE = 1.0  # seconds to let the last streamed frames arrive before judging the stream


def run(ctx: Ctx) -> None:
    a = ctx.client(V4, "agent")
    for path in ("/", "/products"):
        ctx.pre.append(ctx.send(a, "GET", path, tag="r"))
    login = ctx.send(a, "POST", "/login", DEMO_LOGIN, tag="r")
    ctx.pre.append(login)
    ctx.real_cookie = a.cookie = session_of(login.reply)
    real_user = ctx.send(a, "GET", "/api/session", tag="r")
    ctx.pre.append(real_user)
    ctx.before = stack.digest(REAL_DB)

    a.tally = ctx.tally
    ctx.flag_at = time.time()
    flag = ctx.to_track(a, "GET", "/.env", wait=False)
    ctx.track, track_lag = ctx.find_track(V4, a.ua, flag.at)
    ctx.lags.append(("GET /.env (the flag)", ctx.wait_action(flag) if ctx.track else None))
    copied = ctx.to_track(a, "GET", "/api/session")
    account = ctx.to_track(a, "GET", "/account")
    refused = ctx.to_track(a, "POST", "/login", DEMO_LOGIN)
    twin_login = ctx.to_track(a, "POST", "/login", TWIN_BYPASS)
    ctx.twin_cookie = session_of(twin_login.reply)
    b = ctx.client(V6, "follow", cookie=ctx.twin_cookie, tracked=True)
    followed = ctx.to_track(b, "GET", "/api/session")
    other_agent = ctx.to_track(ctx.client(V4, "agent-2", tracked=True), "GET", "/products")
    routed = len(ctx.on_track)
    time.sleep(STREAM_SETTLE)
    _recording(ctx, track_lag, routed)

    pid = stack.kill("router")
    stack.start_router()
    after = [
        ctx.to_track(a, "GET", "/products"),
        ctx.to_track(ctx.client(V6, "follow-2", cookie=ctx.twin_cookie, tracked=True),
                     "GET", "/api/session"),
        ctx.to_track(ctx.client(V6, "follow", tracked=True), "GET", "/"),
        ctx.to_track(a, "GET", "/api/session"),
    ]
    restarted = [f"{s.method} {s.path} {in_logs(s)} {s.reply.status}" for s in after]
    masked, twin_user = user_of(copied.reply), user_of(followed.reply)
    survived = all(in_logs(s) == (0, 1) for s in after) and user_of(after[1].reply) == twin_user
    follow = [
        ("real cookie on real before flag", user_of(real_user.reply) == DEMO_USER
         and in_logs(real_user) == (1, 0)),
        ("same real cookie signed in on twin under a masked name (copy on flag)",
         _is_name(masked) and masked != DEMO_USER and in_logs(copied) == (0, 1)),
        ("twin account page signed in, masked", account.reply.status == 200
         and f"Signed in as {masked}" in account.reply.text()
         and f"Signed in as {DEMO_USER}" not in account.reply.text()),
        ("real password refused on twin (it holds none)", refused.reply.status == 401
         and not session_of(refused.reply) and in_logs(refused) == (0, 1)),
        ("twin issued its own session", bool(ctx.twin_cookie)
         and ctx.twin_cookie != ctx.real_cookie and twin_login.reply.status == 303),
        ("twin cookie from ::1 + new UA -> twin", _is_name(twin_user)
         and twin_user != DEMO_USER and in_logs(followed) == (0, 1)),
        ("same IP, other UA -> twin (ip key)", in_logs(other_agent) == (0, 1)),
        (f"after router restart (pid {pid}) every key still routes to twin", survived),
    ]
    ctx.check("4 follow keys", all(ok for _, ok in follow),
              "; ".join(f"{name}={'ok' if ok else 'NO'}" for name, ok in follow)
              + f"; real.log/twin.log hits after restart: {restarted}")
    after_digest = stack.digest(REAL_DB)
    ctx.check("3a real data untouched (flag through router restart)",
              after_digest == ctx.before, _digest_evidence(ctx.before, after_digest))


def _is_name(user: object) -> bool:
    return isinstance(user, str) and bool(user) and not user.startswith("HTTP ")


def _recording(ctx: Ctx, track_lag: float | None, routed: int) -> None:
    detail = ctx.detail()
    lags = [lag for _, lag in ctx.lags]
    sent_at = [s.at for s in ctx.on_track[:routed]]
    streamed = stream_lags(ctx.stream.seen(ctx.track), sent_at)
    shown = detail.get("track", {})
    passed = (
        bool(ctx.track) and track_lag is not None and track_lag <= RECORD_LIMIT
        and all(lag is not None and lag <= RECORD_LIMIT for lag in lags)
        and all(lag is not None and lag <= RECORD_LIMIT for lag in streamed)
        and shown.get("actions") == routed
    )
    ctx.numbers["record_max_lag_s"] = max((x for x in lags + streamed if x is not None), default=-1)
    ctx.check("2 recording", passed, (
        f"track {ctx.track or 'NOT FOUND'} (rule {shown.get('rule')}, {shown.get('reason')!r}) "
        f"listed {_s(track_lag)} after the flag; GET /v1/tracks/:id shows {shown.get('actions')}"
        f" actions for {routed} routed requests; per-action lag (detail) "
        f"{[(name, _s(lag)) for name, lag in ctx.lags]}; SSE track frames "
        f"{len(ctx.stream.seen(ctx.track))}, per-action lag (stream) {[_s(x) for x in streamed]}"
    ))


def _s(seconds: float | None) -> str:
    return "never" if seconds is None else f"{seconds:.2f}s"


def _digest_evidence(before: dict[str, tuple[int, str]], after: dict[str, tuple[int, str]]) -> str:
    changed = [t for t in before if before[t] != after.get(t)]
    rows = ", ".join(f"{t} {n} rows sha {h}" for t, (n, h) in before.items())
    return f"before: {rows}; changed tables: {changed or 'none'}"


def accounting(ctx: Ctx) -> None:
    """Check 1 over the whole run, and the second half of check 3. Tagged requests are counted
    in the shop logs. Untagged ones (lane parity) are counted at the edge: every request of a
    track client after the flag must be a recorded action, and only the twin path records."""
    pre = [in_logs(s) for s in ctx.pre]
    tagged = [in_logs(s) for s in ctx.on_track]
    real_hits = sum(real for real, _ in tagged)
    edge = [e for e in access_entries(stack.text("access.log")) if e.ts >= ctx.flag_at
            and (e.ip == V4 or (e.ip == V6 and e.user_agent in ctx.track_v6_agents))]

    def recorded() -> int:
        return stack.sentinel_count(stack.COUNT_TRACK_ACTIONS, ctx.track, "track.action")

    wait_until(lambda: recorded() >= len(edge), RECORD_LIMIT)  # the last ones may be in flight
    actions = recorded()
    unrecorded = max(0, len(edge) - actions)
    ctx.numbers["real_requests_after_flag"] = real_hits + unrecorded
    passed = (all(hit == (1, 0) for hit in pre) and real_hits == 0
              and all(hit == (0, 1) for hit in tagged)
              and len(edge) == actions == len(ctx.tally.replies))
    ctx.check("1 routing", passed, (
        f"before the flag {len(pre)} tagged requests, (real.log, twin.log) hits {pre}; the flag "
        f"GET /.env and {len(tagged) - 1} later tagged requests of the track's clients: real.log "
        f"hits {real_hits}, twin.log hits {sum(t for _, t in tagged)}/{len(tagged)}; all "
        f"requests after the flag: edge log {len(edge)}, replies {len(ctx.tally.replies)}, "
        f"track.action rows in sentinel.db {actions}; requests from the flagged client in the "
        f"real shop log after the flag: {real_hits + unrecorded}"
    ))
    final = stack.digest(REAL_DB)
    ctx.check("3b real data untouched (whole run)", final == ctx.before,
              _digest_evidence(ctx.before, final))
