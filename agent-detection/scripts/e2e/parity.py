"""Checks 5 (lane parity) and 6 (performance): the same benign requests from a clean client (::1,
real lane) and from the flagged IP (127.0.0.1, mirror lane).

Each parity request uses its own User-Agent on both lanes, so the clean side never adds up to an
R1 or R2 verdict. The leak scan reads every reply a track client got in the whole run (Ctx.tally).
"""

from __future__ import annotations

from .context import V4, V6, Ctx, Sent, in_logs
from .judge import Answer, comparable, differences, leaks, percentile
from .wire import Client, Reply

WRONG_LOGIN = "username=nobody&password=not-the-password"
PARITY: tuple[tuple[str, str, str], ...] = (
    *(("GET", path, "") for path in (
        "/", "/products", "/products/1", "/products/2", "/products/999", "/products/abc",
        "/search?q=apple", "/search?q=caf%C3%A9", "/api/products", "/api/products/1",
        "/api/products/999", "/api/search?q=a", "/cart", "/api/cart", "/api/session", "/login",
        "/account", "/logout", "/checkout", "/api/users/1", "/static/css/site.css",
        "/static/js/app.js", "/static/img/logo.svg", "/static/img/hero.png", "/favicon.ico",
        "/robots.txt", "/nope", "/static/nope.txt")),
    ("HEAD", "/", ""),
    ("HEAD", "/products/1", ""),
    ("OPTIONS", "/", ""),
    ("POST", "/login", WRONG_LOGIN),
    ("POST", "/api/session", WRONG_LOGIN),
)
PERF_TARGETS = ("/", "/products", "/products/1", "/api/products/1", "/static/css/site.css")
PERF_COUNT = 200
WARMUP = 5
P95_BUDGET_MS = 2.0


def parity(ctx: Ctx) -> list[str]:
    """Sends each PARITY request on both lanes; how the answers differ (none when they match)."""
    problems: list[str] = []
    for n, (method, path, form) in enumerate(PARITY):
        role = f"parity-{n:02d}"
        real = Client(V6, ctx.agent(role)).send(method, path, form)
        twin = ctx.client(V4, role, tracked=True).send(method, path, form)
        for problem in differences(_answer(real), _answer(twin)):
            problems.append(f"{method} {path}: {problem}")
    return problems


def lane_check(ctx: Ctx, problems: list[str]) -> None:
    """Check 5, after the whole run: the parity differences and a leak scan of every reply a
    track client got."""
    scanned = [(reply, found) for reply in ctx.tally.replies if (found := leaks(_raw(reply)))]
    ctx.check("5 lane parity", not problems and not scanned, (
        f"{len(PARITY)} request pairs compared (status, header names and values except Date and "
        f"session cookie values, bodies): {len(problems)} differences {problems[:6]}; leak scan of "
        f"{len(ctx.tally.replies)} twin replies (headers and bodies; sockets, run/, 127.0.0.1, "
        f"8097, host paths, data files): {len(scanned)} hits "
        f"{[(r.status, found) for r, found in scanned[:4]]}"
    ))


def performance(ctx: Ctx) -> None:
    real = Client(V6, ctx.agent("perf"), keep=True)
    twin = ctx.client(V4, "perf", tracked=True)
    twin.keep = True
    times: dict[str, list[float]] = {"real": [], "mirror": []}
    sent: dict[str, list[Sent]] = {"real": [], "mirror": []}
    for n in range(WARMUP + PERF_COUNT):
        target = PERF_TARGETS[n % len(PERF_TARGETS)]
        order = (("real", real), ("mirror", twin)) if n % 2 else (("mirror", twin), ("real", real))
        for lane, client in order:
            one = ctx.to_track(client, "GET", target, wait=False) if lane == "mirror" \
                else ctx.send(client, "GET", target, tag="q")
            sent[lane].append(one)
            if n >= WARMUP and one.reply.status == 200:
                times[lane].append(one.reply.ms)
    stats = {lane: (percentile(v, 50), percentile(v, 95)) for lane, v in times.items()}
    diff = stats["mirror"][1] - stats["real"][1]
    routed = {lane: sum(in_logs(s) == want for s in sent[lane])
              for lane, want in (("real", (1, 0)), ("mirror", (0, 1)))}
    ctx.numbers.update(p50_real_ms=stats["real"][0], p95_real_ms=stats["real"][1],
                       p50_mirror_ms=stats["mirror"][0], p95_mirror_ms=stats["mirror"][1])
    passed = abs(diff) < P95_BUDGET_MS and all(len(v) == PERF_COUNT for v in times.values()) \
        and all(n == WARMUP + PERF_COUNT for n in routed.values())
    ctx.check("6 performance", passed, (
        f"{PERF_COUNT} measured GETs per lane (+{WARMUP} warm-up), kept connections, alternating "
        f"lanes over {len(PERF_TARGETS)} endpoints: real p50 {stats['real'][0]:.2f} ms p95 "
        f"{stats['real'][1]:.2f} ms; mirror p50 {stats['mirror'][0]:.2f} ms p95 "
        f"{stats['mirror'][1]:.2f} ms; p95 difference {diff:+.2f} ms (budget < {P95_BUDGET_MS} "
        f"ms); 200 OK {len(times['real'])}/{len(times['mirror'])}; served by the expected shop "
        f"(marker in real.log / twin.log) {routed}"
    ))


def _answer(reply: Reply) -> Answer:
    return comparable(reply.status, reply.headers, reply.body)


def _raw(reply: Reply) -> str:
    head = "\n".join(f"{name}: {value}" for name, value in reply.headers)
    return f"{head}\n\n{reply.body.decode('latin-1')}"
