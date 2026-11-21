"""The local stack under test (scripts/stack_local.sh) and what it leaves in run/: service control,
shop logs, the real database digest and Sentinel's event table.

The stack starts with PYTHONUNBUFFERED=1, so each shop writes its request log line at once and
run/real.log shows every request the real shop got while the harness runs. Every command is a
literal argument list.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import signal
import sqlite3
import subprocess
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN = ROOT / "run"
ROUTER_STATE = ("mirror-keys.jsonl", "mirror-spool.jsonl", "mirror-patches.jsonl")
STOP_WAIT = 8.0  # seconds after SIGTERM before SIGKILL (the router flushes its reporter first)
POLL = 0.05
# The private tables of run/real.db (config/mask.yaml masks or drops their columns) and the SQL
# that reads each whole table in a stable order.
PRIVATE_TABLES = {
    "users": "SELECT * FROM users ORDER BY id",
    "orders": "SELECT * FROM orders ORDER BY id",
    "order_items": "SELECT * FROM order_items ORDER BY id",
    "order_events": "SELECT * FROM order_events ORDER BY id",
    "sessions": "SELECT * FROM sessions ORDER BY token",
}
COUNT_TRACK_ACTIONS = "SELECT COUNT(*) FROM deception_events WHERE track_id = ? AND type = ?"
ACTION_QUERIES = "SELECT body FROM deception_events WHERE track_id = ? AND type = ?"
COUNT_EVENTS = "SELECT COUNT(*) FROM deception_events"
COUNT_EVENT_IDS = (
    "SELECT COUNT(*) FROM deception_events WHERE event_id IN (SELECT value FROM json_each(?))"
)


class StackError(RuntimeError):
    """scripts/stack_local.sh failed."""


def _env() -> dict[str, str]:
    return {**os.environ, "PYTHONUNBUFFERED": "1"}


def start() -> None:
    _check("start", subprocess.run(["/bin/bash", "scripts/stack_local.sh", "start"],
                                   cwd=ROOT, env=_env(), capture_output=True, text=True,
                                   check=False))


def stop() -> None:
    _check("stop", subprocess.run(["/bin/bash", "scripts/stack_local.sh", "stop"],
                                  cwd=ROOT, env=_env(), capture_output=True, text=True,
                                  check=False))


def start_router() -> None:
    _check("start router", subprocess.run(
        ["/bin/bash", "scripts/stack_local.sh", "start", "router"],
        cwd=ROOT, env=_env(), capture_output=True, text=True, check=False))


def start_sentinel() -> None:
    _check("start sentinel", subprocess.run(
        ["/bin/bash", "scripts/stack_local.sh", "start", "sentinel"],
        cwd=ROOT, env=_env(), capture_output=True, text=True, check=False))


def _check(what: str, done: subprocess.CompletedProcess[str]) -> None:
    if done.returncode:
        raise StackError(f"stack_local.sh {what} exited {done.returncode}: {done.stderr[-800:]}")


def reset_router_state() -> list[str]:
    """Deletes the router's keys, spool and patches from earlier runs (only while it is stopped),
    so 127.0.0.1 starts clean. Returns the files it deleted."""
    gone = [name for name in ROUTER_STATE if (RUN / name).exists()]
    for name in gone:
        (RUN / name).unlink()
    return gone


def kill(service: str) -> int:
    """Stops one service and its child processes (Sentinel runs under pnpm), as stack_local.sh
    stop does for all; returns the pid. `start_<service>()` starts it again."""
    pid = int((RUN / f"{service}.pid").read_text().strip())
    tree = _tree(pid)
    for each in tree:
        with contextlib.suppress(ProcessLookupError):
            os.kill(each, signal.SIGTERM)
    deadline = time.monotonic() + STOP_WAIT
    while any(map(_alive, tree)) and time.monotonic() < deadline:
        time.sleep(POLL)
    for each in filter(_alive, tree):
        with contextlib.suppress(ProcessLookupError):
            os.kill(each, signal.SIGKILL)
    return pid


def _tree(pid: int) -> list[int]:
    table = subprocess.run(["/bin/ps", "-axo", "pid=,ppid="], capture_output=True, text=True,
                           check=True).stdout
    children: dict[int, list[int]] = defaultdict(list)
    for line in table.splitlines():
        child, parent = (int(part) for part in line.split())
        children[parent].append(child)
    tree, todo = [], [pid]
    while todo:
        tree.append(todo.pop())
        todo.extend(children[tree[-1]])
    return tree


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def text(name: str) -> str:
    """A file in run/ as text, or "" when it does not exist."""
    path = RUN / name
    return path.read_text("utf-8", "replace") if path.exists() else ""


def size(name: str) -> int:
    path = RUN / name
    return path.stat().st_size if path.exists() else 0


def digest(db: Path) -> dict[str, tuple[int, str]]:
    """Row count and sha256 of each private table, read through a read-only connection."""
    out: dict[str, tuple[int, str]] = {}
    with contextlib.closing(sqlite3.connect(f"file:{db}?mode=ro", uri=True)) as conn:
        for table, sql in PRIVATE_TABLES.items():
            rows = conn.execute(sql).fetchall()
            out[table] = (len(rows), hashlib.sha256(repr(rows).encode()).hexdigest()[:16])
    return out


def sentinel_rows(sql: str, *params: str) -> list[tuple[object, ...]]:
    """Rows of a read-only query on run/sentinel.db."""
    uri = f"file:{RUN / 'sentinel.db'}?mode=ro"
    with contextlib.closing(sqlite3.connect(uri, uri=True, timeout=5)) as conn:
        return conn.execute(sql, params).fetchall()


def sentinel_count(sql: str, *params: str) -> int:
    value = sentinel_rows(sql, *params)[0][0]
    return int(value) if isinstance(value, int) else -1
