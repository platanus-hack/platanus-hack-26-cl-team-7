"""GET /robots.txt at the edge (deploy/lanes.caddy), run by a real Caddy: both lanes get it from
the router's robots listener, the lane endpoint still sees the request first, and a listener that
is down fails open on the real lane only. Stubs: tests/test_edge_stubs.py."""

from __future__ import annotations

import http.client

import pytest
from test_edge_stubs import (
    AGENT_UA,
    BODY,
    FORGED,
    HUMAN_UA,
    SOFTWARE_HEADERS,
    TRACK_ID,
    Edge,
    edge_fixture,
    leave_stale,
)

__all__ = ["edge_fixture"]
ROBOTS = "/robots.txt"


def test_real_lane_robots_comes_from_the_router_with_edge_set_headers(edge: Edge) -> None:
    reply = edge.send("GET", ROBOTS, headers=FORGED)
    assert (reply.status, reply.body) == (200, BODY)
    assert not set(SOFTWARE_HEADERS) & reply.headers.keys(), reply.headers
    assert reply.count("date") == 1
    [asked] = edge.lane.seen
    assert asked.headers["X-Forwarded-Uri"] == ROBOTS, "the rules still see the request"
    [served] = edge.robots.seen
    assert (served.method, served.path) == ("GET", ROBOTS)
    assert served.headers["X-Client-Ip"] == "127.0.0.1"
    assert served.headers["User-Agent"] == HUMAN_UA
    assert served.headers["X-Request-Id"] == asked.headers["X-Request-Id"]
    assert served.headers["X-Request-Id"] != FORGED["X-Request-Id"]
    assert edge.real.seen == [] and edge.tap.seen == []


def test_mirror_lane_robots_comes_from_the_router_too(edge: Edge) -> None:
    reply = edge.send("GET", ROBOTS + "?v=2", ua=AGENT_UA)
    assert (reply.status, reply.body) == (200, BODY)
    assert not set(SOFTWARE_HEADERS) & reply.headers.keys(), reply.headers
    [served] = edge.robots.seen
    assert served.path == ROBOTS + "?v=2"
    assert served.headers["X-Lane"] == "mirror" and served.headers["X-Track-Id"] == TRACK_ID
    assert served.headers["X-Client-Ip"] == "127.0.0.1"
    assert edge.real.seen == [] and edge.tap.seen == []


def test_both_lanes_get_the_same_answer_headers(edge: Edge) -> None:
    real, mirror = edge.send("GET", ROBOTS), edge.send("GET", ROBOTS, ua=AGENT_UA)
    drop = {"date"}
    assert {k: v for k, v in real.headers.items() if k not in drop} == {
        k: v for k, v in mirror.headers.items() if k not in drop
    }


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", ROBOTS),
        ("GET", "/robots.txt/"),
        ("GET", "/robots.txt.bak"),
        ("GET", "/a/robots.txt"),
        ("GET", "/ROBOTS.TXT"),
        ("GET", "/Robots.txt"),
        ("GET", "/./robots.txt"),
        ("GET", "/x/../robots.txt"),
    ],
)
def test_only_a_get_of_robots_goes_to_the_listener(edge: Edge, method: str, path: str) -> None:
    human = edge.send(method, path, body=b"" if method == "POST" else None)
    agent = edge.send(method, path, ua=AGENT_UA, body=b"" if method == "POST" else None)
    assert human.status == agent.status == 200
    assert edge.robots.seen == []
    assert [s.path for s in edge.real.seen] == [path]
    assert [s.path for s in edge.tap.seen] == [path]


@pytest.mark.parametrize("stale", [False, True], ids=["socket-gone", "socket-stale"])
def test_real_lane_robots_fails_open_to_the_shop_when_the_listener_is_down(
    edge: Edge, stale: bool
) -> None:
    edge.robots.close()
    if stale:
        leave_stale(edge.root / "run" / "robots.sock")
    reply = edge.send("GET", ROBOTS)
    assert (reply.status, reply.body) == (200, BODY)
    assert not set(SOFTWARE_HEADERS) & reply.headers.keys(), reply.headers
    [served] = edge.real.seen
    assert served.path == ROBOTS
    assert "X-Lane" not in served.headers and "X-Track-Id" not in served.headers


def test_mirror_lane_robots_keeps_its_error_when_the_listener_is_down(edge: Edge) -> None:
    edge.robots.close()
    reply = edge.send("GET", ROBOTS, ua=AGENT_UA)
    assert reply.status == http.client.BAD_GATEWAY
    assert edge.real.seen == [], "a mirror-lane request never reaches the real shop"
    assert edge.tap.seen == []


def test_robots_is_the_shops_own_when_the_lane_endpoint_is_down(edge: Edge) -> None:
    edge.lane.close()
    reply = edge.send("GET", ROBOTS, ua=AGENT_UA)
    assert (reply.status, reply.body) == (200, BODY)
    assert [s.path for s in edge.real.seen] == [ROBOTS], "no lane answer is the real lane"
    assert edge.robots.seen == [] and edge.tap.seen == []
