"""deploy/Caddyfile.local and deploy/Caddyfile, adapted and run by a real Caddy: lane routing,
the headers the edge sets and strips, identical answers on both lanes, and the access log.
Fail-open cases are in tests/test_edge_failopen.py; the stubs in tests/test_edge_stubs.py."""

from __future__ import annotations

import http.client
import json
import os
import subprocess
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest
from test_edge_stubs import (
    AGENT_UA,
    BODY,
    CADDYFILE,
    FORGED,
    HUMAN_UA,
    REPO,
    SOFTWARE_HEADERS,
    STALE_DATE,
    STARTUP_S,
    TRACK_ID,
    Edge,
    caddy_path,
    edge_fixture,
)

from engine.routes import RouteTable

COMPOSE_CADDYFILE = REPO / "deploy" / "Caddyfile"
# A burst well past the stubs' listen queue of one: refused dials must be retried, never fail open.
PARALLEL = 64
WORKERS = 32
# The shop serves each login route with or without one trailing slash (engine.routes).
LOGIN_PATHS = ["/login", "/login/", "/api/session", "/api/session/"]
__all__ = ["edge_fixture"]


def _adapt(caddyfile: Path) -> dict[str, Any]:
    command = [caddy_path(), "adapt", "--config", str(caddyfile), "--adapter", "caddyfile"]
    env = {k: v for k, v in os.environ.items() if k != "STACK_EDGE_PORT"}
    out = subprocess.run(command, check=True, capture_output=True, text=True, timeout=30, env=env)
    config: dict[str, Any] = json.loads(out.stdout)
    return config


def _dicts(node: object) -> Iterator[dict[str, Any]]:
    if isinstance(node, dict):
        yield node
        node = list(node.values())
    if isinstance(node, list):
        for item in node:
            yield from _dicts(item)


def test_local_caddyfile_validates(tmp_path: Path) -> None:
    command = [caddy_path(), "validate", "--config", str(CADDYFILE), "--adapter", "caddyfile"]
    done = subprocess.run(
        command, check=False, cwd=tmp_path, capture_output=True, text=True, timeout=30
    )
    assert done.returncode == 0, done.stderr


def test_compose_and_local_edges_route_alike_apart_from_the_socket_folder() -> None:
    def routing(caddyfile: Path, socket_dir: str) -> str:
        server = json.dumps(_adapt(caddyfile)["apps"])
        assert f'"unix/{socket_dir}/lane.sock"' in server
        return server.replace(f"unix/{socket_dir}/", "unix/<sockets>/")

    local = json.loads(routing(CADDYFILE, "run"))["http"]["servers"]["srv0"]
    compose = json.loads(routing(COMPOSE_CADDYFILE, "/run/edge"))["http"]["servers"]["srv0"]
    assert (local["listen"], compose["listen"]) == ([":8080"], [":80"])
    assert local["routes"] == compose["routes"] and local["errors"] == compose["errors"]


def test_login_matcher_takes_every_form_of_the_shops_login_routes() -> None:
    [login] = [m["path"] for m in _dicts(_adapt(CADDYFILE)) if m.get("method") == ["POST"]]
    assert sorted(login) == sorted(LOGIN_PATHS)
    shop = RouteTable.from_yaml(REPO / "config" / "routes.yaml")
    served = {path: shop.match("POST", path) for path in LOGIN_PATHS}
    assert {path: m and m.pattern for path, m in served.items()} == {
        path: path.rstrip("/") for path in LOGIN_PATHS
    }


def test_real_lane_reaches_the_real_shop_with_edge_set_headers_only(edge: Edge) -> None:
    credentials = {"Cookie": "session=abc", "Authorization": "Bearer abc"}
    reply = edge.send("GET", "/products?id=7", headers={**FORGED, **credentials})
    assert (reply.status, reply.body) == (200, BODY)
    assert edge.tap.seen == []
    [asked] = edge.lane.seen
    assert (asked.method, asked.path) == ("GET", "/lane")
    assert asked.headers["X-Forwarded-Method"] == "GET"
    assert asked.headers["X-Forwarded-Uri"] == "/products?id=7"
    assert asked.headers["X-Client-Ip"] == "127.0.0.1"
    assert asked.headers["User-Agent"] == HUMAN_UA
    assert {name: asked.headers[name] for name in credentials} == credentials
    assert "X-Lane" not in asked.headers and "X-Track-Id" not in asked.headers
    [served] = edge.real.seen
    assert served.path == "/products?id=7"
    assert "X-Lane" not in served.headers and "X-Track-Id" not in served.headers
    assert served.headers["X-Client-Ip"] == "127.0.0.1"
    request_id = served.headers["X-Request-Id"]
    assert request_id == asked.headers["X-Request-Id"] != FORGED["X-Request-Id"]
    assert len(request_id) == len("00000000-0000-0000-0000-000000000000")


def test_each_request_gets_its_own_request_id(edge: Edge) -> None:
    edge.send("GET", "/")
    edge.send("GET", "/")
    ids = {seen.headers["X-Request-Id"] for seen in edge.real.seen}
    assert len(ids) == len(edge.real.seen) == 2


def test_mirror_lane_reaches_the_tap_with_its_track_and_body(edge: Edge) -> None:
    reply = edge.send("POST", "/api/cart", ua=AGENT_UA, body=b'{"sku": 1}', headers=FORGED)
    assert (reply.status, reply.body) == (200, BODY)
    assert edge.real.seen == []
    [served] = edge.tap.seen
    assert (served.method, served.path, served.body) == ("POST", "/api/cart", b'{"sku": 1}')
    assert served.headers["X-Lane"] == "mirror" and served.headers["X-Track-Id"] == TRACK_ID
    assert served.headers["X-Client-Ip"] == "127.0.0.1"
    [asked] = edge.lane.seen
    assert asked.headers["X-Forwarded-Method"] == "POST" and asked.body == b""


@pytest.mark.parametrize("path", LOGIN_PATHS)
def test_login_posts_take_the_tap_on_the_real_lane_too(edge: Edge, path: str) -> None:
    edge.send("POST", f"{path}?next=/account", body=b"username=ana&password=x")
    [served] = edge.tap.seen
    assert (served.path, served.body) == (f"{path}?next=/account", b"username=ana&password=x")
    assert served.headers["X-Lane"] == "real" and "X-Track-Id" not in served.headers
    assert edge.real.seen == []


@pytest.mark.parametrize("path", LOGIN_PATHS)
def test_login_posts_on_the_mirror_lane_take_the_tap_with_the_track(edge: Edge, path: str) -> None:
    edge.send("POST", path, ua=AGENT_UA, body=b"username=ana&password=x")
    [served] = edge.tap.seen
    assert served.headers["X-Lane"] == "mirror" and served.headers["X-Track-Id"] == TRACK_ID
    assert edge.real.seen == []


def test_login_page_get_and_other_posts_stay_on_the_real_shop(edge: Edge) -> None:
    edge.send("GET", "/login")
    edge.send("POST", "/api/cart", body=b"{}")
    edge.send("POST", "/login/extra", body=b"{}")
    edge.send("POST", "/api/sessions", body=b"{}")
    paths = ["/login", "/api/cart", "/login/extra", "/api/sessions"]
    assert [s.path for s in edge.real.seen] == paths
    assert edge.tap.seen == []


def test_both_lanes_answer_with_identical_headers(edge: Edge) -> None:
    real = edge.send("GET", "/products")
    mirror = edge.send("GET", "/products", ua=AGENT_UA)
    assert len(edge.real.seen) == len(edge.tap.seen) == 1
    for reply in (real, mirror):
        assert not set(SOFTWARE_HEADERS) & reply.headers.keys(), reply.headers
        assert reply.count("date") == 1 and reply.headers["date"] != STALE_DATE
    real.headers.pop("date")
    mirror.headers.pop("date")
    assert real.headers == mirror.headers
    assert real.body == mirror.body


def test_a_burst_of_parallel_requests_keeps_every_request_on_its_lane(edge: Edge) -> None:
    def one(i: int) -> int:
        ua = AGENT_UA if i % 2 else HUMAN_UA
        return edge.send("GET", f"/products/{i}", ua=ua).status

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        assert set(pool.map(one, range(PARALLEL))) == {200}
    mirrored = sorted(int(s.path.rsplit("/", 1)[1]) for s in edge.tap.seen)
    real = sorted(int(s.path.rsplit("/", 1)[1]) for s in edge.real.seen)
    assert mirrored == list(range(1, PARALLEL, 2)) and real == list(range(0, PARALLEL, 2))
    assert all(s.headers["X-Track-Id"] == TRACK_ID for s in edge.tap.seen)
    assert all("X-Track-Id" not in s.headers for s in edge.real.seen)
    assert len({s.headers["X-Request-Id"] for s in edge.lane.seen}) == PARALLEL


def test_a_get_that_reached_its_upstream_is_never_sent_again(edge: Edge) -> None:
    edge.tap.drop = True
    reply = edge.send("GET", "/products", ua=AGENT_UA)
    assert reply.status == http.client.BAD_GATEWAY
    assert len(edge.tap.seen) == len(edge.lane.seen) == 1
    assert edge.real.seen == []


def test_access_log_keeps_its_redaction(edge: Edge) -> None:
    password_change = "/rest/user/change-password?current=a&new=b&repeat=b"
    edge.send("GET", password_change, headers={"Cookie": "sid=1"})
    log = edge.root / "run" / "access.log"
    deadline = time.monotonic() + STARTUP_S
    while not (log.exists() and log.read_text().strip()) and time.monotonic() < deadline:
        time.sleep(0.05)
    entry = json.loads(log.read_text().splitlines()[-1])
    assert "Cookie" not in entry["request"]["headers"]
    assert entry["request"]["uri"].endswith("current=REDACTED&new=REDACTED&repeat=REDACTED")
