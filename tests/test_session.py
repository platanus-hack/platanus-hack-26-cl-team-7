from __future__ import annotations

from helpers import make_request

from engine.config import Thresholds
from engine.routes import RouteMatch
from engine.session import Session, SessionStore

PRODUCTS = RouteMatch(pattern="/products", asset=False)
UA_A = "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0"
UA_B = "python-requests/2.32.3"


def test_new_session_identity() -> None:
    store = SessionStore()
    req = make_request(ip="198.51.100.4", user_agent=UA_A)
    session = store.get_or_create(req)
    assert isinstance(session, Session)
    assert session.id == req.session_id == f"198.51.100.4|{UA_A}"
    assert session.ip == "198.51.100.4"
    assert session.user_agent == UA_A


def test_same_ip_and_ua_share_session() -> None:
    store = SessionStore()
    first = store.get_or_create(make_request(ts=1.0, path="/", user_agent=UA_A))
    second = store.get_or_create(make_request(ts=2.0, path="/products", user_agent=UA_A))
    assert first is second


def test_different_ua_gets_different_session() -> None:
    store = SessionStore()
    a = store.get_or_create(make_request(user_agent=UA_A))
    b = store.get_or_create(make_request(user_agent=UA_B))
    assert a is not b
    assert a.id != b.id


def test_different_ip_gets_different_session() -> None:
    store = SessionStore()
    a = store.get_or_create(make_request(ip="10.0.0.1"))
    b = store.get_or_create(make_request(ip="10.0.0.2"))
    assert a is not b


def test_empty_user_agent_is_its_own_session() -> None:
    store = SessionStore()
    a = store.get_or_create(make_request(user_agent=""))
    b = store.get_or_create(make_request(user_agent=UA_A))
    assert a is not b
    assert a.id == "203.0.113.7|"


def test_add_counts_requests_and_tracks_times() -> None:
    store = SessionStore()
    reqs = [make_request(ts=100.0 + i, path="/products") for i in range(3)]
    session = store.get_or_create(reqs[0])
    for req in reqs:
        session.add(req, PRODUCTS)
    assert session.request_count == 3
    assert session.first_ts == 100.0
    assert session.last_ts == 102.0


def test_add_accepts_unmatched_request() -> None:
    store = SessionStore()
    req = make_request(ts=50.0, path="/.env")
    session = store.get_or_create(req)
    session.add(req, None)
    assert session.request_count == 1
    assert session.first_ts == session.last_ts == 50.0


def test_out_of_order_ts_does_not_crash() -> None:
    store = SessionStore()
    first = make_request(ts=110.0)
    session = store.get_or_create(first)
    session.add(first, PRODUCTS)
    session.add(make_request(ts=90.0, path="/nope"), None)
    session.add(make_request(ts=105.0), PRODUCTS)
    assert session.request_count == 3
    assert session.first_ts <= session.last_ts
    assert session.last_ts == 110.0


def _seen_at(store: SessionStore, ts: float, ip: str = "203.0.113.7") -> Session:
    req = make_request(ts=ts, ip=ip)
    session = store.get_or_create(req)
    session.add(req, None)
    return session


def test_expire_keeps_session_at_exact_timeout() -> None:
    store = SessionStore(idle_timeout=100.0)
    session = _seen_at(store, 1000.0)
    store.expire(1100.0)
    assert store.get_or_create(make_request(ts=1100.0)) is session


def test_expire_drops_session_past_timeout() -> None:
    store = SessionStore(idle_timeout=100.0)
    session = _seen_at(store, 1000.0)
    store.expire(1100.5)
    fresh = store.get_or_create(make_request(ts=1100.5))
    assert fresh is not session
    assert fresh.request_count == 0


def test_expire_uses_last_activity_not_first() -> None:
    store = SessionStore(idle_timeout=100.0)
    session = _seen_at(store, 1000.0)
    session.add(make_request(ts=1090.0), None)
    store.expire(1150.0)
    assert store.get_or_create(make_request(ts=1150.0)) is session


def test_expire_only_drops_idle_sessions() -> None:
    store = SessionStore(idle_timeout=100.0)
    idle = _seen_at(store, 1000.0, ip="10.0.0.1")
    active = _seen_at(store, 1090.0, ip="10.0.0.2")
    store.expire(1150.0)
    assert store.get_or_create(make_request(ip="10.0.0.2")) is active
    assert store.get_or_create(make_request(ip="10.0.0.1")) is not idle


def test_default_idle_timeout_is_1800_seconds() -> None:
    store = SessionStore()
    session = _seen_at(store, 0.0)
    store.expire(1800.0)
    assert store.get_or_create(make_request()) is session
    store.expire(1801.0)
    assert store.get_or_create(make_request()) is not session


def test_expire_on_empty_store_is_noop() -> None:
    store = SessionStore()
    store.expire(1e12)
    assert store.get_or_create(make_request()).request_count == 0


def test_expired_session_restarts_count() -> None:
    store = SessionStore(idle_timeout=10.0)
    old = _seen_at(store, 0.0)
    old.add(make_request(ts=1.0), None)
    store.expire(100.0)
    new = _seen_at(store, 100.0)
    assert new.request_count == 1
    assert new.first_ts == 100.0


STATIC = RouteMatch(pattern="/static/**", asset=True)
USER = RouteMatch(pattern="/api/users/{id}", asset=False)


def _session_with(events: list[tuple[float, str, RouteMatch | None]]) -> Session:
    session = SessionStore().get_or_create(make_request())
    for ts, path, match in events:
        session.add(make_request(ts=ts, path=path), match)
    return session


def test_events_record_exit_and_endpoint() -> None:
    session = _session_with(
        [(1.0, "/products", PRODUCTS), (2.0, "/static/a.js", STATIC), (3.0, "/.env", None)]
    )
    assert list(session.events) == [
        (1.0, False, "/products"),
        (2.0, False, None),
        (3.0, True, "/.env"),
    ]


def test_count_exits_uses_inclusive_window() -> None:
    session = _session_with([(0.0, "/a", None), (5.0, "/b", PRODUCTS), (10.0, "/c", None)])
    assert session.count_exits(now=10.0, window=10.0) == 2
    assert session.count_exits(now=10.0, window=9.9) == 1
    assert session.count_exits(now=5.0, window=10.0) == 1


def test_count_endpoints_dedupes_patterns_and_skips_assets() -> None:
    session = _session_with(
        [
            (1.0, "/api/users/1", USER),
            (2.0, "/api/users/2", USER),
            (3.0, "/static/x.css", STATIC),
            (4.0, "/.git/config", None),
            (5.0, "/.git/config", None),
        ]
    )
    assert session.count_endpoints(now=5.0, window=60.0) == 2
    assert session.count_endpoints(now=5.0, window=1.0) == 1


def test_windows_prune_entries_older_than_max_window() -> None:
    store = SessionStore(max_window=10.0)
    session = store.get_or_create(make_request())
    for ts in range(100):
        session.add(make_request(ts=float(ts), path=f"/p{ts}"), None)
    assert session.request_count == 100
    assert [event.ts for event in session.events] == [float(t) for t in range(89, 100)]


def test_for_thresholds_uses_largest_window_and_idle_timeout() -> None:
    thresholds = Thresholds(r1_window=30.0, r2_window=90.0, idle_timeout=50.0)
    store = SessionStore.for_thresholds(thresholds)
    assert (store.max_window, store.idle_timeout) == (90.0, 50.0)
    assert store.get_or_create(make_request()).max_window == 90.0


def test_store_len_tracks_live_sessions() -> None:
    store = SessionStore(idle_timeout=10.0)
    _seen_at(store, 0.0, ip="10.0.0.1")
    _seen_at(store, 50.0, ip="10.0.0.2")
    assert len(store) == 2
    store.expire(55.0)
    assert len(store) == 1
