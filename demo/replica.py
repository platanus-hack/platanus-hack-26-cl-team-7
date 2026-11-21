"""Copying real rows into the twin's file, one way (the job behind python -m demo.sync).

push(): the projection of the real rows (config/mask.yaml through demo.masking) goes to the
twin: new rows are inserted, changed ones updated, removed ones deleted. A row the twin itself
changed, added or deleted (an agent's checkout, a copied account) is left as the twin has it:
a row is only touched while it still equals what this job last wrote there.

copy(cookie): that real session and its own account (user row, orders, order items and order
history) are copied verbatim, so a flagged agent stays signed in on the twin.
"""

from __future__ import annotations

import contextlib
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path

from demo import db
from demo.mask import project
from demo.masking import Policy, Row
from demo.tables import SESSION_REPLACE, SQL
from demo.web import SESSION_COOKIE, parse_cookies

OWN_ROWS = (
    ("orders", "SELECT * FROM orders WHERE user_id = ? ORDER BY id"),
    (
        "order_items",
        "SELECT * FROM order_items WHERE order_id IN"
        " (SELECT id FROM orders WHERE user_id = ?) ORDER BY id",
    ),
    (
        "order_events",
        "SELECT * FROM order_events WHERE order_id IN"
        " (SELECT id FROM orders WHERE user_id = ?) ORDER BY id",
    ),
)


@dataclass(frozen=True)
class Copied:
    user_id: int
    orders: int


class Syncer:
    """The push and the copy. One lock keeps them from writing the twin at the same time."""

    def __init__(self, real: Path, twin: Path, policy: Policy) -> None:
        self.real, self.twin, self.policy = real, twin, policy
        self._lock = threading.Lock()
        self._ours: dict[str, dict[int, Row]] = {}
        projection = project(real, policy)
        with self._lock, contextlib.closing(db.connect(twin)) as conn:
            for table, rows in projection.tables.items():
                current = _rows(conn, table)
                self._ours[table] = {i: r for i, r in rows.items() if current.get(i) == r}

    def push(self) -> dict[str, int]:
        """One push; returns how many rows it inserted, updated and deleted."""
        projection = project(self.real, self.policy)
        counts = {"inserted": 0, "updated": 0, "deleted": 0}
        ours: dict[str, dict[int, Row]] = {}
        with self._lock, contextlib.closing(db.connect(self.twin)) as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                for table, rows in projection.tables.items():
                    ours[table] = self._push_table(conn, table, rows, counts)
            self._ours = ours  # only after the commit: a failed push leaves the old record
        return counts

    def _push_table(
        self, conn: sqlite3.Connection, table: str, rows: dict[int, Row], counts: dict[str, int]
    ) -> dict[int, Row]:
        sql, last, current = SQL[table], self._ours.get(table, {}), _rows(conn, table)
        ours: dict[int, Row] = {}
        for row_id, row in rows.items():
            now, mine = current.get(row_id), last.get(row_id)
            if now is None and mine is None:
                conn.execute(sql.replace, row)
                counts["inserted"] += 1
            elif now is not None and now in (mine, row):
                if now != row:
                    conn.execute(sql.replace, row)
                    counts["updated"] += 1
            else:  # the twin changed, added or deleted this row: keep the twin's version
                if mine is not None:
                    ours[row_id] = mine
                continue
            ours[row_id] = row
        for row_id, mine in last.items():
            if row_id not in rows and current.get(row_id) == mine:
                conn.execute(sql.delete, (row_id,))
                counts["deleted"] += 1
        return ours

    def copy(self, cookie: str) -> Copied | None:
        token = parse_cookies(cookie).get(SESSION_COOKIE) or cookie.strip()
        if not token:
            return None
        with contextlib.closing(_read_only(self.real)) as real:
            session = real.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
            if session is None:
                return None
            user_id = int(session["user_id"])
            user = real.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if user is None:
                return None
            own = [(table, real.execute(query, (user_id,)).fetchall()) for table, query in OWN_ROWS]
        with self._lock, contextlib.closing(db.connect(self.twin)) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(SESSION_REPLACE, tuple(session))
            conn.execute(SQL["users"].replace, tuple(user))
            for table, rows in own:
                conn.executemany(SQL[table].replace, [tuple(row) for row in rows])
        return Copied(user_id, len(own[0][1]))


def _read_only(path: Path) -> sqlite3.Connection:
    uri = f"{path.resolve().as_uri()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=db.BUSY_SECONDS)
    conn.row_factory = sqlite3.Row
    return conn


def _rows(conn: sqlite3.Connection, table: str) -> dict[int, Row]:
    key = db.columns(conn, table).index("id")
    return {int(row[key]): tuple(row) for row in conn.execute(SQL[table].select_all)}
