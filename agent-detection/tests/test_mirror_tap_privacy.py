"""The tap keeps real people's secrets out of what it reports (no password in a track.action or in
a finding's evidence) and never binds a value the real database holds, so a real user cannot be
routed to the twin by their own username or email."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest

from mirror.cli import build_router, parse_config
from mirror.contracts import FindingConfirmed, TrackAction, TrackLinked
from mirror.keys import twin_born_key
from mirror.sockets import UnixHTTPServer
from mirror.tap import tap_listener
from tests.test_mirror_tap import TRACK, TWIN_SESSION, USER, Stack, counted, serving_stack
from tests.test_mirror_tap_proxy import serving
from tests.test_twin_support import socket_dir

FORM = {"Content-Type": "application/x-www-form-urlencoded"}
JSON = {"Content-Type": "application/json"}
REAL_LANE = {"X-Lane": "real", "X-Client-Ip": "198.51.100.44", "User-Agent": "Safari"}


@pytest.fixture
def stack(tmp_path: Path) -> Iterator[Stack]:
    with serving_stack(tmp_path, set()) as running:
        yield running


def reported(stack: Stack) -> str:
    return repr(stack.events)


def test_a_password_typed_on_the_mirror_lane_is_not_reported(stack: Stack) -> None:
    stack.mirror("/login", b"username=someone&password=passwordpass", FORM)
    [action] = stack.of(TrackAction)
    assert action.request_body == "username=someone&password=[redacted 12]"
    assert "passwordpass" not in reported(stack)  # the twin's stub shop echoes the body back


def test_a_json_password_and_a_secret_in_the_query_are_not_reported(stack: Stack) -> None:
    stack.mirror("/api/session?token=abc123&next=%2F", b'{"username":"u","pwd":"Zx9"}', JSON)
    [action] = stack.of(TrackAction)
    assert action.query == "token=[redacted 6]&next=%2F"
    assert action.request_body == '{"username":"u","pwd":"[redacted 3]"}'
    assert "abc123" not in reported(stack) and "Zx9" not in reported(stack)


def test_a_real_login_moved_to_the_twin_by_its_username_reports_no_password(stack: Stack) -> None:
    key = twin_born_key("maria.perez")
    assert key is not None
    stack.keys.bind(key, TRACK)
    stack.send("POST", "/login", b"username=maria.perez&password=Hunter2-real!", REAL_LANE | FORM)
    assert stack.shops.seen[0][0] == "twin"
    [action] = stack.of(TrackAction)
    assert action.request_body == "username=maria.perez&password=[redacted 13]"
    assert "Hunter2-real" not in reported(stack)


def test_the_shop_still_gets_the_whole_body_only_the_report_is_redacted(stack: Stack) -> None:
    status, answer = stack.mirror("/login", b"username=a&password=passwordpass", FORM)
    assert (status, answer) == (200, b"twin: username=a&password=passwordpass")


def test_a_finding_shows_the_request_without_secrets_and_keeps_the_signature(
    stack: Stack,
) -> None:
    body = b"username=%27+OR+1%3D1+--&password=Hunter2xyz"
    stack.mirror("/login", body, FORM)
    [finding] = stack.of(FindingConfirmed)
    assert finding.kind == "signature_success" and "sql tautology" in finding.evidence
    assert "username=%27+OR+1%3D1+--" in finding.evidence
    assert "password=[redacted 10]" in finding.evidence and "Hunter2xyz" not in reported(stack)
    stack.mirror("/api/users/1?password=Qwerty77", headers={"X-Request-Id": "req-2"})
    [canary] = [f for f in stack.of(FindingConfirmed) if f.kind == "canary_read"]
    assert "password=[redacted 8]" in canary.evidence and "Qwerty77" not in reported(stack)


def test_a_username_the_real_database_holds_is_never_bound(stack: Stack) -> None:
    stack.real.update({USER["username"], str(USER["email"])})
    stack.mirror("/api/users/1")
    assert [e.event_id for e in stack.of(TrackLinked)] == ["track.linked:req-1:twin_born-0"]
    for value in (USER["username"], USER["email"]):
        key = twin_born_key(str(value))
        assert key is not None and stack.keys.find([key]) is None
    token = twin_born_key(TWIN_SESSION)
    assert token is not None and stack.keys.find([token]) == (TRACK, token)


def test_a_real_user_logging_in_from_a_new_ip_stays_on_the_real_shop(stack: Stack) -> None:
    stack.real.add(USER["username"])
    stack.mirror("/api/users/1")
    login = b"username=leo.espinoza68&password=real-pw"
    headers = {"X-Request-Id": "req-9"} | REAL_LANE | FORM
    status, answer = stack.send("POST", "/login", login, headers)
    assert (status, answer.startswith(b"real:")) == (200, True)
    assert [shop for shop, *_ in stack.shops.seen] == ["twin", "real"]
    assert not [a for a in stack.of(TrackAction) if a.event_id.endswith("req-9")]


def test_nothing_binds_while_the_real_side_cannot_check(
    stack: Stack, caplog: pytest.LogCaptureFixture
) -> None:
    blind = replace(stack.tap, real_values=lambda values: None)
    front = stack.path.with_name("blind.sock")
    with serving(UnixHTTPServer(front, counted(blind, stack.done))) as server:
        answer = replace(stack, path=server.socket_path).mirror("/api/users/1")
    assert answer[0] == 200 and stack.of(TrackLinked) == []
    assert len(stack.of(TrackAction)) == 1 and stack.of(FindingConfirmed)
    assert "not bound" in caplog.text


def test_tap_listener_serves_the_router_tap_socket() -> None:
    with socket_dir() as run:
        names = ("lane", "tap", "real", "twin", "sync", "state", "spool", "canaries", "patches")
        config = parse_config([part for name in names for part in (f"--{name}", str(run / name))])
        router = build_router(config, "test-ingest-value")
        try:
            with tap_listener(router) as server:
                assert isinstance(server, UnixHTTPServer) and server.socket_path == run / "tap"
        finally:
            router.close()

