"""Level-3 base-rate test: eval.base_rate.

Interface the implementer must meet (eval/base_rate.py):
    RATIO = 10_000
    synthetic_humans(patterns: list[dict[str, object]], count: int, seed: int,
                     start_ts: float = 1_700_000_000.0) -> list[list[Request]]
        `count` synthetic human sessions (one distinct "ip|ua" each, browser User-Agent) that walk
        the listed page routes of `patterns` (routes.yaml layout), load asset routes right after a
        page, pause human think times (seconds) between pages and only rarely hit an unlisted path
        (a typo, status 404). Same seed -> identical output.
    mix_base_rate(humans: Sequence[Sequence[Request]], probes: Sequence[Sequence[Request]],
                  seed: int, ratio: int = RATIO) -> eval.dataset.Split
        Keeps every human session unchanged (label "human") and adds len(humans) // ratio probe
        sessions drawn from `probes` (label "probing"), each shifted in time into the human time
        span with its own request spacing kept. requests are sorted by ts. Deterministic per seed.
    false_alarms_per_1000(labels: Mapping[str, Label], verdicts: Iterable[Verdict]) -> float | None
        Flagged human sessions per 1,000 human sessions; None when there are no human sessions.
"""

from __future__ import annotations

import statistics
from collections import Counter

import pytest

from engine.config import Thresholds
from engine.detector import Detector, replay
from engine.models import Label, Request, Verdict
from engine.routes import RouteTable
from eval.base_rate import RATIO, false_alarms_per_1000, mix_base_rate, synthetic_humans

PATTERNS: list[dict[str, object]] = [
    {"pattern": "/"},
    {"pattern": "/products"},
    {"pattern": "/products/{id}"},
    {"pattern": "/search"},
    {"pattern": "/cart"},
    {"pattern": "/login", "methods": ["GET", "POST"]},
    {"pattern": "/static/**", "asset": True},
    {"pattern": "/favicon.ico", "asset": True},
]
ROUTES = RouteTable.from_patterns(PATTERNS)
SESSIONS = 300


def humans(seed: int = 7, count: int = SESSIONS) -> list[list[Request]]:
    return synthetic_humans(PATTERNS, count, seed)


def classify(req: Request) -> str:
    match = ROUTES.match(req.method, req.path)
    if match is None:
        return "exit"
    return "asset" if match.asset else "page"


def human_request(i: int) -> Request:
    ip = f"10.{i // 65536}.{(i // 256) % 256}.{i % 256}"
    return Request(1_000_000.0 + i * 3.0, ip, "Mozilla/5.0 test", "GET", "/", "")


def probe_pool(size: int = 30) -> list[list[Request]]:
    pool: list[list[Request]] = []
    for n in range(size):
        ip = f"198.18.0.{n}"
        offsets = (0.0, 0.25, 0.75, 2.0)
        session = [
            Request(50.0 + off, ip, "ffuf/2.1", "GET", f"/p{k}", "")
            for k, off in enumerate(offsets)
        ]
        pool.append(session)
    return pool


def verdict(session: str) -> Verdict:
    ip, _, ua = session.partition("|")
    return Verdict(session, ip, ua, "R2", "test", False, 1.0, 11)


def test_ratio_is_one_in_ten_thousand() -> None:
    assert RATIO == 10_000


def test_synthetic_humans_count_and_distinct_sessions() -> None:
    sessions = humans()
    assert len(sessions) == SESSIONS
    ids = [{r.session_id for r in s} for s in sessions]
    assert all(len(group) == 1 for group in ids)
    assert len(set().union(*ids)) == SESSIONS


def test_synthetic_humans_are_deterministic_per_seed() -> None:
    assert humans(seed=11, count=50) == humans(seed=11, count=50)
    assert humans(seed=11, count=50) != humans(seed=12, count=50)


def test_synthetic_humans_use_browser_user_agents() -> None:
    assert all(r.user_agent.startswith("Mozilla/5.0") for s in humans() for r in s)


def test_synthetic_humans_start_on_a_page_in_time_order() -> None:
    for session in humans():
        assert classify(session[0]) == "page"
        stamps = [r.ts for r in session]
        assert stamps == sorted(stamps)
        assert stamps[0] >= 1_700_000_000.0


def test_synthetic_humans_walk_several_listed_pages() -> None:
    sessions = humans()
    pages = [[r for r in s if classify(r) == "page"] for s in sessions]
    assert statistics.mean(len(p) for p in pages) >= 2
    visited = {ROUTES.match(r.method, r.path) for p in pages for r in p}
    assert len({m.pattern for m in visited if m is not None}) >= 4


def test_synthetic_humans_load_assets_right_after_a_page() -> None:
    for session in humans():
        last_page: float | None = None
        assets = 0
        for req in session:
            kind = classify(req)
            if kind == "page":
                last_page = req.ts
            elif kind == "asset":
                assets += 1
                assert last_page is not None
                assert 0.0 <= req.ts - last_page <= 5.0
        assert assets >= 1


def test_synthetic_humans_think_in_seconds_between_pages() -> None:
    gaps: list[float] = []
    for session in humans():
        stamps = [r.ts for r in session if classify(r) == "page"]
        gaps.extend(b - a for a, b in zip(stamps, stamps[1:], strict=False))
    assert gaps
    assert min(gaps) >= 1.0
    assert max(gaps) < Thresholds().idle_timeout
    assert statistics.median(gaps) >= 3.0


def test_synthetic_humans_rarely_exit_the_route_list() -> None:
    sessions = humans()
    kinds = [[classify(r) for r in s] for s in sessions]
    exits = sum(k.count("exit") for k in kinds)
    pages = sum(k.count("page") for k in kinds)
    assert exits <= 0.02 * pages
    assert max(k.count("exit") for k in kinds) <= 2


def test_synthetic_human_statuses_match_routes() -> None:
    for session in humans():
        for req in session:
            if classify(req) == "exit":
                assert req.status == 404
            else:
                assert req.status < 400


def test_synthetic_humans_never_trip_exits_or_critical_flags() -> None:
    requests = sorted((r for s in humans() for r in s), key=lambda r: r.ts)
    verdicts = replay(requests, Detector(ROUTES, Thresholds()))
    assert [v for v in verdicts if v.rule in ("R1", "R3")] == []


def test_mix_adds_one_probe_per_ten_thousand_humans() -> None:
    people = [[human_request(i)] for i in range(20_000)]
    counts = Counter(mix_base_rate(people, probe_pool(), seed=3).labels.values())
    assert counts == Counter({"human": 20_000, "probing": 2})


def test_mix_at_exactly_the_ratio_adds_one_probe() -> None:
    people = [[human_request(i)] for i in range(10_000)]
    counts = Counter(mix_base_rate(people, probe_pool(), seed=3).labels.values())
    assert counts == Counter({"human": 10_000, "probing": 1})


def test_mix_respects_custom_ratio() -> None:
    people = [[human_request(i)] for i in range(1_000)]
    counts = Counter(mix_base_rate(people, probe_pool(), seed=3, ratio=100).labels.values())
    assert counts["probing"] == 10


def test_mix_is_deterministic_for_a_seed() -> None:
    people = [[human_request(i)] for i in range(20_000)]
    first = mix_base_rate(people, probe_pool(), seed=42)
    second = mix_base_rate(people, probe_pool(), seed=42)
    assert first.requests == second.requests
    assert first.labels == second.labels


def test_mix_depends_on_the_seed() -> None:
    people = [[human_request(i)] for i in range(20_000)]
    runs = [mix_base_rate(people, probe_pool(), seed=s).requests for s in range(1, 7)]
    assert any(run != runs[0] for run in runs[1:])


def test_mix_keeps_humans_unchanged_and_sorts_by_ts() -> None:
    people = [[human_request(i)] for i in range(20_000)]
    mixed = mix_base_rate(people, probe_pool(), seed=5)
    stamps = [r.ts for r in mixed.requests]
    assert stamps == sorted(stamps)
    kept = [r for r in mixed.requests if mixed.labels[r.session_id] == "human"]
    assert Counter(kept) == Counter(s[0] for s in people)


def test_mix_shifts_probes_into_human_span_keeping_their_spacing() -> None:
    people = [[human_request(i)] for i in range(20_000)]
    pool = probe_pool()
    by_id = {s[0].session_id: s for s in pool}
    mixed = mix_base_rate(people, pool, seed=9)
    low, high = people[0][0].ts, people[-1][0].ts
    probes = [sid for sid, label in mixed.labels.items() if label == "probing"]
    assert set(probes) <= set(by_id)
    for sid in probes:
        got = [r for r in mixed.requests if r.session_id == sid]
        original = by_id[sid]
        assert [r.path for r in got] == [r.path for r in original]
        assert low <= got[0].ts <= high
        spacing = [b.ts - a.ts for a, b in zip(got, got[1:], strict=False)]
        expected = [b.ts - a.ts for a, b in zip(original, original[1:], strict=False)]
        assert spacing == pytest.approx(expected)


def test_false_alarms_per_thousand_humans() -> None:
    labels: dict[str, Label] = {f"10.0.{i // 256}.{i % 256}|ua": "human" for i in range(2_000)}
    labels["198.18.0.1|ffuf"] = "probing"
    flagged = ["10.0.0.1|ua", "10.0.0.2|ua", "10.0.0.3|ua", "10.0.0.3|ua", "198.18.0.1|ffuf"]
    assert false_alarms_per_1000(labels, [verdict(s) for s in flagged]) == pytest.approx(1.5)


def test_false_alarms_zero_when_no_human_flagged() -> None:
    labels: dict[str, Label] = {"10.0.0.1|ua": "human", "198.18.0.1|ffuf": "probing"}
    assert false_alarms_per_1000(labels, [verdict("198.18.0.1|ffuf")]) == 0.0


def test_false_alarms_null_without_humans() -> None:
    labels: dict[str, Label] = {"198.18.0.1|ffuf": "probing"}
    assert false_alarms_per_1000(labels, []) is None


def test_mix_rejects_a_probe_pool_smaller_than_needed() -> None:
    people = [[human_request(i)] for i in range(30_000)]
    with pytest.raises(ValueError, match="pool"):
        mix_base_rate(people, probe_pool(size=2), seed=1)
