"""Acceptance tests for `python -m engine replay|follow`, including follow -> dashboard latency."""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from engine.cli import main, run_follow
from engine.config import load_thresholds
from engine.detector import Detector
from engine.logreader import read_requests
from engine.routes import RouteTable

REPO = Path(__file__).resolve().parents[1]
RULES = REPO / "config" / "rules.yaml"
STARTUP_TIMEOUT = 15.0
LATENCY_TARGET = 2.0
ROUTES_YAML = """routes:
  - pattern: "/"
  - pattern: "/products"
  - pattern: "/products/{id}"
  - pattern: "/static/**"
    asset: true
"""
SCANNER_UA = "ffuf/2.1.0"
HUMAN_UA = "Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0"
T0 = 1700000000.0


def caddy_line(ts: float, ip: str, ua: str, uri: str, status: int = 200) -> str:
    entry = {
        "level": "info",
        "ts": ts,
        "logger": "http.log.access",
        "msg": "handled request",
        "request": {
            "remote_ip": ip,
            "remote_port": "51234",
            "client_ip": ip,
            "proto": "HTTP/1.1",
            "method": "GET",
            "host": "localhost:8080",
            "uri": uri,
            "headers": {"User-Agent": [ua], "Accept": ["*/*"]},
        },
        "bytes_read": 0,
        "duration": 0.002,
        "size": 120,
        "status": status,
        "resp_headers": {"Content-Type": ["text/html"]},
    }
    return json.dumps(entry) + "\n"


def scanner_burst(ip: str, start: float = T0) -> list[str]:
    """/.env (R3 at 1), then 11 unlisted paths: R1 at request 5, R2 at request 11."""
    uris = ["/.env"] + [f"/nope-{i:02d}" for i in range(1, 12)]
    return [caddy_line(start + i, ip, SCANNER_UA, uri, 404) for i, uri in enumerate(uris)]


def human_session(ip: str) -> list[str]:
    uris = ["/", "/products", "/products/1", "/static/app.css", "/products/2?ref=home", "/"]
    return [caddy_line(T0 + i * 7, ip, HUMAN_UA, uri) for i, uri in enumerate(uris)]


@pytest.fixture
def routes(tmp_path: Path) -> Path:
    path = tmp_path / "routes.yaml"
    path.write_text(ROUTES_YAML)
    return path


def _replay(log: Path, routes: Path) -> subprocess.CompletedProcess[str]:
    cmd = [sys.executable, "-m", "engine", "replay", str(log)]
    cmd += ["--routes", str(routes), "--rules", str(RULES)]
    return subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=30, check=False)


def _parse_jsonl(text: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def test_replay_prints_one_json_verdict_per_line_for_probing(tmp_path: Path, routes: Path) -> None:
    log = tmp_path / "probe.jsonl"
    log.write_text("".join(scanner_burst("203.0.113.7")))
    result = _replay(log, routes)
    assert result.returncode == 0, result.stderr
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    verdicts = [json.loads(line) for line in lines]
    assert [(v["rule"], v["request_count"]) for v in verdicts] == [("R3", 1), ("R1", 5), ("R2", 11)]
    for v in verdicts:
        assert v["session_id"] == f"203.0.113.7|{SCANNER_UA}"
        assert v["ip"] == "203.0.113.7"
        assert v["user_agent"] == SCANNER_UA
        assert v["verdict"] == "probing"
        assert v["critical"] is (v["rule"] == "R3")
    assert [v["ts"] for v in verdicts] == [T0, T0 + 4, T0 + 10]


def test_replay_prints_nothing_for_benign(tmp_path: Path, routes: Path) -> None:
    log = tmp_path / "human.jsonl"
    log.write_text("".join(human_session("192.0.2.10")))
    result = _replay(log, routes)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == ""


def test_replay_skips_bad_lines_and_flags_only_the_prober(tmp_path: Path, routes: Path) -> None:
    noise = ["not json at all\n", json.dumps({"level": "info", "logger": "tls", "msg": "x"}) + "\n"]
    lines = human_session("192.0.2.10") + noise + scanner_burst("203.0.113.7")
    log = tmp_path / "mixed.jsonl"
    log.write_text("".join(lines))
    result = _replay(log, routes)
    assert result.returncode == 0, result.stderr
    verdicts = _parse_jsonl(result.stdout)
    assert {v["session_id"] for v in verdicts} == {f"203.0.113.7|{SCANNER_UA}"}
    assert len(verdicts) == 3


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        port: int = sock.getsockname()[1]
        return port


def _stop(proc: subprocess.Popen[bytes]) -> None:
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


def _spawn(args: list[str], err_path: Path) -> subprocess.Popen[bytes]:
    with err_path.open("wb") as err:
        return subprocess.Popen(
            [sys.executable, *args], cwd=REPO, stdout=subprocess.DEVNULL, stderr=err
        )


def _api(base: str) -> list[dict[str, Any]]:
    with urllib.request.urlopen(f"{base}/api/verdicts", timeout=2.0) as resp:
        items: list[dict[str, Any]] = json.loads(resp.read())
        return items


def _sessions(base: str) -> set[str]:
    return {str(item.get("session_id")) for item in _api(base)}


@pytest.fixture
def procs() -> Iterator[list[subprocess.Popen[bytes]]]:
    started: list[subprocess.Popen[bytes]] = []
    yield started
    for proc in reversed(started):
        _stop(proc)


@pytest.fixture
def dashboard_url(tmp_path: Path, procs: list[subprocess.Popen[bytes]]) -> str:
    port = _free_port()
    db = tmp_path / "verdicts.db"
    args = ["-m", "dashboard", "--port", str(port), "--db", str(db)]
    proc = _spawn(args, tmp_path / "dashboard.err")
    procs.append(proc)
    base = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + STARTUP_TIMEOUT
    while time.monotonic() < deadline:
        assert proc.poll() is None, (tmp_path / "dashboard.err").read_text()
        try:
            _api(base)
            return base
        except OSError:
            time.sleep(0.05)
    pytest.fail("dashboard did not start")


def _start_follow(
    log: Path, routes: Path, base: str, procs: list[subprocess.Popen[bytes]], *extra: str
) -> Path:
    err_path = log.with_suffix(".follow.err")
    args = ["-m", "engine", "follow", str(log), "--webhook", f"{base}/webhook"]
    args += ["--routes", str(routes), "--rules", str(RULES), *extra]
    procs.append(_spawn(args, err_path))
    return err_path


def _append(log: Path, lines: list[str]) -> None:
    with log.open("a") as fh:
        fh.write("".join(lines))
        fh.flush()


def _wait_for_session(base: str, session: str, timeout: float, err: Path) -> float:
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        if session in _sessions(base):
            return time.monotonic() - started
        time.sleep(0.05)
    pytest.fail(f"no verdict for {session} within {timeout}s; follow stderr: {err.read_text()}")


def test_follow_from_start_posts_verdict_within_latency_target(
    tmp_path: Path, routes: Path, dashboard_url: str, procs: list[subprocess.Popen[bytes]]
) -> None:
    log = tmp_path / "access.log"
    log.write_text(caddy_line(T0, "198.51.100.1", "warmup/1.0", "/.env", 404))
    err = _start_follow(log, routes, dashboard_url, procs, "--from-start")
    _wait_for_session(dashboard_url, "198.51.100.1|warmup/1.0", STARTUP_TIMEOUT, err)
    _append(log, scanner_burst("203.0.113.7", T0 + 100))
    session = f"203.0.113.7|{SCANNER_UA}"
    elapsed = _wait_for_session(dashboard_url, session, LATENCY_TARGET, err)
    assert elapsed < LATENCY_TARGET
    deadline = time.monotonic() + LATENCY_TARGET
    rules: list[str] = []
    while time.monotonic() < deadline and len(rules) < 3:
        rules = [str(v["rule"]) for v in _api(dashboard_url) if v.get("session_id") == session]
        time.sleep(0.05)
    assert sorted(rules) == ["R1", "R2", "R3"]


def test_follow_without_from_start_ignores_existing_lines(
    tmp_path: Path, routes: Path, dashboard_url: str, procs: list[subprocess.Popen[bytes]]
) -> None:
    log = tmp_path / "access.log"
    log.write_text("".join(scanner_burst("198.51.100.50")))
    err = _start_follow(log, routes, dashboard_url, procs)
    fresh = f"203.0.113.9|{SCANNER_UA}"
    deadline = time.monotonic() + STARTUP_TIMEOUT
    while fresh not in _sessions(dashboard_url):
        assert time.monotonic() < deadline, f"follow never posted: {err.read_text()}"
        _append(log, [caddy_line(time.time(), "203.0.113.9", SCANNER_UA, "/.env", 404)])
        time.sleep(0.25)
    time.sleep(0.5)
    assert f"198.51.100.50|{SCANNER_UA}" not in _sessions(dashboard_url)


def test_follow_survives_webhook_outage(
    tmp_path: Path, routes: Path, procs: list[subprocess.Popen[bytes]]
) -> None:
    log = tmp_path / "access.log"
    log.write_text("")
    dead = f"http://127.0.0.1:{_free_port()}"
    _start_follow(log, routes, dead, procs, "--from-start")
    _append(log, scanner_burst("203.0.113.7"))
    time.sleep(1.5)
    assert procs[-1].poll() is None, "follow must keep running when the webhook is down"


def _cli_args(command: str, log: Path, routes: Path) -> list[str]:
    return [command, str(log), "--routes", str(routes), "--rules", str(RULES)]


def test_main_replay_in_process_writes_jsonl(
    tmp_path: Path, routes: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    log = tmp_path / "probe.jsonl"
    log.write_text("".join(scanner_burst("203.0.113.7")))
    assert main(_cli_args("replay", log, routes)) == 0
    assert [v["rule"] for v in _parse_jsonl(capsys.readouterr().out)] == ["R3", "R1", "R2"]


def test_main_reports_missing_log_with_exit_2(
    tmp_path: Path, routes: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(_cli_args("replay", tmp_path / "missing.jsonl", routes)) == 2
    assert "engine:" in capsys.readouterr().err


def test_run_follow_prints_verdicts_when_webhook_is_down(
    tmp_path: Path, routes: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    log = tmp_path / "probe.jsonl"
    log.write_text("".join(scanner_burst("203.0.113.7")))
    detector = Detector(RouteTable.from_yaml(routes), load_thresholds(RULES))
    dead = f"http://127.0.0.1:{_free_port()}/webhook"
    assert run_follow(read_requests(log), detector, dead) == 0
    captured = capsys.readouterr()
    assert len(_parse_jsonl(captured.out)) == 3
    assert captured.err.count(" failed: ") == 3
