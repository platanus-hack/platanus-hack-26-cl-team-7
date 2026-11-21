"""scripts/stack_local.sh run from a copy of the repo with a fake `uv` and fake services."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]

FAKE_UV = """#!/bin/sh
echo "$FAKE_PYTHON"
"""
# Stands in for `python -m engine ...`: the config check is `replay`, the service is `follow`.
FAKE_PYTHON = """#!/bin/sh
if [ "$3" = replay ]; then
  [ -z "$FAKE_BAD_CONFIG" ] || { echo "yaml.parser.ParserError" >&2; exit 1; }
  exit 0
fi
if [ -n "$FAKE_CRASH" ]; then sleep 0.3; echo "Traceback: crash" >&2; exit 1; fi
exec sleep 30
"""


@dataclass
class Stack:
    root: Path
    env: dict[str, str]

    def run(self, *args: str, **extra: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(self.root / "scripts" / "stack_local.sh"), *args],
            env={**self.env, **extra},
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def pid_file(self, name: str) -> Path:
        return self.root / "run" / f"{name}.pid"


def _executable(path: Path, text: str) -> None:
    path.write_text(text)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


@pytest.fixture
def stack(tmp_path: Path) -> Stack:
    (tmp_path / "scripts").mkdir()
    shutil.copy(REPO / "scripts" / "stack_local.sh", tmp_path / "scripts")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _executable(bin_dir / "uv", FAKE_UV)
    _executable(bin_dir / "python", FAKE_PYTHON)
    (tmp_path / "run").mkdir()
    env = {
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "HOME": str(tmp_path),
        "FAKE_PYTHON": str(bin_dir / "python"),
    }
    return Stack(tmp_path, env)


@pytest.fixture
def bystander() -> Iterator[subprocess.Popen[bytes]]:
    proc = subprocess.Popen(["sleep", "30"])
    yield proc
    proc.kill()
    proc.wait(timeout=5)


def _start_time(pid: int) -> str:
    command = ["ps", "-o", "lstart=", "-p", str(pid)]
    out = subprocess.run(command, check=True, capture_output=True, text=True)
    return out.stdout.strip()


def test_stale_pid_file_never_signals_the_process_that_reused_the_pid(
    stack: Stack, bystander: subprocess.Popen[bytes]
) -> None:
    stack.pid_file("site").write_text(f"{bystander.pid}\n")
    (stack.root / "run" / "caddy.started").write_text("Thu Jan  1 00:00:00 1970\n")
    stack.pid_file("caddy").write_text(f"{bystander.pid}\n")
    assert "site: stopped" in stack.run("status").stdout
    stack.pid_file("site").write_text(f"{bystander.pid}\n")
    result = stack.run("stop")
    assert result.returncode == 0 and "stopped (pid" not in result.stdout
    assert bystander.poll() is None, "stop killed an unrelated process"
    assert not stack.pid_file("site").exists() and not stack.pid_file("caddy").exists()


def test_engine_that_crashes_after_fork_is_a_failed_start(stack: Stack) -> None:
    result = stack.run("start", "engine", FAKE_CRASH="1")
    assert result.returncode == 1, result.stdout
    assert "engine: failed to start" in result.stderr and "crash" in result.stderr
    assert "engine: stopped" in stack.run("status").stdout


def test_bad_engine_config_fails_before_anything_is_launched(stack: Stack) -> None:
    result = stack.run("start", "engine", FAKE_BAD_CONFIG="1")
    assert result.returncode == 1
    assert "engine: config check failed" in result.stderr and "ParserError" in result.stderr
    assert not stack.pid_file("engine").exists()


def test_failed_start_leaves_services_that_were_already_running(
    stack: Stack, bystander: subprocess.Popen[bytes]
) -> None:
    stack.pid_file("site").write_text(f"{bystander.pid}\n")
    (stack.root / "run" / "site.started").write_text(_start_time(bystander.pid) + "\n")
    assert f"site: running (pid {bystander.pid})" in stack.run("status").stdout
    result = stack.run("start", "engine", FAKE_CRASH="1")
    assert result.returncode == 1
    assert "site: stopped" not in result.stdout
    assert bystander.poll() is None, "a failed `start engine` killed the running site"


def test_healthy_engine_starts_and_stops(stack: Stack) -> None:
    started = stack.run("start", "engine")
    assert started.returncode == 0, started.stderr
    assert "engine: started (pid" in started.stdout
    assert "already running" in stack.run("start", "engine").stdout
    assert "engine: running" in stack.run("status").stdout
    assert "engine: stopped (pid" in stack.run("stop").stdout
    assert not stack.pid_file("engine").exists()
