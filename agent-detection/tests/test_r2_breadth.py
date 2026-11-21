"""Level-1 rule tests for R2 (endpoint breadth), driven through the Detector.

R1 and R3 are switched off by thresholds so each verdict seen here can only come from R2.
"""

from __future__ import annotations

from engine.config import Thresholds
from engine.detector import Detector
from engine.models import Request, Verdict
from engine.routes import RouteTable

UA = "python-requests/2.32.3"
IP = "192.0.2.44"

PATTERNS: list[dict[str, object]] = [
    {"pattern": "/"},
    {"pattern": "/search"},
    {"pattern": "/products"},
    {"pattern": "/products/{id}"},
    {"pattern": "/cart"},
    {"pattern": "/checkout"},
    {"pattern": "/login", "methods": ["GET", "POST"]},
    {"pattern": "/about"},
    {"pattern": "/contact"},
    {"pattern": "/faq"},
    {"pattern": "/api/users/{id}"},
    {"pattern": "/api/search"},
    {"pattern": "/api/cart"},
    {"pattern": "/static/**", "asset": True},
    {"pattern": "/assets/**", "asset": True},
]

ENDPOINT_PATHS = [
    "/",
    "/search",
    "/products",
    "/products/12",
    "/cart",
    "/checkout",
    "/login",
    "/about",
    "/contact",
    "/faq",
    "/api/search",
    "/api/cart",
]


def make_detector(max_endpoints: int = 10, window: float = 60.0) -> Detector:
    thresholds = Thresholds(
        r1_min_exits=100_000,
        r2_max_endpoints=max_endpoints,
        r2_window=window,
        r3_enabled=False,
    )
    return Detector(RouteTable.from_patterns(PATTERNS), thresholds)


def req(ts: float, path: str, method: str = "GET", ip: str = IP) -> Request:
    return Request(ts=ts, ip=ip, user_agent=UA, method=method, path=path, query="", status=200)


def spaced(paths: list[str], step: float = 1.0, start: float = 0.0) -> list[Request]:
    return [req(start + i * step, p) for i, p in enumerate(paths)]


def r2_verdicts(detector: Detector, requests: list[Request]) -> list[tuple[int, Verdict]]:
    found: list[tuple[int, Verdict]] = []
    for index, request in enumerate(requests):
        found.extend((index, v) for v in detector.process(request) if v.rule == "R2")
    return found


def fired_at(detector: Detector, requests: list[Request]) -> list[int]:
    return [index for index, _ in r2_verdicts(detector, requests)]


def test_fires_at_eleven_distinct_endpoints_in_window() -> None:
    assert fired_at(make_detector(), spaced(ENDPOINT_PATHS[:11])) == [10]


def test_does_not_fire_at_ten_distinct_endpoints() -> None:
    assert fired_at(make_detector(), spaced(ENDPOINT_PATHS[:10])) == []


def test_fires_when_eleven_endpoints_span_exactly_60_seconds() -> None:
    requests = spaced(ENDPOINT_PATHS[:11], step=6.0)
    assert requests[-1].ts == 60.0
    assert fired_at(make_detector(), requests) == [10]


def test_does_not_fire_when_eleven_endpoints_span_61_seconds() -> None:
    requests = spaced(ENDPOINT_PATHS[:10], step=6.0) + [req(61.0, ENDPOINT_PATHS[10])]
    assert fired_at(make_detector(), requests) == []


def test_ids_of_one_pattern_count_once() -> None:
    paths = ENDPOINT_PATHS[:9] + ["/api/users/1", "/api/users/2"]
    assert fired_at(make_detector(), spaced(paths)) == []


def test_many_ids_of_one_pattern_count_once() -> None:
    paths = ENDPOINT_PATHS[:9] + [f"/api/users/{n}" for n in range(1, 50)]
    assert fired_at(make_detector(), spaced(paths, step=0.5)) == []


def test_pattern_counted_once_still_reaches_threshold() -> None:
    paths = ENDPOINT_PATHS[:9] + ["/api/users/1", "/api/users/2", ENDPOINT_PATHS[9]]
    assert fired_at(make_detector(), spaced(paths)) == [11]


def test_product_ids_share_one_endpoint() -> None:
    paths = ENDPOINT_PATHS[:3] + [f"/products/{n}" for n in range(30)] + ENDPOINT_PATHS[4:10]
    assert fired_at(make_detector(), spaced(paths, step=0.5)) == []


def test_asset_routes_never_count() -> None:
    assets = [f"/static/js/chunk-{n}.js" for n in range(40)]
    assets += [f"/assets/img/{n}.webp" for n in range(40)]
    requests = spaced(ENDPOINT_PATHS[:10] + assets, step=0.2)
    assert fired_at(make_detector(), requests) == []


def test_asset_routes_never_count_even_with_zero_limit() -> None:
    requests = spaced([f"/static/app.{n}.css" for n in range(20)])
    assert fired_at(make_detector(max_endpoints=0), requests) == []


def test_unlisted_paths_count_as_raw_path_endpoints() -> None:
    paths = [f"/probe-{n}" for n in range(11)]
    assert fired_at(make_detector(), spaced(paths)) == [10]


def test_same_unlisted_path_counts_once() -> None:
    paths = ENDPOINT_PATHS[:9] + ["/wp-login.php"] * 20
    assert fired_at(make_detector(), spaced(paths, step=0.5)) == []


def test_unlisted_and_listed_endpoints_add_up() -> None:
    paths = ENDPOINT_PATHS[:6] + [f"/probe-{n}" for n in range(5)]
    assert fired_at(make_detector(), spaced(paths)) == [10]


def test_methods_of_one_pattern_count_once() -> None:
    requests = spaced(ENDPOINT_PATHS[:6] + ENDPOINT_PATHS[7:10])
    requests += [req(20.0, "/login", "GET"), req(21.0, "/login", "POST")]
    assert fired_at(make_detector(), requests) == []


def test_repeating_one_endpoint_never_fires() -> None:
    requests = [req(t * 0.1, "/search") for t in range(500)]
    assert fired_at(make_detector(), requests) == []


def test_sliding_window_forgets_old_endpoints() -> None:
    first = spaced(ENDPOINT_PATHS[:6])
    later = spaced(ENDPOINT_PATHS[6:12], start=100.0)
    assert fired_at(make_detector(), first + later) == []


def test_old_endpoint_seen_again_counts_inside_new_window() -> None:
    first = spaced(ENDPOINT_PATHS[:6])
    later = spaced(ENDPOINT_PATHS[6:12] + ENDPOINT_PATHS[:5], start=100.0)
    assert fired_at(make_detector(), first + later) == [16]


def test_fires_only_once_per_session() -> None:
    paths = ENDPOINT_PATHS + [f"/probe-{n}" for n in range(40)]
    assert len(fired_at(make_detector(), spaced(paths, step=0.5))) == 1


def test_endpoints_of_other_sessions_do_not_add_up() -> None:
    requests = [req(float(i), p, ip=f"198.51.100.{i}") for i, p in enumerate(ENDPOINT_PATHS)]
    assert fired_at(make_detector(), requests) == []


def test_verdict_fields_describe_the_trigger() -> None:
    hits = r2_verdicts(make_detector(), spaced(ENDPOINT_PATHS[:11], step=2.5, start=1000.0))
    assert len(hits) == 1
    verdict = hits[0][1]
    assert verdict.rule == "R2"
    assert verdict.critical is False
    assert verdict.verdict == "probing"
    assert verdict.ts == 1025.0
    assert verdict.request_count == 11
    assert verdict.session_id == f"{IP}|{UA}"
    assert verdict.reason.strip() != ""


def test_custom_thresholds_are_honoured() -> None:
    detector = make_detector(max_endpoints=3, window=5.0)
    assert fired_at(detector, spaced(ENDPOINT_PATHS[:4])) == [3]


def test_custom_window_excludes_endpoint_just_outside() -> None:
    detector = make_detector(max_endpoints=3, window=5.0)
    requests = spaced(ENDPOINT_PATHS[:3], step=2.5)
    requests.append(req(5.5, ENDPOINT_PATHS[3]))
    assert fired_at(detector, requests) == []
