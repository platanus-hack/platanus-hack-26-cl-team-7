"""The shop's SQLite storage: one WAL-mode file per instance, the same schema on real and twin.

`injectable` is the connection behind the planted SQL injection. It can only read: an authorizer
allows SELECT and reads and nothing else (no ATTACH, no PRAGMA, no writes, no extension loading),
values are capped in size and every statement gets a fixed step budget. An injected query can
read this instance's own tables, as a real flaw would, and can never touch a host file.
"""

from __future__ import annotations

import contextlib
import sqlite3
from collections.abc import Callable, Iterator
from pathlib import Path

BUSY_SECONDS = 5.0
MAX_VALUE_BYTES = 64 * 1024
PROGRESS_EVERY = 1000  # VM instructions between progress checks
MAX_PROGRESS_CHECKS = 2000  # about two million VM instructions per injectable statement
BLOCKED_FUNCTIONS = frozenset({"load_extension", "fts3_tokenizer", "zeroblob", "randomblob"})

SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
  price_cents INTEGER NOT NULL, stock INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE, name TEXT, email TEXT UNIQUE, phone TEXT,
  address TEXT, role TEXT NOT NULL, password_hash TEXT, avatar_url TEXT,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, status TEXT NOT NULL,
  total_cents INTEGER NOT NULL, ship_name TEXT, ship_address TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL, price_cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS orders_by_user ON orders (user_id);
CREATE INDEX IF NOT EXISTS items_by_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS events_by_order ON order_events (order_id);
"""

_ALLOWED_ACTIONS = frozenset({sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ})


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=BUSY_SECONDS)
    conn.row_factory = sqlite3.Row
    return conn


@contextlib.contextmanager
def opened(path: Path) -> Iterator[sqlite3.Connection]:
    """A connection that commits on success, rolls back on error and always closes."""
    conn = connect(path)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def create(path: Path) -> None:
    """Create the schema in WAL mode. Safe on an existing database."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
    finally:
        conn.close()


def build(path: Path, fill: Callable[[sqlite3.Connection], None]) -> None:
    """Write a whole new database next to `path`, then swap it in with one rename, so a reader
    sees the old file or the new one and never half of either."""
    partial = path.with_name(path.name + ".part")
    for leftover in (partial, *_sidecars(partial)):
        leftover.unlink(missing_ok=True)
    create(partial)
    conn = connect(partial)
    try:
        with conn:
            fill(conn)
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        conn.close()
    for stale in _sidecars(path):
        stale.unlink(missing_ok=True)
    partial.replace(path)


def _sidecars(path: Path) -> tuple[Path, Path]:
    return path.with_name(path.name + "-wal"), path.with_name(path.name + "-shm")


def columns(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = conn.execute("SELECT name FROM pragma_table_info(?)", (table,)).fetchall()
    return [str(row[0]) for row in rows]


def _authorize(action: int, arg1: str | None, arg2: str | None, *_: str | None) -> int:
    if action in _ALLOWED_ACTIONS:
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_FUNCTION and (arg2 or "").lower() not in BLOCKED_FUNCTIONS:
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


@contextlib.contextmanager
def injectable(path: Path) -> Iterator[sqlite3.Connection]:
    """A read-only connection for text-built SQL (see the module docstring). The step budget
    covers the connection's whole life, which is one statement."""
    conn = connect(path)
    try:
        conn.execute("PRAGMA query_only = ON")
        conn.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_VALUE_BYTES)
        conn.set_authorizer(_authorize)
        checks = 0

        def tick() -> int:
            nonlocal checks
            checks += 1
            return int(checks > MAX_PROGRESS_CHECKS)

        conn.set_progress_handler(tick, PROGRESS_EVERY)
        yield conn
    finally:
        conn.close()
