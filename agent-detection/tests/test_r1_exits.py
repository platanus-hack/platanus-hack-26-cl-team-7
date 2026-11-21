"""Level-1 rule tests for R1 (contract exits), driven through the Detector.

R2 and R3 are switched off by thresholds so each verdict seen here can only come from R1.
"""

from __future__ import annotations

from engine.config import Thresholds
from engine.detector import Detector
from engine.models import Request, Verdict
from engine.routes import RouteTable

UA = "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0"
IP = "203.0.113.7"

PATTERNS: list[dict[str, object]] = [
    {"pattern": "/"},
    {"pattern": "/search"},
    {"pattern": "/products/{id}"},
    {"pattern": "/cart"},
    {"pattern": "/login", "methods": ["GET", "POST"]},
    {"pattern": "/static/**", "asset": True},
]


def make_detector(min_exits: int = 5, window: float = 300.0) -> Detector:
    thresholds = Thresholds(
        r1_min_exits=min_exits,
        r1_window=window,
        r2_max_endpoints=100_000,
        r3_enabled=False,
    )
    return Detector(RouteTable.from_patterns(PATTERNS), thresholds)


def req(ts: float, path: str, method: str = "GET", ip: str = IP, ua: str = UA) -> Request:
    return Request(ts=ts, ip=ip, user_agent=ua, method=method, path=path, query="", status=404)


def exits(times: list[float]) -> list[Request]:
    return [req(t, f"/missing-{i}") for i, t in enumerate(times)]


def r1_verdicts(detector: Detector, requests: list[Request]) -> list[tuple[int, Verdict]]:
    found: list[tuple[int, Verdict]] = []
    for index, request in enumerate(requests):
        found.extend((index, v) for v in detector.process(request) if v.rule == "R1")
    return found


def test_fires_at_exactly_five_exits_within_window() -> None:
    hits = r1_verdicts(make_detector(), exits([0.0, 1.0, 2.0, 3.0, 4.0]))
    assert [index for index, _ in hits] == [4]


def test_does_not_fire_at_four_exits() -> None:
    assert r1_verdicts(make_detector(), exits([0.0, 1.0, 2.0, 3.0])) == []


def test_fires_when_five_exits_span_exactly_300_seconds() -> None:
    hits = r1_verdicts(make_detector(), exits([0.0, 75.0, 150.0, 225.0, 300.0]))
    assert [index for index, _ in hits] == [4]


def test_does_not_fire_when_five_exits_span_301_seconds() -> None:
    assert r1_verdicts(make_detector(), exits([0.0, 75.0, 150.0, 225.0, 301.0])) == []


def test_sliding_window_drops_old_exits() -> None:
    times = [0.0, 1.0, 2.0, 3.0, 400.0, 401.0, 402.0, 403.0]
    assert r1_verdicts(make_detector(), exits(times)) == []


def test_sliding_window_fires_once_new_window_reaches_five() -> None:
    times = [0.0, 1.0, 2.0, 3.0, 400.0, 401.0, 402.0, 403.0, 404.0]
    hits = r1_verdicts(make_detector(), exits(times))
    assert [index for index, _ in hits] == [8]


def test_repeating_the_same_unlisted_path_counts_every_request() -> None:
    requests = [req(float(t), "/admin") for t in range(5)]
    hits = r1_verdicts(make_detector(), requests)
    assert [index for index, _ in hits] == [4]


def test_listed_routes_are_not_exits() -> None:
    paths = ["/", "/search", "/products/1", "/products/2", "/cart", "/login"] * 3
    requests = [req(float(t), p) for t, p in enumerate(paths)]
    assert r1_verdicts(make_detector(), requests) == []


def test_asset_routes_are_listed_so_not_exits() -> None:
    requests = [req(float(t), f"/static/img/{t}.png") for t in range(20)]
    assert r1_verdicts(make_detector(), requests) == []


def test_listed_requests_between_exits_do_not_count() -> None:
    requests: list[Request] = []
    for t in range(4):
        requests.append(req(float(2 * t), f"/missing-{t}"))
        requests.append(req(float(2 * t + 1), "/search"))
    assert r1_verdicts(make_detector(), requests) == []


def test_listed_requests_between_exits_do_not_block_firing() -> None:
    requests: list[Request] = []
    for t in range(5):
        requests.append(req(float(2 * t), "/products/9"))
        requests.append(req(float(2 * t + 1), f"/missing-{t}"))
    hits = r1_verdicts(make_detector(), requests)
    assert [index for index, _ in hits] == [9]


def test_method_outside_route_methods_is_an_exit() -> None:
    requests = [req(float(t), "/login", method="DELETE") for t in range(5)]
    hits = r1_verdicts(make_detector(), requests)
    assert [index for index, _ in hits] == [4]


def test_allowed_methods_on_restricted_route_are_not_exits() -> None:
    methods = ["GET", "POST"] * 5
    requests = [req(float(t), "/login", method=m) for t, m in enumerate(methods)]
    assert r1_verdicts(make_detector(), requests) == []


def test_fires_only_once_per_session() -> None:
    hits = r1_verdicts(make_detector(), exits([float(t) for t in range(30)]))
    assert len(hits) == 1


def test_exits_of_other_sessions_do_not_add_up() -> None:
    requests = [req(float(t), f"/missing-{t}", ip=f"198.51.100.{t}") for t in range(10)]
    assert r1_verdicts(make_detector(), requests) == []


def test_verdict_fields_describe_the_trigger() -> None:
    hits = r1_verdicts(make_detector(), exits([10.0, 11.0, 12.0, 13.0, 14.5]))
    assert len(hits) == 1
    verdict = hits[0][1]
    assert verdict.rule == "R1"
    assert verdict.critical is False
    assert verdict.verdict == "probing"
    assert verdict.ts == 14.5
    assert verdict.request_count == 5
    assert verdict.ip == IP
    assert verdict.user_agent == UA
    assert verdict.session_id == f"{IP}|{UA}"
    assert verdict.reason.strip() != ""


def test_custom_thresholds_are_honoured() -> None:
    detector = make_detector(min_exits=3, window=10.0)
    hits = r1_verdicts(detector, exits([0.0, 5.0, 10.0]))
    assert [index for index, _ in hits] == [2]


def test_custom_window_excludes_exit_just_outside() -> None:
    detector = make_detector(min_exits=3, window=10.0)
    assert r1_verdicts(detector, exits([0.0, 5.0, 10.5])) == []


def test_subsecond_boundary_is_inclusive() -> None:
    hits = r1_verdicts(make_detector(), exits([0.25, 100.0, 200.0, 250.0, 300.25]))
    assert [index for index, _ in hits] == [4]
