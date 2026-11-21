"""Session windows under real log conditions: out-of-order lines, long idle gaps, high rates."""

from __future__ import annotations

import random
import time
import tracemalloc

from helpers import make_request

from engine.config import Thresholds
from engine.detector import Detector, fired_key
from engine.models import Request
from engine.routes import RouteMatch, RouteTable
from engine.session import Session, SessionStore

UA = "ffuf/2.1.0"
IP = "198.51.100.9"
PATTERNS: list[dict[str, object]] = [{"pattern": "/"}, {"pattern": "/static/**", "asset": True}]
LISTED = RouteMatch(pattern="/", asset=False)
ASSET = RouteMatch(pattern="/static/**", asset=True)


def req(ts: float, path: str, ip: str = IP, ua: str = UA) -> Request:
    return Request(ts=ts, ip=ip, user_agent=ua, method="GET", path=path, query="")


def rules_fired(thresholds: Thresholds, requests: list[Request]) -> list[str]:
    detector = Detector(RouteTable.from_patterns(PATTERNS), thresholds)
    return [v.rule for r in requests for v in detector.process(r)]


def test_r1_counts_exit_written_after_a_later_ts() -> None:
    times = [100.0, 100.1, 100.2, 100.400, 100.399]
    requests = [req(t, f"/missing-{i}") for i, t in enumerate(times)]
    assert rules_fired(Thresholds(r2_max_endpoints=100, r3_enabled=False), requests) == ["R1"]


def test_r2_counts_endpoint_written_after_a_later_ts() -> None:
    times = [100.0 + n / 10 for n in range(10)] + [100.89]
    requests = [req(t, f"/probe-{i}") for i, t in enumerate(times)]
    thresholds = Thresholds(r1_min_exits=1000, r3_enabled=False)
    assert rules_fired(thresholds, requests) == ["R2"]


def test_out_of_order_line_older_than_window_still_does_not_count() -> None:
    times = [0.0, 1.0, 2.0, 400.0, 3.0]
    requests = [req(t, f"/missing-{i}") for i, t in enumerate(times)]
    thresholds = Thresholds(r1_min_exits=4, r2_max_endpoints=100, r3_enabled=False)
    assert rules_fired(thresholds, requests) == []


def _scan_exits(events: list[tuple[float, bool, str | None]], now: float, span: float) -> int:
    return sum(1 for ts, is_exit, _ in events if now - span <= ts <= now and is_exit)


def _scan_endpoints(events: list[tuple[float, bool, str | None]], now: float, span: float) -> int:
    found = {ep for ts, _, ep in events if now - span <= ts <= now and ep is not None}
    return len(found)


def test_running_windows_equal_a_full_scan_on_jittered_input() -> None:
    rng = random.Random(7)
    session = Session(IP, UA, max_window=30.0)
    seen: list[tuple[float, bool, str | None]] = []
    clock = 0.0
    for _ in range(3000):
        clock += rng.uniform(0.0, 0.4)
        ts = clock - rng.uniform(0.0, 0.05)
        kind = rng.randrange(3)
        path = f"/p{rng.randrange(40)}"
        match = None if kind == 0 else (LISTED if kind == 1 else ASSET)
        session.add(make_request(ts=ts, path=path), match)
        endpoint = path if match is None else (None if match.asset else match.pattern)
        seen.append((ts, match is None, endpoint))
        now = session.last_ts
        for span in (5.0, 30.0):
            assert session.count_exits(now, span) == _scan_exits(seen, now, span)
            assert session.count_endpoints(now, span) == _scan_endpoints(seen, now, span)


def test_window_opened_late_includes_earlier_events() -> None:
    session = Session(IP, UA)
    for n in range(4):
        session.add(make_request(ts=float(n), path=f"/x{n}"), None)
    assert session.count_exits(3.0, 10.0) == 4
    session.add(make_request(ts=4.0, path="/x4"), None)
    assert session.count_exits(4.0, 10.0) == 5
    assert session.count_endpoints(4.0, 2.0) == 3


def test_query_wider_than_max_window_falls_back_to_scan() -> None:
    session = Session(IP, UA, max_window=10.0)
    for n in range(3):
        session.add(make_request(ts=float(n), path=f"/x{n}"), None)
    assert session.count_exits(2.0, 50.0) == 3


def test_high_rate_listed_session_costs_log_time_per_request() -> None:
    detector = Detector(RouteTable.from_patterns(PATTERNS), Thresholds())
    requests = [req(n / 200, "/") for n in range(20_000)]
    started = time.perf_counter()
    for request in requests:
        assert detector.process(request) == []
    assert time.perf_counter() - started < 5.0


def test_session_idle_past_timeout_restarts_without_a_sweep() -> None:
    detector = Detector(RouteTable.from_patterns(PATTERNS), Thresholds())
    detector.process(req(0.0, "/", ip="9.9.9.9"))
    for n in range(20):
        detector.process(req(10.0 + n, "/"))
    detector.process(req(1801.0, "/", ip="8.8.8.8"))
    verdicts = detector.process(req(3500.0, "/.env"))
    assert [(v.rule, v.request_count) for v in verdicts] == [("R3", 1)]
    session = detector.sessions.get_or_create(req(3500.0, "/"))
    assert session.first_ts == 3500.0


def test_store_restarts_idle_session_on_lookup() -> None:
    store = SessionStore(idle_timeout=100.0)
    old = store.get_or_create(make_request(ts=0.0))
    old.add(make_request(ts=0.0), None)
    assert store.get_or_create(make_request(ts=100.0)) is old
    fresh = store.get_or_create(make_request(ts=100.5))
    assert fresh is not old
    assert fresh.request_count == 0


def test_fired_keys_do_not_hold_rotating_user_agents() -> None:
    detector = Detector(RouteTable.from_patterns(PATTERNS), Thresholds(idle_timeout=1.0))
    padding = "x" * 4096
    tracemalloc.start()
    try:
        before = tracemalloc.get_traced_memory()[0]
        for n in range(2000):
            assert len(detector.process(req(n * 10.0, "/.env", ua=f"{padding}-{n}"))) == 1
        grown = tracemalloc.get_traced_memory()[0] - before
    finally:
        tracemalloc.stop()
    assert len(detector.sessions) <= 1
    assert grown < 1_000_000


def test_fired_key_is_stable_and_accepts_any_user_agent() -> None:
    assert fired_key("1.2.3.4|ua", "R1") == fired_key("1.2.3.4|ua", "R1")
    assert fired_key("1.2.3.4|ua", "R1") != fired_key("1.2.3.4|ua", "R2")
    assert len(fired_key("1.2.3.4|\ud800bad", "R3")) == 16
