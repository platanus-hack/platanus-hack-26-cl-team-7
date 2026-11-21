"""mirror.cli: flags, startup errors, the listener seam and a served lane on run/lane.sock."""

from __future__ import annotations

import os
import runpy
import signal
import socketserver
import sys
import tempfile
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import pytest

from mirror import cli
from mirror.cli import Router, lane_listener, main, parse_config
from mirror.sockets import UnixHTTPConnection, UnixHTTPServer

REPO = Path(__file__).resolve().parent.parent
WAIT = 5.0


@pytest.fixture
def run_dir() -> Iterator[Path]:
    # macOS caps AF_UNIX paths near 104 bytes; pytest's tmp_path can be longer.
    with tempfile.TemporaryDirectory(dir="/tmp") as name:
        yield Path(name)


@pytest.fixture
def token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(cli.INGEST_ENV, "test-ingest-value")


def flags(run: Path, *extra: str) -> list[str]:
    names = ("lane", "tap", "real", "twin", "sync", "state", "spool", "canaries", "patches")
    paths = [part for name in names for part in (f"--{name}", str(run / f"{name}.x"))]
    return [*paths, "--sentinel", "http://127.0.0.1:9", *extra]


def test_defaults_follow_the_integration_contract() -> None:
    config = parse_config([])
    assert config.lane == Path("run/lane.sock")
    assert config.tap == Path("run/tap.sock")
    assert config.relay == ("127.0.0.1", 8097)
    assert (config.real, config.twin, config.sync) == tuple(
        Path(f"run/{name}.sock") for name in ("real", "twin", "sync")
    )
    assert config.sentinel == "http://127.0.0.1:8787"
    assert config.state == Path("run/mirror-keys.jsonl")
    assert config.spool == Path("run/mirror-spool.jsonl")
    assert config.canaries == Path("run/canaries.json")
    assert config.routes == REPO / "config" / "routes.yaml"


@pytest.mark.parametrize(
    "argv",
    [
        ["--relay", "8097"],
        ["--relay", ":8097"],
        ["--relay", "127.0.0.1:http"],
        ["--relay", "127.0.0.1:70000"],
        ["--sentinel", "ftp://127.0.0.1"],
        ["--sentinel", "http://"],
    ],
)
def test_bad_flags_exit_with_usage(argv: list[str]) -> None:
    with pytest.raises(SystemExit) as stop:
        parse_config(argv)
    assert stop.value.code == 2


def test_relay_accepts_an_ipv6_host() -> None:
    assert parse_config(["--relay", "::1:8097"]).relay == ("::1", 8097)


def test_a_missing_token_exits_2(
    run_dir: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv(cli.INGEST_ENV, raising=False)
    assert main(flags(run_dir)) == 2
    assert cli.INGEST_ENV in capsys.readouterr().err


@pytest.mark.usefixtures("token")
def test_bad_config_exits_2(run_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    bad = run_dir / "rules.yaml"
    bad.write_text("r9_magic: {}\n", encoding="utf-8")
    assert main(flags(run_dir, "--rules", str(bad))) == 2
    assert "bad config" in capsys.readouterr().err


@pytest.mark.usefixtures("token")
def test_a_listener_that_cannot_start_exits_2_and_closes_the_others(
    run_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    opened: list[socketserver.BaseServer] = []

    def first(router: Router) -> socketserver.BaseServer:
        opened.append(lane_listener(router))
        return opened[-1]

    def broken(router: Router) -> socketserver.BaseServer:
        raise OSError("address in use")

    assert main(flags(run_dir), listeners=(first, broken)) == 2
    assert "cannot listen: address in use" in capsys.readouterr().err
    assert not (run_dir / "lane.x").exists()  # the first server was closed


def wait_for_socket(path: Path) -> None:
    deadline = time.monotonic() + WAIT
    while not path.exists():
        assert time.monotonic() < deadline, f"{path} never appeared"
        time.sleep(0.01)


def lane_answer(path: Path, uri: str) -> str | None:
    connection = UnixHTTPConnection(path)
    try:
        connection.request("GET", "/lane", headers={"X-Forwarded-Uri": uri, "X-Client-Ip": "::1"})
        response = connection.getresponse()
        response.read()
        return response.getheader("X-Lane")
    finally:
        connection.close()


@pytest.mark.usefixtures("token")
def test_main_serves_every_listener_with_one_router_until_stopped(run_dir: Path) -> None:
    routers: list[Router] = []

    def extra(router: Router) -> socketserver.BaseServer:  # where the tap and relay plug in
        routers.append(router)
        return UnixHTTPServer(run_dir / "extra.sock", BaseHTTPRequestHandler)

    stop = threading.Event()
    result: list[int] = []
    argv = flags(run_dir)
    thread = threading.Thread(
        target=lambda: result.append(main(argv, listeners=(lane_listener, extra), stop=stop))
    )
    thread.start()
    try:
        wait_for_socket(run_dir / "lane.x")
        assert lane_answer(run_dir / "lane.x", "/products") == "real"
        assert lane_answer(run_dir / "lane.x", "/.env") == "mirror"
        assert lane_answer(run_dir / "lane.x", "/products") == "mirror"
        assert (run_dir / "extra.sock").exists()
        assert len(routers[0].keys) == 2
    finally:
        stop.set()
        thread.join(WAIT)
    assert result == [0]
    assert not (run_dir / "lane.x").exists()
    assert not (run_dir / "extra.sock").exists()
    assert (run_dir / "state.x").exists()  # keys persisted for the next start
    on_disk = [run_dir / name for name in ("spool.x", "spool.x.sending")]
    assert any(path.exists() for path in on_disk)  # Sentinel on port 9 is down: events wait


def test_python_dash_m_mirror_prints_help(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(sys, "argv", ["mirror", "--help"])
    with pytest.raises(SystemExit) as done:
        runpy.run_module("mirror", run_name="__main__")
    assert done.value.code == 0
    out = capsys.readouterr().out
    assert "--lane" in out
    assert "--relay" in out


def test_sigterm_and_sigint_set_the_stop_event() -> None:
    saved = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM)}
    try:
        for number in saved:
            stop = cli._stop_on_signals()
            os.kill(os.getpid(), number)
            assert stop.wait(WAIT)
    finally:
        for number, handler in saved.items():
            signal.signal(number, handler)
