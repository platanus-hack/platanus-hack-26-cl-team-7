"""deploy/Caddyfile.local and deploy/Caddyfile, adapted and run by a real Caddy: lane routing,
the headers the edge sets and strips, identical answers on both lanes, and the access log.
Fail-open cases are in tests/test_edge_failopen.py; the stubs in tests/test_edge_stubs.py."""

from __future__ import annotations

import json
import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from test_edge_stubs import (
    AGENT_UA,
    BODY,
    CADDYFILE,
    FORGED,
    HUMAN_UA,
    REPO,
    SOFTWARE_HEADERS,
    STARTUP_S,
    TRACK_ID,
    Edge,
    caddy_path,
    edge_fixture,
)

COMPOSE_CADDYFILE = REPO / "deploy" / "Caddyfile"
PARALLEL = 24
__all__ = ["edge_fixture"]


def _adapt(caddyfile: Path) -> dict[str, object]:
    command = [caddy_path(), "adapt", "--config", str(caddyfile), "--adapter", "caddyfile"]
    env = {k: v for k, v in os.environ.items() if k != "STACK_EDGE_PORT"}
    out = subprocess.run(command, check=True, capture_output=True, text=True, timeout=30, env=env)
    config: dict[str, object] = json.loads(out.stdout)
    return config


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


def test_real_lane_reaches_the_real_shop_with_edge_set_headers_only(edge: Edge) -> None:
    reply = edge.send("GET", "/products?id=7", **FORGED)
    assert (reply.status, reply.body) == (200, BODY)
    assert edge.tap.seen == []
    [asked] = edge.lane.seen
    assert (asked.method, asked.path) == ("GET", "/lane")
    assert asked.headers["X-Forwarded-Method"] == "GET"
    assert asked.headers["X-Forwarded-Uri"] == "/products?id=7"
    assert asked.headers["X-Client-Ip"] == "127.0.0.1"
    assert asked.headers["User-Agent"] == HUMAN_UA
    assert "X-Lane" not in asked.headers and "X-Track-Id" not in asked.headers
    [served] = edge.real.seen
    assert served.path == "/products?id=7"
    assert served.headers["X-Lane"] == "real" and "X-Track-Id" not in served.headers
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
    reply = edge.send("POST", "/api/cart", ua=AGENT_UA, body=b'{"sku": 1}', **FORGED)
    assert (reply.status, reply.body) == (200, BODY)
    assert edge.real.seen == []
    [served] = edge.tap.seen
    assert (served.method, served.path, served.body) == ("POST", "/api/cart", b'{"sku": 1}')
    assert served.headers["X-Lane"] == "mirror" and served.headers["X-Track-Id"] == TRACK_ID
    assert served.headers["X-Client-Ip"] == "127.0.0.1"
    [asked] = edge.lane.seen
    assert asked.headers["X-Forwarded-Method"] == "POST" and asked.body == b""


@pytest.mark.parametrize("path", ["/login", "/api/session"])
def test_login_posts_take_the_tap_on_the_real_lane_too(edge: Edge, path: str) -> None:
    edge.send("POST", path, body=b"username=ana&password=x")
    [served] = edge.tap.seen
    assert (served.path, served.body) == (path, b"username=ana&password=x")
    assert served.headers["X-Lane"] == "real" and "X-Track-Id" not in served.headers
    assert edge.real.seen == []


def test_login_page_get_and_other_posts_stay_on_the_real_shop(edge: Edge) -> None:
    edge.send("GET", "/login")
    edge.send("POST", "/api/cart", body=b"{}")
    edge.send("POST", "/login/extra", body=b"{}")
    assert [s.path for s in edge.real.seen] == ["/login", "/api/cart", "/login/extra"]
    assert edge.tap.seen == []


def test_both_lanes_answer_with_identical_headers(edge: Edge) -> None:
    real = edge.send("GET", "/products")
    mirror = edge.send("GET", "/products", ua=AGENT_UA)
    assert len(edge.real.seen) == len(edge.tap.seen) == 1
    for reply in (real, mirror):
        assert not set(SOFTWARE_HEADERS) & reply.headers.keys(), reply.headers
    real.headers.pop("date")
    mirror.headers.pop("date")
    assert real.headers == mirror.headers
    assert real.body == mirror.body


def test_parallel_requests_each_get_their_own_lane(edge: Edge) -> None:
    def one(i: int) -> int:
        ua = AGENT_UA if i % 2 else HUMAN_UA
        return edge.send("GET", f"/products/{i}", ua=ua).status

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert set(pool.map(one, range(PARALLEL))) == {200}
    mirrored = sorted(int(s.path.rsplit("/", 1)[1]) for s in edge.tap.seen)
    real = sorted(int(s.path.rsplit("/", 1)[1]) for s in edge.real.seen)
    assert mirrored == list(range(1, PARALLEL, 2)) and real == list(range(0, PARALLEL, 2))
    assert all(s.headers["X-Track-Id"] == TRACK_ID for s in edge.tap.seen)
    assert all("X-Track-Id" not in s.headers for s in edge.real.seen)
    assert len({s.headers["X-Request-Id"] for s in edge.lane.seen}) == PARALLEL


def test_access_log_keeps_its_redaction(edge: Edge) -> None:
    edge.send("GET", "/rest/user/change-password?current=a&new=b&repeat=b", Cookie="sid=1")
    log = edge.root / "run" / "access.log"
    deadline = time.monotonic() + STARTUP_S
    while not (log.exists() and log.read_text().strip()) and time.monotonic() < deadline:
        time.sleep(0.05)
    entry = json.loads(log.read_text().splitlines()[-1])
    assert "Cookie" not in entry["request"]["headers"]
    assert entry["request"]["uri"].endswith("current=REDACTED&new=REDACTED&repeat=REDACTED")
