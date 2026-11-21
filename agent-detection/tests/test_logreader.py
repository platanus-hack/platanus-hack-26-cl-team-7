from __future__ import annotations

import json
import queue
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from helpers import DEFAULT_IP, DEFAULT_UA, append_lines, caddy_line, caddy_runtime_line

from engine.logreader import follow, parse_line, read_requests
from engine.models import Request

POLL = 0.02
WAIT = 5.0


def test_parse_realistic_access_line() -> None:
    line = caddy_line(ts=1732176000.123456, method="POST", uri="/login", status=302)
    assert parse_line(line) == Request(
        ts=1732176000.123456,
        ip=DEFAULT_IP,
        user_agent=DEFAULT_UA,
        method="POST",
        path="/login",
        query="",
        status=302,
    )


def test_parse_tolerates_trailing_newline() -> None:
    req = parse_line(caddy_line(uri="/products") + "\n")
    assert req is not None
    assert req.path == "/products"


@pytest.mark.parametrize(
    ("uri", "path", "query"),
    [
        ("/search?q=red+shoes&page=2", "/search", "q=red+shoes&page=2"),
        ("/a?", "/a", ""),
        ("/a?x=1?y=2", "/a", "x=1?y=2"),
        ("/a%20b/..%2f?q=%27%20OR%201%3D1", "/a%20b/..%2f", "q=%27%20OR%201%3D1"),
        ("/", "/", ""),
    ],
)
def test_parse_splits_raw_uri(uri: str, path: str, query: str) -> None:
    req = parse_line(caddy_line(uri=uri))
    assert req is not None
    assert (req.path, req.query) == (path, query)


def test_client_ip_preferred_over_remote_ip() -> None:
    req = parse_line(caddy_line(client_ip="198.51.100.23", remote_ip="10.0.0.5"))
    assert req is not None
    assert req.ip == "198.51.100.23"


def test_remote_ip_used_when_client_ip_missing() -> None:
    req = parse_line(caddy_line(client_ip=None, remote_ip="192.0.2.44"))
    assert req is not None
    assert req.ip == "192.0.2.44"


def test_remote_ip_used_when_client_ip_empty() -> None:
    req = parse_line(caddy_line(client_ip="", remote_ip="192.0.2.45"))
    assert req is not None
    assert req.ip == "192.0.2.45"


def test_missing_user_agent_becomes_empty() -> None:
    req = parse_line(caddy_line(user_agent=None))
    assert req is not None
    assert req.user_agent == ""


def test_first_user_agent_value_is_used() -> None:
    entry = json.loads(caddy_line())
    entry["request"]["headers"]["User-Agent"] = ["sqlmap/1.8", "other"]
    req = parse_line(json.dumps(entry))
    assert req is not None
    assert req.user_agent == "sqlmap/1.8"


@pytest.mark.parametrize("headers", [{}, None, {"User-Agent": []}])
def test_odd_headers_give_empty_user_agent(headers: Any) -> None:
    entry = json.loads(caddy_line())
    entry["request"]["headers"] = headers
    req = parse_line(json.dumps(entry))
    assert req is not None
    assert req.user_agent == ""


def test_status_and_ts_types() -> None:
    req = parse_line(caddy_line(ts=1732176001.5, status=404))
    assert req is not None
    assert req.status == 404
    assert isinstance(req.status, int)
    assert req.ts == 1732176001.5


def _without(field: str, *, inner: bool = False) -> str:
    entry = json.loads(caddy_line())
    del (entry["request"] if inner else entry)[field]
    return json.dumps(entry)


@pytest.mark.parametrize(
    "line",
    [
        "",
        "   ",
        "not json at all",
        '{"level":"info","ts":1732176000.1,"logger":"http.log.access",',
        "[1, 2, 3]",
        "42",
        "null",
        '"a string"',
        '{"request": "not a dict", "ts": 1.0, "status": 200}',
        caddy_runtime_line(),
        caddy_runtime_line("enabling automatic TLS certificate management"),
        caddy_line().replace("http.log.access.log0", "http.log.error.log0"),
        _without("request"),
        _without("ts"),
        _without("status"),
        _without("method", inner=True),
        _without("uri", inner=True),
        caddy_line().replace('"status": 200', '"status": "abc"'),
        caddy_line().replace('"ts": 1732176000.123456', '"ts": "yesterday"'),
    ],
)
def test_bad_lines_return_none(line: str) -> None:
    assert parse_line(line) is None


def test_read_requests_skips_bad_lines(log_path: Path) -> None:
    append_lines(
        log_path,
        [
            caddy_runtime_line(),
            caddy_line(ts=1.0, uri="/a"),
            "garbage",
            caddy_line(ts=2.0, uri="/b?x=1"),
            "",
            caddy_line(ts=3.0, uri="/c"),
        ],
    )
    reqs = list(read_requests(log_path))
    assert [(r.ts, r.path, r.query) for r in reqs] == [
        (1.0, "/a", ""),
        (2.0, "/b", "x=1"),
        (3.0, "/c", ""),
    ]


def test_read_requests_accepts_str(log_path: Path) -> None:
    append_lines(log_path, [caddy_line(uri="/x")])
    assert [r.path for r in read_requests(str(log_path))] == ["/x"]


class Follower:
    """Runs follow() in a daemon thread and exposes what it yields through a queue."""

    def __init__(self, path: Path, **kwargs: Any) -> None:
        self.stop = threading.Event()
        self.items: queue.Queue[Request] = queue.Queue()
        self.thread = threading.Thread(target=self._run, args=(path, kwargs), daemon=True)
        self.thread.start()

    def _run(self, path: Path, kwargs: dict[str, Any]) -> None:
        for req in follow(path, poll_interval=POLL, stop=self.stop, **kwargs):
            self.items.put(req)

    def next(self) -> Request:
        return self.items.get(timeout=WAIT)

    def close(self) -> None:
        self.stop.set()
        self.thread.join(timeout=WAIT)


@pytest.fixture
def start_follow() -> Iterator[Any]:
    followers: list[Follower] = []

    def start(path: Path, **kwargs: Any) -> Follower:
        follower = Follower(path, **kwargs)
        followers.append(follower)
        return follower

    yield start
    for follower in followers:
        follower.close()


def _keep_appending(path: Path, done: threading.Event, uri: str) -> threading.Thread:
    def run() -> None:
        while not done.is_set():
            append_lines(path, [caddy_line(uri=uri)])
            done.wait(POLL * 2)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread


def test_follow_starts_at_end_by_default(log_path: Path, start_follow: Any) -> None:
    append_lines(log_path, [caddy_line(uri="/old-1"), caddy_line(uri="/old-2")])
    follower = start_follow(log_path)
    done = threading.Event()
    writer = _keep_appending(log_path, done, "/new")
    try:
        assert follower.next().path == "/new"
    finally:
        done.set()
        writer.join(timeout=WAIT)


def test_follow_from_start_reads_existing_then_new(log_path: Path, start_follow: Any) -> None:
    append_lines(log_path, [caddy_line(uri="/old-1"), "junk", caddy_line(uri="/old-2")])
    follower = start_follow(log_path, from_start=True)
    assert follower.next().path == "/old-1"
    assert follower.next().path == "/old-2"
    append_lines(log_path, [caddy_line(uri="/new")])
    assert follower.next().path == "/new"


def test_follow_joins_partial_line(log_path: Path, start_follow: Any) -> None:
    follower = start_follow(log_path, from_start=True)
    line = caddy_line(uri="/split?q=1")
    half = len(line) // 2
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(line[:half])
        handle.flush()
        time.sleep(POLL * 5)
        handle.write(line[half:] + "\n")
        handle.flush()
    req = follower.next()
    assert (req.path, req.query) == ("/split", "q=1")
    assert follower.items.empty()


def test_follow_survives_truncation(log_path: Path, start_follow: Any) -> None:
    follower = start_follow(log_path, from_start=True)
    append_lines(log_path, [caddy_line(uri=f"/before-{i}") for i in range(5)])
    for i in range(5):
        assert follower.next().path == f"/before-{i}"
    with log_path.open("w", encoding="utf-8") as handle:
        handle.write(caddy_line(uri="/t") + "\n")
    assert follower.next().path == "/t"


def test_follow_survives_rotation(log_path: Path, start_follow: Any) -> None:
    follower = start_follow(log_path, from_start=True)
    append_lines(log_path, [caddy_line(uri="/before")])
    assert follower.next().path == "/before"
    log_path.rename(log_path.with_name("access.log.1"))
    append_lines(log_path, [caddy_line(uri="/after-1")])
    assert follower.next().path == "/after-1"
    append_lines(log_path, [caddy_line(uri="/after-2")])
    assert follower.next().path == "/after-2"


def test_follow_waits_for_missing_file(tmp_path: Path, start_follow: Any) -> None:
    path = tmp_path / "later.log"
    follower = start_follow(path)
    time.sleep(POLL * 5)
    append_lines(path, [caddy_line(uri="/first")])
    assert follower.next().path == "/first"


def test_follow_stops_when_event_set(log_path: Path) -> None:
    follower = Follower(log_path)
    time.sleep(POLL * 5)
    follower.close()
    assert not follower.thread.is_alive()
