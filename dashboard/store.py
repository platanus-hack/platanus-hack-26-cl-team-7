"""SQLite store for verdicts posted to the dashboard webhook."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS verdicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at REAL NOT NULL,
    payload TEXT NOT NULL
)
"""
DEFAULT_LIMIT = 500
MAX_TEXT = 512  # longest string kept in a stored verdict; longer ones keep a length and a hash


class VerdictStore:
    """One connection per call, so request threads never share a connection."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as conn:
            conn.execute(_SCHEMA)

    def add(self, payload: dict[str, Any]) -> int:
        with self._connection() as conn:
            cursor = conn.execute(
                "INSERT INTO verdicts (received_at, payload) VALUES (?, ?)",
                (time.time(), json.dumps(clip(payload))),
            )
            return int(cursor.lastrowid or 0)

    def recent(self, limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
        with self._connection() as conn:
            rows = conn.execute(
                "SELECT id, received_at, payload FROM verdicts ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [_row(row_id, received_at, payload) for row_id, received_at, payload in rows]

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=5.0)
        try:
            with conn:
                yield conn
        finally:
            conn.close()


def _row(row_id: int, received_at: float, payload: str) -> dict[str, Any]:
    item: dict[str, Any] = json.loads(payload)
    item["id"] = row_id
    item["received_at"] = received_at
    return item


def clip(value: Any) -> Any:
    """Cut every string (keys too) in a JSON value to MAX_TEXT characters, so a session key that
    carries a huge User-Agent is still stored and shown, with a hash to tell long values apart."""
    if isinstance(value, dict):
        return {clip(str(key)): clip(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clip(item) for item in value]
    if isinstance(value, str) and len(value) > MAX_TEXT:
        digest = hashlib.sha256(value.encode("utf-8", "surrogatepass")).hexdigest()[:16]
        return f"{value[:MAX_TEXT]}... [{len(value)} chars, sha256 {digest}]"
    return value
