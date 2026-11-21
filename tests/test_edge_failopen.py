"""Fail-open at the edge (deploy/lanes.caddy handle_errors): when the router's lane endpoint is
gone, slow or answers an error, the request takes the real lane; a tap failure keeps its error,
so a mirror-lane request never reaches real data. Stubs: tests/test_edge_stubs.py."""

from __future__ import annotations

import http.client
import time

import pytest
from test_edge_stubs import (
    AGENT_UA,
    BODY,
    FORGED,
    LANE_HANG_S,
    SOFTWARE_HEADERS,
    TRACK_ID,
    Edge,
    Stub,
    edge_fixture,
    serve,
)

__all__ = ["edge_fixture"]


def test_fails_open_to_the_real_shop_when_the_lane_socket_is_gone(edge: Edge) -> None:
    edge.lane.close()
    assert not (edge.root / "run" / "lane.sock").exists()
    page = edge.send("GET", "/products", ua=AGENT_UA, **FORGED)
    login = edge.send("POST", "/login", body=b"username=ana&password=x")
    assert (page.status, page.body) == (200, BODY) and login.status == 200
    assert not set(SOFTWARE_HEADERS) & page.headers.keys(), page.headers
    assert edge.tap.seen == []
    first, second = edge.real.seen
    assert first.path == "/products" and second.body == b"username=ana&password=x"
    for served in (first, second):
        assert "X-Lane" not in served.headers and "X-Track-Id" not in served.headers
        assert served.headers["X-Client-Ip"] == "127.0.0.1"
        assert served.headers["X-Request-Id"] != FORGED["X-Request-Id"]


def test_fails_open_when_the_lane_endpoint_does_not_answer_in_time(edge: Edge) -> None:
    edge.lane.hang_s = LANE_HANG_S
    started = time.monotonic()
    reply = edge.send("GET", "/products", ua=AGENT_UA)
    assert (reply.status, reply.body) == (200, BODY)
    assert time.monotonic() - started < LANE_HANG_S
    assert [s.path for s in edge.real.seen] == ["/products"] and edge.tap.seen == []


@pytest.mark.parametrize("status", [http.client.FOUND, http.client.INTERNAL_SERVER_ERROR])
def test_lane_error_answer_is_never_shown_and_counts_as_the_real_lane(
    edge: Edge, status: int
) -> None:
    edge.lane.status = status
    reply = edge.send("GET", "/products", ua=AGENT_UA)
    assert (reply.status, reply.body) == (200, BODY)
    assert not set(SOFTWARE_HEADERS) & reply.headers.keys(), reply.headers
    [served] = edge.real.seen
    assert "X-Lane" not in served.headers and "X-Track-Id" not in served.headers
    assert edge.tap.seen == []


def test_tap_failure_never_falls_through_to_real_data(edge: Edge) -> None:
    edge.tap.close()
    reply = edge.send("GET", "/api/users/1", ua=AGENT_UA)
    assert reply.status == http.client.BAD_GATEWAY
    assert edge.real.seen == []


def test_mirror_routing_resumes_when_the_lane_endpoint_comes_back(edge: Edge) -> None:
    edge.lane.close()
    edge.send("GET", "/products", ua=AGENT_UA)
    edge.lane = serve(Stub("lane"), edge.root / "run" / "lane.sock")
    edge.send("GET", "/products", ua=AGENT_UA)
    assert [s.path for s in edge.real.seen] == ["/products"]
    [served] = edge.tap.seen
    assert served.headers["X-Lane"] == "mirror" and served.headers["X-Track-Id"] == TRACK_ID
