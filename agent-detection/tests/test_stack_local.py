"""scripts/stack_local.sh run from a copy of the repo with fake `uv`, python, pnpm and caddy.
The fake python logs every `python -m` call to run/calls.log; services listen where their flags
say and write the ingest token they got to run/<service>.seen-token; `-c` runs the real python
(the socket probe). FAKE_FAIL=<seed|mask|config> fails that step, FAKE_CRASH=<service> kills it
before it listens, FAKE_SKIP=<endpoint> leaves one endpoint unbound. Free ports per test.
"""

from __future__ import annotations

import os
import re
import shutil
import socket
import stat
import subprocess
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SERVICES = ("sentinel", "real", "twin", "sync", "router", "caddy")
FAKE_UV = """#!/bin/sh
echo "$FAKE_PYTHON"
"""
FAKE_PYTHON = """#!{python}
import os, socket, sys, time
from pathlib import Path

args = sys.argv[1:]
if args[0] == "-c":
    os.execv(sys.executable, [sys.executable, *args])
module, rest = args[1], args[2:]
with open("run/calls.log", "a") as calls:
    calls.write(" ".join([module, *rest]) + "\\n")
if os.environ.get("FAKE_FAIL") in (module.removeprefix("demo."), module == "engine" and "config"):
    sys.exit(f"Traceback: {{module}} broke")
if module in ("engine", "demo.seed", "demo.mask"):
    sys.exit(0)

def opt(name):
    return rest[rest.index(name) + 1]

if module == "listen":
    who, endpoints = rest[0], rest[1:]
elif module == "mirror":
    who, endpoints = "router", [opt("--lane"), opt("--tap"), "port:" + opt("--relay").split(":")[1]]
else:
    who, endpoints = Path(opt("--socket")).stem, [opt("--socket")]
Path("run", who + ".seen-token").write_text(os.environ.get("SENTINEL_INGEST_TOKEN", ""))
if os.environ.get("FAKE_CRASH") == who:
    time.sleep(0.3)
    sys.exit("Traceback: crash")
held = []
for endpoint in set(endpoints) - {{os.environ.get("FAKE_SKIP")}}:
    tcp = endpoint.startswith("port:")
    if not tcp:
        Path(endpoint).unlink(missing_ok=True)
    held.append(socket.socket(socket.AF_INET if tcp else socket.AF_UNIX))
    held[-1].bind(("127.0.0.1", int(endpoint[5:])) if tcp else endpoint)
    held[-1].listen(128)
time.sleep(30)
"""
# pnpm runs Sentinel as its child: only a stop that signals the whole tree frees the port.
FAKE_PNPM = """#!/bin/sh
echo "$* db=$SENTINEL_DB" >run/pnpm.args
"$FAKE_PYTHON" -m listen sentinel "port:$SENTINEL_PORT" &
wait
"""
FAKE_CADDY = """#!/bin/sh
echo "$@" >run/caddy.args
exec "$FAKE_PYTHON" -m listen caddy "port:$STACK_EDGE_PORT"
"""
TOKEN = re.compile(r"^[0-9a-f]{64}$")
PORTS = ("STACK_RELAY_PORT", "SENTINEL_PORT", "STACK_EDGE_PORT")


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _port_open(port: int) -> bool:
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) == 0


@dataclass
class Stack:
    root: Path
    env: dict[str, str]

    def run(self, *args: str, **extra: str) -> subprocess.CompletedProcess[str]:
        script = ["bash", str(self.root / "scripts" / "stack_local.sh"), *args]
        env = {**self.env, **extra}
        return subprocess.run(
            script, env=env, check=False, capture_output=True, text=True, timeout=120
        )

    def pid_file(self, name: str) -> Path:
        return self.root / "run" / f"{name}.pid"

    def calls(self) -> list[str]:
        log = self.root / "run" / "calls.log"
        return log.read_text().splitlines() if log.exists() else []


@pytest.fixture
def stack(tmp_path: Path) -> Iterator[Stack]:
    (tmp_path / "scripts").mkdir()
    shutil.copy(REPO / "scripts" / "stack_local.sh", tmp_path / "scripts")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fakes = {"uv": FAKE_UV, "pnpm": FAKE_PNPM, "caddy": FAKE_CADDY}
    for name, text in {**fakes, "python": FAKE_PYTHON.format(python=sys.executable)}.items():
        (bin_dir / name).write_text(text)
        (bin_dir / name).chmod(stat.S_IRWXU)
    (tmp_path / "run").mkdir()
    env = {
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "HOME": str(tmp_path),
        "FAKE_PYTHON": str(bin_dir / "python"),
        **{name: str(_free_port()) for name in PORTS},
    }
    made = Stack(tmp_path, env)
    yield made
    made.run("stop")


@pytest.fixture
def bystander() -> Iterator[subprocess.Popen[bytes]]:
    proc = subprocess.Popen(["sleep", "30"])
    yield proc
    proc.kill()
    proc.wait(timeout=5)


def test_full_start_seeds_once_runs_every_service_and_stop_ends_them(stack: Stack) -> None:
    started = stack.run("start")
    assert started.returncode == 0, started.stderr
    assert all(f"{name}: started (pid" in started.stdout for name in SERVICES)
    relay, sentinel, edge = (stack.env[name] for name in PORTS)
    calls = stack.calls()
    assert calls == [
        "demo.seed --db run/real.db",
        "demo.mask --from run/real.db --to run/twin.db --allow config/mask.yaml"
        " --canaries run/canaries.json",
        f"listen sentinel port:{sentinel}",
        "demo --socket run/real.sock --db run/real.db --files run/real-files",
        "demo --socket run/twin.sock --db run/twin.db --files run/twin-files"
        f" --egress-proxy http://127.0.0.1:{relay}",
        "demo.sync --socket run/sync.sock --real run/real.db --twin run/twin.db",
        "engine replay /dev/null",
        f"mirror --lane run/lane.sock --tap run/tap.sock --relay 127.0.0.1:{relay}"
        " --relay-block-host localhost --real run/real.sock --twin run/twin.sock"
        f" --sync run/sync.sock --sentinel http://127.0.0.1:{sentinel} --state"
        " run/mirror-keys.jsonl --spool run/mirror-spool.jsonl --canaries run/canaries.json",
        f"listen caddy port:{edge}",
    ]
    run = stack.root / "run"
    pnpm = f"--filter @sentinel/server start db={run / 'sentinel.db'}\n"
    assert (run / "pnpm.args").read_text() == pnpm
    caddy = "run --config deploy/Caddyfile.local --adapter caddyfile\n"
    assert (run / "caddy.args").read_text() == caddy
    assert stack.run("status").stdout.count(": running (pid") == len(SERVICES)
    again = stack.run("start")
    assert again.returncode == 0 and again.stdout.count("already running") == len(SERVICES)
    assert stack.calls() == calls, "a second start ran a job or launched a service"
    ports = [int(port) for port in (relay, sentinel, edge)]
    assert all(_port_open(port) for port in ports)
    stopped = stack.run("stop")
    assert all(f"{name}: stopped (pid" in stopped.stdout for name in SERVICES)
    assert not any(_port_open(port) for port in ports), "pnpm's child kept the Sentinel port"
    assert all(f"{n}: stopped" in stack.run("status").stdout for n in SERVICES)


def test_one_generated_token_reaches_sentinel_and_the_router_only(stack: Stack) -> None:
    assert stack.run("start").returncode == 0
    token_file = stack.root / "run" / "sentinel.token"
    token = token_file.read_text().strip()
    assert TOKEN.match(token) and stat.S_IMODE(token_file.stat().st_mode) == 0o600
    seen = {name: (stack.root / "run" / f"{name}.seen-token").read_text() for name in SERVICES}
    no_token = {name: "" for name in ("real", "twin", "sync", "caddy")}
    assert seen == {**no_token, "sentinel": token, "router": token}
    assert stack.run("stop").returncode == 0
    assert stack.run("start", "router").returncode == 0
    assert token_file.read_text().strip() == token, "a restart must keep the token"


def test_sentinel_and_caddy_alone_run_no_data_job(stack: Stack) -> None:
    assert stack.run("start", "sentinel", "caddy").returncode == 0
    assert [call.split()[:2] for call in stack.calls()] == [
        ["listen", "sentinel"],
        ["listen", "caddy"],
    ]
    assert (stack.root / "run" / "sentinel.token").exists()


@pytest.mark.parametrize("job", ["seed", "mask"])
def test_failed_job_stops_the_start_and_runs_again_next_time(stack: Stack, job: str) -> None:
    failed = stack.run("start", FAKE_FAIL=job)
    assert failed.returncode == 1
    assert f"{job}: failed" in failed.stderr and f"Traceback: demo.{job} broke" in failed.stderr
    assert not any(stack.pid_file(name).exists() for name in SERVICES)
    assert stack.run("start", "real").returncode == 0
    assert sum(c.startswith(f"demo.{job}") for c in stack.calls()) == 2
    assert all((stack.root / "run" / f"{done}.done").exists() for done in ("seed", "mask"))


def test_a_new_seed_redoes_the_mask(stack: Stack) -> None:
    assert stack.run("start", "real").returncode == 0
    (stack.root / "run" / "seed.done").unlink()
    assert stack.run("start", "twin").returncode == 0
    jobs = [c.split()[0] for c in stack.calls() if c.startswith("demo.")]
    assert jobs[:2] == jobs[2:4] == ["demo.seed", "demo.mask"]


@pytest.mark.parametrize(
    ("name", "fault", "missing"),
    [("twin", {"FAKE_CRASH": "twin"}, "twin"), ("router", {"FAKE_SKIP": "run/tap.sock"}, "tap")],
    ids=["crashed", "one-socket-short"],
)
def test_service_that_does_not_listen_everywhere_is_a_failed_start_naming_what_is_missing(
    stack: Stack, name: str, fault: dict[str, str], missing: str
) -> None:
    result = stack.run("start", name, STACK_READY_TICKS="10", **fault)
    assert result.returncode == 1, result.stdout
    assert f"{name}: failed to start, no socket run/{missing}.sock; last lines" in result.stderr
    assert result.stderr.count(", no ") == 1
    assert f"{name}: stopped" in stack.run("status").stdout and not stack.pid_file(name).exists()


def test_bad_detector_config_fails_before_the_router_is_launched(stack: Stack) -> None:
    result = stack.run("start", "router", FAKE_FAIL="config")
    assert result.returncode == 1
    assert "router: config check failed" in result.stderr and "engine broke" in result.stderr
    assert not stack.pid_file("router").exists()
    assert not any(c.startswith("mirror ") for c in stack.calls())


def test_live_socket_of_another_server_is_refused_and_a_stale_one_is_not(
    stack: Stack, monkeypatch: pytest.MonkeyPatch
) -> None:
    sock_path = stack.root / "run" / "real.sock"
    monkeypatch.chdir(stack.root)  # a relative bind: macOS caps AF_UNIX paths near 104 bytes
    with socket.socket(socket.AF_UNIX) as other:
        other.bind("run/real.sock")
        other.listen(1)
        refused = stack.run("start", "real")
        assert refused.returncode == 1
        assert "real: socket run/real.sock is already in use" in refused.stderr
    assert sock_path.exists(), "the stale socket file stays behind for this check"
    assert stack.run("start", "real").returncode == 0


@pytest.mark.parametrize("args", [["restart"], ["start", "dashboard"]])
def test_unknown_command_or_service_is_a_usage_error(stack: Stack, args: list[str]) -> None:
    result = stack.run(*args)
    assert result.returncode == 2 and "usage:" in result.stderr
    assert stack.calls() == [], "a usage error must not start anything"


def test_busy_port_is_refused(stack: Stack) -> None:
    with socket.socket() as other:
        other.bind(("127.0.0.1", int(stack.env["STACK_EDGE_PORT"])))
        other.listen(1)
        refused = stack.run("start", "caddy")
    assert refused.returncode == 1
    assert f"caddy: port {stack.env['STACK_EDGE_PORT']} is already in use" in refused.stderr


def test_stale_pid_file_never_signals_the_process_that_reused_the_pid(
    stack: Stack, bystander: subprocess.Popen[bytes]
) -> None:
    stack.pid_file("real").write_text(f"{bystander.pid}\n")
    (stack.root / "run" / "caddy.started").write_text("Thu Jan  1 00:00:00 1970\n")
    stack.pid_file("caddy").write_text(f"{bystander.pid}\n")
    assert "real: stopped" in stack.run("status").stdout
    stack.pid_file("real").write_text(f"{bystander.pid}\n")
    result = stack.run("stop")
    assert result.returncode == 0 and "stopped (pid" not in result.stdout
    assert bystander.poll() is None, "stop killed an unrelated process"
    assert not stack.pid_file("real").exists() and not stack.pid_file("caddy").exists()


def test_failed_start_leaves_services_that_were_already_running(
    stack: Stack, bystander: subprocess.Popen[bytes]
) -> None:
    stack.pid_file("real").write_text(f"{bystander.pid}\n")
    ps = ["ps", "-o", "lstart=", "-p", str(bystander.pid)]
    started = subprocess.run(ps, check=True, capture_output=True, text=True).stdout.strip()
    (stack.root / "run" / "real.started").write_text(started + "\n")
    assert f"real: running (pid {bystander.pid})" in stack.run("status").stdout
    result = stack.run("start", "real", "twin", FAKE_CRASH="twin")
    assert result.returncode == 1
    assert "already running" in result.stdout and "real: stopped" not in result.stdout
    assert bystander.poll() is None, "a failed `start twin` killed the running real shop"
