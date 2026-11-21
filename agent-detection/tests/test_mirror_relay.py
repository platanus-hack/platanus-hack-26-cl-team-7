"""mirror.relay: the twin's callback relay, driven by the shop's own fetch (demo.fetch) against a
local callback server. Loopback counts as public only through the test-only allow list."""

from __future__ import annotations

import contextlib
import http.client
import ipaddress
import logging
import socket
import socketserver
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field, replace
from http.server import BaseHTTPRequestHandler
from typing import Any

import pytest

from demo.fetch import FetchError, fetch
from mirror import relay
from mirror.cli import build_router, parse_config
from mirror.contracts import DeceptionEvent, TrackAction
from mirror.egress import Grants, Policy, Resolve, resolve
from mirror.relay import Relay, RelayServer, handler_for, relay_listener
from tests.test_mirror_tap_proxy import serving
from tests.test_twin_support import socket_dir

TRACK = "trk_0123456789abcdef"
LOOPBACK = (ipaddress.ip_network("127.0.0.0/8"),)
OPEN = Policy(frozenset(), frozenset(), LOOPBACK)
SHORT = 0.3  # the relay deadline in these tests


@dataclass
class Callback:
    port: int = 0
    seen: list[tuple[str, str, dict[str, str]]] = field(default_factory=list)

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"


def callback_handler(callback: Callback) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            callback.seen.append((self.command, self.path, dict(self.headers.items())))
            if self.path == "/slow":
                time.sleep(SHORT * 3)
            pieces = 3 if self.path == "/drip" else 1
            body = b"x" * 5000 if self.path == "/big" else b"pong"
            status = {"/moved": 302, "/odd": 799}.get(self.path, 200)
            self.send_response_only(status, "Fine")
            self.send_header("Content-Type", "text/plain")
            self.send_header("Location", "http://169.254.169.254/latest")
            self.send_header("Content-Length", str(len(body) * pieces))
            self.end_headers()
            for _ in range(pieces):
                self.wfile.write(b"" if self.command == "HEAD" else body)
                time.sleep(SHORT / 2 if pieces > 1 else 0)

        do_HEAD = do_GET

        def log_message(self, format: str, *args: Any) -> None:
            return None

    return Handler


@dataclass
class Harness:
    grants: Grants
    events: list[DeceptionEvent]
    callback: Callback
    proxy: str

    def grant(self, request_id: str = "req-1", host: str = "127.0.0.1") -> None:
        self.grants.grant(TRACK, request_id, [host])

    def action(self) -> TrackAction:
        [event] = self.events
        assert isinstance(event, TrackAction)
        return event


Build = Callable[..., Harness]


@pytest.fixture
def make() -> Iterator[Build]:
    with contextlib.ExitStack() as stack:

        def build(policy: Policy = OPEN, lookup: Resolve = resolve) -> Harness:
            callback = Callback()
            upstream = socketserver.ThreadingTCPServer(("127.0.0.1", 0), callback_handler(callback))
            callback.port = upstream.server_address[1]
            stack.enter_context(serving(upstream))
            grants, events = Grants(), list[DeceptionEvent]()
            served = Relay(grants, policy, events.append, lookup, SHORT)
            front = stack.enter_context(serving(RelayServer(("127.0.0.1", 0), handler_for(served))))
            return Harness(grants, events, callback, f"http://127.0.0.1:{front.server_address[1]}")

        yield build


def test_a_granted_fetch_gets_the_callback_answer_and_is_recorded(make: Build) -> None:
    relay_run = make()
    relay_run.grant()
    got = fetch(relay_run.callback.url("/hit?token=abc"), relay_run.proxy)
    assert (got.status, got.content_type, got.body) == (200, "text/plain", b"pong")
    [(method, path, headers)] = relay_run.callback.seen
    assert (method, path) == ("GET", "/hit?token=abc")
    assert headers["User-Agent"] == "FreshJuice-ImageFetcher/1.2"
    assert headers["Host"] == f"127.0.0.1:{relay_run.callback.port}"
    action = relay_run.action()
    assert (action.event_id, action.track_id, action.method) == (
        "track.action:req-1:egress",
        TRACK,
        "GET",
    )
    assert (action.path, action.query, action.status) == (
        relay_run.callback.url("/hit"),
        "token=abc",
        200,
    )
    assert action.response_body == "relay: 200 from 127.0.0.1\npong"


def test_without_a_grant_the_fetch_fails_like_a_dead_network(make: Build) -> None:
    relay_run = make()
    with pytest.raises(FetchError, match="could not connect"):
        fetch(relay_run.callback.url("/hit"), relay_run.proxy)
    assert relay_run.callback.seen == [] and relay_run.events == []


def test_a_grant_gives_one_fetch(make: Build) -> None:
    relay_run = make()
    relay_run.grant()
    fetch(relay_run.callback.url("/first"), relay_run.proxy)
    with pytest.raises(FetchError):
        fetch(relay_run.callback.url("/second"), relay_run.proxy)
    assert [path for _, path, _ in relay_run.callback.seen] == ["/first"]


def test_a_redirect_comes_back_as_it_is_and_is_not_followed(make: Build) -> None:
    relay_run = make()
    relay_run.grant()
    got = fetch(relay_run.callback.url("/moved"), relay_run.proxy)
    assert got.status == 302
    assert len(relay_run.callback.seen) == 1


def test_a_status_outside_http_counts_as_a_failure(make: Build) -> None:
    relay_run = make()
    relay_run.grant()
    with pytest.raises(FetchError):
        fetch(relay_run.callback.url("/odd"), relay_run.proxy)
    action = relay_run.action()
    assert action.status == 502 and "answered status 799" in action.response_body


def test_head_gets_the_status_and_headers(make: Build) -> None:
    relay_run = make()
    relay_run.grant()
    connection = http.client.HTTPConnection("127.0.0.1", int(relay_run.proxy.rsplit(":", 1)[1]))
    hop = {"Proxy-Authorization": "Basic eDp5", "Connection": "keep-alive", "X-Kept": "1"}
    connection.request("HEAD", relay_run.callback.url("/head"), headers=hop)
    response = connection.getresponse()
    assert (response.status, response.read(), response.getheader("Connection")) == (
        200,
        b"",
        "close",
    )
    connection.close()
    assert relay_run.action().method == "HEAD"
    [(_, _, headers)] = relay_run.callback.seen
    assert headers["X-Kept"] == "1" and "Proxy-Authorization" not in headers
    assert headers.get("Connection") != "keep-alive"


def test_a_loopback_callback_is_blocked_without_the_test_allow_list(make: Build) -> None:
    relay_run = make(Policy(frozenset(), frozenset()))
    relay_run.grant()
    with pytest.raises(FetchError, match="could not connect"):
        fetch(relay_run.callback.url("/hit"), relay_run.proxy)
    assert relay_run.callback.seen == []
    action = relay_run.action()
    assert action.status == 502
    assert action.response_body == "relay: blocked: 127.0.0.1 is not a public address\n"


def test_our_own_host_stays_blocked_with_the_allow_list(make: Build) -> None:
    relay_run = make(Policy(frozenset({"127.0.0.1"}), frozenset(), LOOPBACK))
    relay_run.grant()
    with pytest.raises(FetchError):
        fetch(relay_run.callback.url("/hit"), relay_run.proxy)
    assert "our own host" in relay_run.action().response_body


def test_a_failed_lookup_is_recorded(make: Build) -> None:
    def lookup(host: str, port: int, timeout: float) -> list[str]:
        raise socket.gaierror(socket.EAI_NONAME, "unknown host")

    relay_run = make(lookup=lookup)
    relay_run.grant(host="gone.example")
    with pytest.raises(FetchError):
        fetch("http://gone.example/cb", relay_run.proxy)
    assert relay_run.action().response_body.startswith("relay: no address for gone.example")


def test_an_https_callback_is_a_dns_lookup_only(make: Build) -> None:
    looked_up: list[tuple[str, int]] = []

    def lookup(host: str, port: int, timeout: float) -> list[str]:
        looked_up.append((host, port))
        return ["93.184.216.34"]

    relay_run = make(lookup=lookup)
    relay_run.grant(host="oast.example")
    with pytest.raises(FetchError, match="could not connect"):
        fetch("https://oast.example/x", relay_run.proxy)
    assert looked_up == [("oast.example", 443)]
    action = relay_run.action()
    assert (action.method, action.path, action.status) == ("CONNECT", "oast.example:443", 502)
    assert "tunnels are refused" in action.response_body


@pytest.mark.parametrize(("path", "why"), [("/slow", "timed out"), ("/drip", "longer than")])
def test_a_slow_callback_is_cut_at_the_deadline(make: Build, path: str, why: str) -> None:
    relay_run = make()
    relay_run.grant()
    started = time.monotonic()
    with pytest.raises(FetchError):
        fetch(relay_run.callback.url(path), relay_run.proxy)
    assert time.monotonic() - started < SHORT * 3
    assert why in relay_run.action().response_body


def test_the_answer_body_is_capped(make: Build, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(relay, "MAX_ANSWER", 1000)
    relay_run = make()
    relay_run.grant()
    got = fetch(relay_run.callback.url("/big"), relay_run.proxy)
    assert got.body == b"x" * 1000


def test_a_request_the_relay_does_not_take_is_refused(make: Build) -> None:
    relay_run = make()
    connection = http.client.HTTPConnection("127.0.0.1", int(relay_run.proxy.rsplit(":", 1)[1]))
    connection.request("GET", "/not-a-proxy-request")
    assert connection.getresponse().status == 502
    connection.close()
    assert relay_run.events == []


def test_a_malformed_request_line_is_refused_by_the_server(make: Build) -> None:
    relay_run = make()
    host, port = relay_run.proxy.removeprefix("http://").rsplit(":", 1)
    with socket.create_connection((host, int(port))) as raw:
        raw.sendall(b"NONSENSE\r\n\r\n")
        assert raw.makefile("rb").read().startswith(b"HTTP/1.0 400")
    assert relay_run.events == []


def test_the_server_listens_on_ipv6_when_asked() -> None:
    with RelayServer(("::1", 0), BaseHTTPRequestHandler) as server:
        assert server.address_family == socket.AF_INET6


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
        return port


def test_relay_listener_builds_the_relay_from_the_router_flags(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with socket_dir() as run:
        names = ("lane", "tap", "real", "twin", "sync", "state", "spool", "canaries", "patches")
        argv = [part for name in names for part in (f"--{name}", str(run / name))]
        relay_at = f"127.0.0.1:{free_port()}"
        config = parse_config([*argv, "--relay", relay_at, "--relay-allow-cidr", "127.0.0.0/8"])
        router = build_router(config, "test-ingest-value")
        try:
            with caplog.at_level(logging.WARNING), relay_listener(router) as server:
                assert isinstance(server, RelayServer)
            assert "no --relay-block-host" in caplog.text
            blocked = parse_config([*argv, "--relay", relay_at, "--relay-block-host", "127.0.0.1"])
            assert blocked.relay_block_host == ["127.0.0.1"] and blocked.relay_allow_cidr == []
            caplog.clear()
            with relay_listener(replace(router, config=blocked)):
                assert "no --relay-block-host" not in caplog.text
        finally:
            router.close()
