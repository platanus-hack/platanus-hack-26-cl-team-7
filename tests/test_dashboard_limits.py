"""Body-size limits of the dashboard webhook: attacker-sized verdicts are clipped, never dropped."""

from __future__ import annotations

import http.client
import json
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from dashboard.app import MAX_BODY, DashboardServer, make_server
from dashboard.store import MAX_TEXT, VerdictStore, clip
from engine.models import Verdict, session_key
from engine.webhook import post_verdict


@pytest.fixture
def server(tmp_path: Path) -> Iterator[DashboardServer]:
    dash = make_server("127.0.0.1", 0, tmp_path / "limits.db")
    thread = threading.Thread(target=dash.serve_forever, daemon=True)
    thread.start()
    try:
        yield dash
    finally:
        dash.shutdown()
        dash.server_close()
        thread.join(timeout=5)


def _url(dash: DashboardServer) -> str:
    return f"http://127.0.0.1:{dash.server_address[1]}/webhook"


def _post_raw(dash: DashboardServer, body: bytes, length: int | str | None = None) -> int:
    conn = http.client.HTTPConnection("127.0.0.1", dash.server_address[1], timeout=5)
    try:
        conn.putrequest("POST", "/webhook")
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Content-Length", str(len(body) if length is None else length))
        conn.endheaders()
        conn.send(body)
        return conn.getresponse().status
    finally:
        conn.close()


def _critical(user_agent: str) -> Verdict:
    ip = "203.0.113.66"
    return Verdict(
        session_id=session_key(ip, user_agent),
        ip=ip,
        user_agent=user_agent,
        rule="R3",
        reason="critical flag: sensitive file /.env",
        critical=True,
        ts=1700000000.0,
        request_count=1,
    )


def test_inflated_user_agent_still_reaches_the_dashboard(server: DashboardServer) -> None:
    verdict = _critical("\ufffd" * 6000)
    assert len(json.dumps(verdict.to_dict()).encode()) > 64 * 1024
    assert post_verdict(_url(server), verdict) is True
    [stored] = server.store.recent()
    assert (stored["rule"], stored["critical"], stored["ip"]) == ("R3", True, "203.0.113.66")
    assert stored["user_agent"].startswith("\ufffd" * MAX_TEXT)
    assert "6000 chars, sha256 " in stored["user_agent"]
    assert stored["session_id"].startswith("203.0.113.66|\ufffd")
    assert len(stored["session_id"]) < MAX_TEXT + 64


def test_largest_ua_caddy_accepts_fits_under_the_body_limit() -> None:
    verdict = _critical("\ufffd" * 20480)
    assert len(json.dumps(verdict.to_dict()).encode()) < MAX_BODY


def test_body_over_the_limit_is_413_and_logged(
    server: DashboardServer, capsys: pytest.CaptureFixture[str]
) -> None:
    assert _post_raw(server, b"{" + b" " * MAX_BODY) == 413
    assert server.store.recent() == []
    assert f"verdict body of {MAX_BODY + 1} bytes" in capsys.readouterr().err


def test_deeply_nested_json_is_400_not_a_dropped_connection(server: DashboardServer) -> None:
    assert _post_raw(server, b"[" * 100_000) == 400
    assert _post_raw(server, b"{}", length=-5) == 400
    assert _post_raw(server, b"{}", length="two") == 400
    assert server.store.recent() == []


def test_clip_cuts_long_strings_in_keys_lists_and_nested_objects(tmp_path: Path) -> None:
    long = "a" * (MAX_TEXT + 1)
    payload: dict[str, Any] = {"extra": {long: [long, 1, None]}, "short": "ok"}
    clipped = clip(payload)
    [key] = clipped["extra"]
    assert key == clip(long) and key.startswith("a" * MAX_TEXT + "... [513 chars")
    assert clipped["extra"][key] == [clip(long), 1, None]
    assert clipped["short"] == "ok" and clip("x" * MAX_TEXT) == "x" * MAX_TEXT
    assert clip(long) != clip("a" * (MAX_TEXT + 2))
    store = VerdictStore(tmp_path / "clip.db")
    store.add(payload)
    assert store.recent()[0]["extra"] == clipped["extra"]
