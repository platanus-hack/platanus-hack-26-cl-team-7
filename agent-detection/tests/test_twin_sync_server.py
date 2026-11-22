"""python -m demo.sync: the copy endpoint on run/sync.sock and the push every few seconds."""

import json
import sqlite3
import stat
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
from test_twin_support import POLICY_FILE, Answer, make_shop, make_twin, running, socket_dir

from demo import auth, db, sync
from demo.masking import load_policy
from demo.replica import Copied, Syncer
from demo.sync import (
    MAX_COPY_BODY,
    MAX_VALUE_CHARS,
    MAX_VALUES,
    MAX_VALUES_BODY,
    SyncServer,
    push_forever,
)
from demo.web import Shop
from mirror.session_copy import real_values
from mirror.sockets import UnixHTTPConnection


@pytest.fixture
def syncer(tmp_path: Path) -> Syncer:
    real = make_shop(tmp_path)
    twin = make_twin(tmp_path, real)
    return Syncer(real.db, twin.db, load_policy(POLICY_FILE))


@pytest.fixture
def sock(syncer: Syncer) -> Iterator[Path]:
    with socket_dir() as folder:
        path = folder / "sync.sock"
        with running(SyncServer(path, syncer)):
            yield path


def call(path: Path, method: str, target: str, body: bytes | None = None) -> Answer:
    conn = UnixHTTPConnection(path)
    try:
        conn.request(method, target, body=body, headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        return Answer(resp.status, dict(resp.getheaders()), resp.read())
    finally:
        conn.close()


def test_copy_of_a_real_session_answers_the_user_and_order_count(
    sock: Path, syncer: Syncer
) -> None:
    real = Shop(syncer.real, syncer.real.with_name("real-files"))
    login = auth.login(real, "alice", "wonderland")
    assert login is not None
    answer = call(sock, "POST", "/copy", json.dumps({"cookie": f"session={login.token}"}).encode())
    assert answer.status == 200 and answer.headers["Content-Type"] == "application/json"
    assert answer.json() == {"userId": 2, "orders": answer.json()["orders"]}
    assert answer.json()["orders"] > 0
    assert stat.S_IMODE(sock.stat().st_mode) == 0o600


@pytest.mark.parametrize(
    ("body", "status"),
    [
        (b"", 400),
        (b"{}", 400),
        (b"{broken", 400),
        (b"\xff\xfe", 400),
        (b'["cookie"]', 400),
        (b'{"cookie": 7}', 400),
        (json.dumps({"cookie": "x" * MAX_COPY_BODY}).encode(), 400),
        (b'{"cookie": "session=nobody"}', 404),
    ],
)
def test_bad_or_unknown_copy_requests_are_refused(sock: Path, body: bytes, status: int) -> None:
    answer = call(sock, "POST", "/copy", body)
    assert answer.status == status and "error" in answer.json()


def test_real_values_names_the_usernames_emails_and_tokens_the_real_shop_holds(
    sock: Path, syncer: Syncer
) -> None:
    real = Shop(syncer.real, syncer.real.with_name("real-files"))
    login = auth.login(real, "alice", "wonderland")
    assert login is not None
    with db.opened(syncer.twin) as conn:
        masked = conn.execute("SELECT username, email FROM users WHERE id = 2").fetchone()
    assert masked["username"] != "alice"
    values = ["alice", "ALICE.liddell@GMAIL.com", login.token, "nobody.here", *masked]
    answer = call(sock, "POST", "/real-values", json.dumps({"values": values}).encode())
    assert answer.status == 200
    assert answer.json() == {"real": ["alice", "ALICE.liddell@GMAIL.com", login.token]}
    assert real_values(sock, values) == frozenset(answer.json()["real"])
    assert call(sock, "POST", "/real-values", b'{"values": []}').json() == {"real": []}


@pytest.mark.parametrize(
    "body",
    [
        b"",
        b"{}",
        b'{"values": "alice"}',
        b'{"values": [7]}',
        b'["alice"]',
        json.dumps({"values": ["v"] * (MAX_VALUES + 1)}).encode(),
        json.dumps({"values": ["v" * (MAX_VALUE_CHARS + 1)]}).encode(),
        json.dumps({"values": ["v" * MAX_VALUES_BODY]}).encode(),
    ],
)
def test_bad_real_values_requests_are_refused(sock: Path, body: bytes) -> None:
    answer = call(sock, "POST", "/real-values", body)
    assert answer.status == 400 and "error" in answer.json()


def test_a_database_error_while_checking_real_values_is_a_503(
    sock: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(self: Syncer, values: list[str]) -> list[str]:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(Syncer, "real_values", broken)
    answer = call(sock, "POST", "/real-values", b'{"values": ["alice"]}')
    assert answer.status == 503 and "database is locked" in answer.json()["error"]
    assert real_values(sock, ["alice"]) is None


def test_other_paths_and_methods_are_not_found(sock: Path) -> None:
    assert call(sock, "POST", "/push", b"{}").status == 404
    assert call(sock, "GET", "/copy").status == 404
    assert call(sock, "PUT", "/copy").status == 501
    conn = UnixHTTPConnection(sock)
    try:
        conn.request("POST", "/copy", headers={"Content-Length": "abc"})
        assert conn.getresponse().status == 400
    finally:
        conn.close()


def test_a_database_error_during_copy_is_a_503(sock: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(self: Syncer, cookie: str) -> Copied | None:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(Syncer, "copy", broken)
    answer = call(sock, "POST", "/copy", b'{"cookie": "session=x"}')
    assert answer.status == 503 and "database is locked" in answer.json()["error"]


def test_push_forever_reports_failures_retries_and_stops(
    syncer: Syncer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A push that fails twice, then succeeds and asks the loop to stop."""
    stop, calls = threading.Event(), []
    failures = [sqlite3.OperationalError("database is locked"), OSError("twin file busy")]

    def flaky(self: Syncer) -> dict[str, int]:
        calls.append(1)
        if failures:
            raise failures.pop(0)
        stop.set()
        return {"inserted": 2, "updated": 0, "deleted": 0}

    monkeypatch.setattr(Syncer, "push", flaky)
    push_forever(syncer, stop, every=0.01)
    out = capsys.readouterr()
    assert len(calls) == 3
    assert out.err.count("sync push failed, retrying") == 2
    assert "sync push: {'inserted': 2" in out.out


def test_a_quiet_push_prints_nothing(syncer: Syncer, capsys: pytest.CaptureFixture[str]) -> None:
    stop = threading.Event()
    stop.set()
    push_forever(syncer, stop, every=0.01)
    assert capsys.readouterr().out == ""


def test_main_serves_copy_until_interrupted_then_removes_its_socket(
    syncer: Syncer, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    seen: list[int] = []

    def serve_once(running: Syncer, stop: threading.Event, every: float) -> None:
        seen.append(call(path, "POST", "/copy", b'{"cookie": "session=x"}').status)
        assert running.push() == {"inserted": 0, "updated": 0, "deleted": 0} and every == 0.5
        raise KeyboardInterrupt

    monkeypatch.setattr(sync, "push_forever", serve_once)
    with socket_dir() as folder:
        path = folder / "sync.sock"
        sync.main(
            [
                "--socket",
                str(path),
                "--real",
                str(syncer.real),
                "--twin",
                str(syncer.twin),
                "--allow",
                str(POLICY_FILE),
                "--every",
                "0.5",
            ]
        )
        assert seen == [404] and not path.exists()
    assert "demo sync on unix:" in capsys.readouterr().out
