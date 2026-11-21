"""Fail-open at the edge (deploy/lanes.caddy handle_errors): when the router is gone, slow or its
lane endpoint answers an error, the request takes the real lane, and so does a real-lane login
whose tap cannot be reached. A mirror-lane tap failure keeps its error, so a mirror-lane request
never reaches real data. Stubs: tests/test_edge_stubs.py."""

from __future__ import annotations

import http.client
import time
from collections.abc import Callable

import pytest
from test_edge_stubs import (
    AGENT_UA,
    BODY,
    FORGED,
    LANE_HANG_S,
    SOFTWARE_HEADERS,
    TRACK_ID,
    Edge,
    Received,
    Reply,
    Stub,
    edge_fixture,
    leave_stale,
    serve,
)

__all__ = ["edge_fixture"]
LOGIN = b"username=ana&password=x"


def _gone(edge: Edge) -> None:
    edge.lane.close()
    edge.tap.close()
    assert not (edge.root / "run" / "lane.sock").exists()


def _crashed(edge: Edge) -> None:
    _gone(edge)
    for name in ("lane", "tap"):
        leave_stale(edge.root / "run" / f"{name}.sock")


def _assert_real_lane(served: Received) -> None:
    assert "X-Lane" not in served.headers and "X-Track-Id" not in served.headers
    assert served.headers["X-Client-Ip"] == "127.0.0.1"
    assert served.headers["X-Request-Id"] != FORGED["X-Request-Id"]


def _assert_clean(reply: Reply) -> None:
    assert not set(SOFTWARE_HEADERS) & reply.headers.keys(), reply.headers
    assert reply.count("date") == 1


@pytest.mark.parametrize("router_down", [_gone, _crashed], ids=["socket-gone", "socket-stale"])
def test_fails_open_to_the_real_shop_when_the_router_is_down(
    edge: Edge, router_down: Callable[[Edge], None]
) -> None:
    router_down(edge)
    page = edge.send("GET", "/products", ua=AGENT_UA, headers=FORGED)
    login = edge.send("POST", "/login", ua=AGENT_UA, body=LOGIN)
    assert (page.status, page.body) == (200, BODY) and login.status == 200
    _assert_clean(page)
    assert edge.tap.seen == []
    first, second = edge.real.seen
    assert first.path == "/products" and (second.path, second.body) == ("/login", LOGIN)
    for served in (first, second):
        _assert_real_lane(served)


def _timed(edge: Edge, method: str, path: str, body: bytes | None = None) -> Reply:
    started = time.monotonic()
    reply = edge.send(method, path, ua=AGENT_UA, body=body)
    assert time.monotonic() - started < LANE_HANG_S, "the edge waited for the slow lane"
    return reply


def test_fails_open_when_the_lane_endpoint_does_not_answer_in_time(edge: Edge) -> None:
    edge.lane.hang_s = LANE_HANG_S
    page = _timed(edge, "GET", "/products")
    login = _timed(edge, "POST", "/api/session", LOGIN)
    assert (page.status, page.body) == (200, BODY) and login.status == 200
    first, second = edge.real.seen
    assert first.path == "/products" and second.body == LOGIN, "the slow lane ate the body"
    assert edge.tap.seen == []
    assert len(edge.lane.seen) == 2, "a lane request that was sent must not be sent again"


def test_fails_open_when_the_lane_endpoint_drops_the_connection(edge: Edge) -> None:
    edge.lane.drop = True
    reply = edge.send("GET", "/products", ua=AGENT_UA)
    assert (reply.status, reply.body) == (200, BODY)
    assert len(edge.lane.seen) == len(edge.real.seen) == 1 and edge.tap.seen == []


@pytest.mark.parametrize("status", [http.client.FOUND, http.client.INTERNAL_SERVER_ERROR])
def test_lane_error_answer_is_never_shown_and_counts_as_the_real_lane(
    edge: Edge, status: int
) -> None:
    edge.lane.status = status
    reply = edge.send("GET", "/products", ua=AGENT_UA)
    assert (reply.status, reply.body) == (200, BODY)
    _assert_clean(reply)
    [served] = edge.real.seen
    _assert_real_lane(served)
    assert edge.tap.seen == []


def test_mirror_lane_tap_failure_never_falls_through_to_real_data(edge: Edge) -> None:
    edge.tap.close()
    page = edge.send("GET", "/api/users/1", ua=AGENT_UA)
    login = edge.send("POST", "/login", ua=AGENT_UA, body=LOGIN)
    assert page.status == login.status == http.client.BAD_GATEWAY
    _assert_clean(page)
    assert edge.real.seen == []


def test_real_lane_login_fails_open_when_only_the_tap_is_unreachable(edge: Edge) -> None:
    edge.tap.close()
    reply = edge.send("POST", "/login/", body=LOGIN)
    assert (reply.status, reply.body) == (200, BODY)
    _assert_clean(reply)
    [served] = edge.real.seen
    assert (served.path, served.body) == ("/login/", LOGIN)
    _assert_real_lane(served)


def test_real_shop_failure_keeps_its_error(edge: Edge) -> None:
    edge.real.close()
    reply = edge.send("GET", "/products")
    assert reply.status == http.client.BAD_GATEWAY
    _assert_clean(reply)
    assert edge.tap.seen == []


def test_mirror_routing_resumes_when_the_lane_endpoint_comes_back(edge: Edge) -> None:
    edge.lane.close()
    edge.send("GET", "/products", ua=AGENT_UA)
    edge.lane = serve(Stub("lane"), edge.root / "run" / "lane.sock")
    edge.send("GET", "/products", ua=AGENT_UA)
    assert [s.path for s in edge.real.seen] == ["/products"]
    [served] = edge.tap.seen
    assert served.headers["X-Lane"] == "mirror" and served.headers["X-Track-Id"] == TRACK_ID
