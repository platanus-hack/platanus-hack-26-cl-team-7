"""Acceptance tests for `python -m dashboard --port P --db PATH` (stdlib + sqlite3)."""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from dashboard.app import MAX_BODY, make_server
from dashboard.store import VerdictStore

REPO = Path(__file__).resolve().parents[1]
STARTUP_TIMEOUT = 10.0
HTTP_TIMEOUT = 2.0


@dataclass
class Dashboard:
    base: str
    proc: subprocess.Popen[bytes]
    stderr_path: Path


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        port: int = sock.getsockname()[1]
        return port


def _request(url: str, data: bytes | None = None) -> tuple[int, str, bytes]:
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            return resp.status, resp.headers.get("Content-Type", ""), resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.headers.get("Content-Type", ""), err.read()


def _verdicts(base: str) -> list[dict[str, Any]]:
    status, _, body = _request(f"{base}/api/verdicts")
    assert status == 200
    items: list[dict[str, Any]] = json.loads(body)
    return items


def _post(base: str, payload: dict[str, Any]) -> int:
    return _request(f"{base}/webhook", json.dumps(payload).encode("utf-8"))[0]


def _wait_ready(dash: Dashboard) -> None:
    deadline = time.monotonic() + STARTUP_TIMEOUT
    while time.monotonic() < deadline:
        if dash.proc.poll() is not None:
            pytest.fail(f"dashboard exited early: {dash.stderr_path.read_text()}")
        try:
            _request(f"{dash.base}/api/verdicts")
            return
        except OSError:
            time.sleep(0.05)
    pytest.fail(f"dashboard not ready in {STARTUP_TIMEOUT}s: {dash.stderr_path.read_text()}")


def _stop(proc: subprocess.Popen[bytes]) -> None:
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


def _start(db: Path, log_dir: Path) -> Dashboard:
    port = _free_port()
    stderr_path = log_dir / f"dashboard-{port}.err"
    with stderr_path.open("wb") as err:
        proc = subprocess.Popen(
            [sys.executable, "-m", "dashboard", "--port", str(port), "--db", str(db)],
            cwd=REPO,
            stdout=subprocess.DEVNULL,
            stderr=err,
        )
    dash = Dashboard(f"http://127.0.0.1:{port}", proc, stderr_path)
    try:
        _wait_ready(dash)
    except BaseException:
        _stop(proc)
        raise
    return dash


@pytest.fixture
def launch(tmp_path: Path) -> Iterator[Callable[[Path], Dashboard]]:
    started: list[Dashboard] = []

    def _launch(db: Path) -> Dashboard:
        dash = _start(db, tmp_path)
        started.append(dash)
        return dash

    yield _launch
    for dash in started:
        _stop(dash.proc)


@pytest.fixture
def dashboard(launch: Callable[[Path], Dashboard], tmp_path: Path) -> Dashboard:
    return launch(tmp_path / "verdicts.db")


def _verdict(n: int, rule: str = "R1") -> dict[str, Any]:
    ip = f"203.0.113.{n}"
    return {
        "session_id": f"{ip}|scanner/{n}",
        "ip": ip,
        "user_agent": f"scanner/{n}",
        "rule": rule,
        "reason": f"reason {n}",
        "critical": rule == "R3",
        "ts": 1700000000.0 + n,
        "request_count": n + 4,
        "verdict": "probing",
        "extra": {"n": n},
    }


def _assert_contains(item: dict[str, Any], posted: dict[str, Any]) -> None:
    for key, value in posted.items():
        assert item.get(key) == value, f"field {key!r}: {item.get(key)!r} != {value!r}"


def test_empty_store_returns_empty_json_list(dashboard: Dashboard) -> None:
    status, ctype, body = _request(f"{dashboard.base}/api/verdicts")
    assert status == 200
    assert ctype.split(";")[0].strip() == "application/json"
    assert json.loads(body) == []


def test_post_webhook_stores_verdict(dashboard: Dashboard) -> None:
    posted = _verdict(1, "R3")
    assert 200 <= _post(dashboard.base, posted) < 300
    items = _verdicts(dashboard.base)
    assert len(items) == 1
    _assert_contains(items[0], posted)


def test_api_verdicts_returns_newest_first(dashboard: Dashboard) -> None:
    for n in (1, 2, 3):
        assert 200 <= _post(dashboard.base, _verdict(n)) < 300
    items = _verdicts(dashboard.base)
    assert [item["session_id"] for item in items] == [
        "203.0.113.3|scanner/3",
        "203.0.113.2|scanner/2",
        "203.0.113.1|scanner/1",
    ]


def test_bad_json_returns_400_and_stores_nothing(dashboard: Dashboard) -> None:
    status, _, _ = _request(f"{dashboard.base}/webhook", b"{not json")
    assert status == 400
    assert _verdicts(dashboard.base) == []


def test_empty_body_returns_400(dashboard: Dashboard) -> None:
    status, _, _ = _request(f"{dashboard.base}/webhook", b"")
    assert status == 400
    assert _verdicts(dashboard.base) == []


def test_index_serves_html_that_polls_api(dashboard: Dashboard) -> None:
    status, ctype, body = _request(f"{dashboard.base}/")
    assert status == 200
    assert ctype.split(";")[0].strip() == "text/html"
    page = body.decode("utf-8")
    assert "<html" in page.lower()
    assert "/api/verdicts" in page
    assert "1000" in page


def test_sqlite_persists_across_restarts(
    launch: Callable[[Path], Dashboard], tmp_path: Path
) -> None:
    db = tmp_path / "persist.db"
    first = launch(db)
    posted = _verdict(7, "R2")
    assert 200 <= _post(first.base, posted) < 300
    _stop(first.proc)
    assert db.exists()
    second = launch(db)
    items = _verdicts(second.base)
    assert len(items) == 1
    _assert_contains(items[0], posted)


def test_separate_databases_are_isolated(
    launch: Callable[[Path], Dashboard], tmp_path: Path
) -> None:
    one = launch(tmp_path / "one.db")
    two = launch(tmp_path / "two.db")
    assert 200 <= _post(one.base, _verdict(1)) < 300
    assert len(_verdicts(one.base)) == 1
    assert _verdicts(two.base) == []


@pytest.fixture
def in_process(tmp_path: Path) -> Iterator[str]:
    server = make_server("127.0.0.1", 0, tmp_path / "nested" / "inproc.db")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_in_process_round_trip_and_unknown_paths(in_process: str) -> None:
    assert _post(in_process, _verdict(2, "R3")) == 201
    assert [v["rule"] for v in _verdicts(in_process)] == ["R3"]
    assert _request(f"{in_process}/nope")[0] == 404
    assert _request(f"{in_process}/nope", b"{}")[0] == 404
    status, ctype, body = _request(f"{in_process}/?x=1")
    assert (status, ctype.split(";")[0]) == (200, "text/html")
    assert b"/api/verdicts" in body


@pytest.mark.parametrize("body", [b"[1, 2]", b'"text"', b"{bad", b"x" * 1000])
def test_in_process_rejects_non_object_or_oversized_body(in_process: str, body: bytes) -> None:
    assert _request(f"{in_process}/webhook", body)[0] == 400
    assert _verdicts(in_process) == []


def test_in_process_answers_413_to_a_body_over_the_limit(in_process: str) -> None:
    assert _request(f"{in_process}/webhook", b"x" * (MAX_BODY + 1))[0] == 413
    assert _verdicts(in_process) == []


def test_store_adds_metadata_and_honours_limit(tmp_path: Path) -> None:
    store = VerdictStore(tmp_path / "store.db")
    ids = [store.add(_verdict(n)) for n in (1, 2, 3)]
    recent = store.recent(limit=2)
    assert [item["id"] for item in recent] == [ids[2], ids[1]]
    assert all(isinstance(item["received_at"], float) for item in recent)
