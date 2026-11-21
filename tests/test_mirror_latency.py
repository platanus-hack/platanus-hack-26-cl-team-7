"""/lane latency budget: p95 under 1 ms with 10k keys bound.

Two numbers: the decision alone (LaneRouter.decide) and the whole forward_auth round trip over
run/lane.sock on one kept-alive connection, as Caddy sends it. Both print with `pytest -s`, and
both must stay under the budget.
"""

from __future__ import annotations

import statistics
import tempfile
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from engine.config import load_thresholds
from engine.detector import Detector
from engine.routes import RouteTable
from mirror.contracts import TrackKey
from mirror.forwarded import Forwarded
from mirror.keys import KeyTable, twin_born_key
from mirror.lane import LaneRouter, handler_for
from mirror.patches import ANY_SIGNATURE, Patch, PatchBook
from mirror.sockets import UnixHTTPConnection, UnixHTTPServer

REPO = Path(__file__).resolve().parent.parent
KEYS = 10_000
SAMPLES = 3_000
BUDGET_MS = 1.0
TRACK = "trk_00000000000000c3"
PATHS = ("/", "/products", "/products/12", "/search", "/cart", "/static/app.js", "/account")


@pytest.fixture(scope="module")
def router() -> Iterator[LaneRouter]:
    with tempfile.TemporaryDirectory(dir="/tmp") as name:
        routes = RouteTable.from_yaml(REPO / "config" / "routes.yaml")
        detector = Detector(routes, load_thresholds(REPO / "config" / "rules.yaml"))
        keys = KeyTable.load(Path(name) / "keys.jsonl")
        for n in range(KEYS // 2):
            keys.bind(TrackKey("ip_ua", f"10.{n // 250}.{n % 250}.1|agent-{n}"), TRACK)
            twin = twin_born_key(f"twin-session-{n:06d}")
            assert twin is not None
            keys.bind(twin, TRACK)
        assert len(keys) == KEYS
        patches = PatchBook.load(Path(name) / "patches.jsonl", routes)
        patches.add(Patch("fnd_00000000000000c3", "GET", "/api/users/{id}", ANY_SIGNATURE, "R3"))
        yield LaneRouter(detector, keys, patches, lambda event: None, lambda cookie: None)
        keys.close()


def traffic(n: int) -> Forwarded:
    """Mostly ordinary shoppers with cookies and queries; one in ten a known agent (by IP and
    User-Agent), one in ten a twin-born cookie from a new client."""
    k = n % (KEYS // 2)
    if n % 10 == 0:
        agent_ip = f"10.{k // 250}.{k % 250}.1"
        return Forwarded(f"m-{n}", "GET", "/products", "", agent_ip, f"agent-{k}")
    if n % 10 == 5:
        cookie = f"session=twin-session-{k:06d}"
        return Forwarded(f"t-{n}", "GET", "/account", "", "198.51.100.3", "curl/8", cookie)
    return Forwarded(
        request_id=f"r-{n}",
        method="GET",
        path=PATHS[n % len(PATHS)],
        query=f"q=shoes-{n % 50}&page={n % 5}",
        ip=f"192.0.{(n // 250) % 250}.{n % 250}",
        user_agent=f"Mozilla/5.0 shopper-{n % 400}",
        cookie=f"session=real-{n % 400:08d}; theme=dark",
    )


def p95_ms(samples: list[float]) -> float:
    return statistics.quantiles(samples, n=100)[94] * 1000


def test_decision_p95_is_under_1_ms_with_10k_keys(router: LaneRouter) -> None:
    requests = [traffic(n) for n in range(SAMPLES)]
    samples, lanes = [], []
    for fwd in requests:
        started = time.perf_counter()
        lanes.append(router.decide(fwd).lane)
        samples.append(time.perf_counter() - started)
    assert lanes.count("mirror") == SAMPLES // 5
    p95 = p95_ms(samples)
    print(f"\nlane decide p95 {p95:.3f} ms, median {statistics.median(samples) * 1000:.3f} ms")
    assert p95 < BUDGET_MS


def test_round_trip_over_the_lane_socket(router: LaneRouter) -> None:
    with tempfile.TemporaryDirectory(dir="/tmp") as name:
        server = UnixHTTPServer(Path(name) / "lane.sock", handler_for(router))
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        connection = UnixHTTPConnection(server.socket_path)
        samples = []
        try:
            for n in range(SAMPLES):
                fwd = traffic(n + SAMPLES)
                headers = {
                    "X-Forwarded-Method": fwd.method,
                    "X-Forwarded-Uri": f"{fwd.path}?{fwd.query}",
                    "X-Client-Ip": fwd.ip,
                    "User-Agent": fwd.user_agent,
                    "Cookie": fwd.cookie,
                    "X-Request-Id": fwd.request_id,
                }
                started = time.perf_counter()
                connection.request("GET", "/lane", headers=headers)
                response = connection.getresponse()
                response.read()
                samples.append(time.perf_counter() - started)
                assert response.status == 200
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            thread.join()
    p95 = p95_ms(samples)
    print(f"\nlane round trip p95 {p95:.3f} ms, median {statistics.median(samples) * 1000:.3f} ms")
    assert p95 < BUDGET_MS
