"""Copying real rows into the twin's file, one way (the job behind python -m demo.sync).

push(): the projection of the real rows (config/mask.yaml through demo.masking) goes to the
twin: new rows are inserted, changed ones updated, removed ones deleted. A row the twin holds
for itself (an agent's checkout, a changed picture) is left as the twin has it: this job writes
a row only where the twin has none or still has the one this job wrote.

An order moves whole. Both shops number a new row max + 1, so an agent's checkout on the twin
takes the ids the next real order gets. When the twin holds the id of a real order or of one of
its items or history rows, that real order and all of its rows stay out of the twin, so no order
ever shows rows of another. New real orders of an account the agent changed on the twin stay out
too: that account changes only by what the agent does.

copy(cookie): the flagged agent's real session row (token, user id, date: the cookie it already
holds) and its own account (user row, orders, order items and order history) go to the twin, so
the agent stays signed in there. The account comes from the same masked projection as push, so
the twin never holds a real private value (the password hash, name, email, phone and address are
NULL or made up); the session row is the one real value, and the twin's SQL cannot read it (see
demo.db). The same rules apply, so a second copy of the same session changes nothing.

real_values(values): the values the real database holds as a username, email or session token.
The router asks before it binds a value the twin gave out to a track, so a real user is never
routed to the twin by their own identity. The real file is only read.
"""

from __future__ import annotations

import contextlib
import sqlite3
import threading
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from demo import db
from demo.db import SESSION_REPLACE, SQL
from demo.masking import Policy, Row, Tables, project
from demo.web import SESSION_COOKIE, parse_cookies

IS_REAL = (
    "SELECT 1 FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)"
    " UNION ALL SELECT 1 FROM sessions WHERE token = ? LIMIT 1"
)


@dataclass(frozen=True)
class Copied:
    user_id: int
    orders: int


class Syncer:
    """The push, the copy and real_values. Push and copy take one lock so they never write the
    twin at the same time; real_values only reads the real file and takes no lock. `_ours` holds,
    per table and id, the row this job last wrote and the twin still has."""

    def __init__(self, real: Path, twin: Path, policy: Policy) -> None:
        if not twin.is_file():
            raise FileNotFoundError(f"{twin}: no twin database (run python -m demo.mask first)")
        self.real, self.twin, self.policy = real, twin, policy
        self._lock = threading.Lock()
        projection = project(real, policy)
        with contextlib.closing(db.connect(twin, db.EXISTING)) as conn:
            current = _read(conn, projection.tables)
        self._ours: Tables = {
            table: {i: row for i, row in rows.items() if current[table].get(i) == row}
            for table, rows in projection.tables.items()
        }

    def real_values(self, values: list[str]) -> list[str]:
        """The values, as given, that the real database holds as a username, email or session
        token (a username or email is compared without regard to case)."""
        with contextlib.closing(db.connect(self.real, db.READ_ONLY)) as conn:
            return [v for v in values if conn.execute(IS_REAL, (v, v, v)).fetchone() is not None]

    def push(self) -> dict[str, int]:
        """One push in one transaction; returns how many rows it inserted, updated and deleted."""
        projection = project(self.real, self.policy)
        counts: Counter[str] = Counter(inserted=0, updated=0, deleted=0)
        ours: Tables = {}
        with self._lock, contextlib.closing(db.connect(self.twin, db.EXISTING)) as conn:
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                current = _read(conn, projection.tables)
                blocked = self._blocked(projection.columns, projection.tables, current)
                for table, rows in projection.tables.items():
                    order = _index(projection.columns, table, SQL[table].order_key)
                    last = self._ours.get(table, {})
                    wanted = {
                        i: row
                        for i, row in rows.items()
                        if i in last or order is None or row[order] not in blocked
                    }
                    ours[table], done = self._push_table(conn, table, wanted, current[table])
                    counts.update(done)
            self._ours = ours  # only after the commit: a failed push leaves the old record
        return dict(counts)

    def _push_table(
        self, conn: sqlite3.Connection, table: str, wanted: dict[int, Row], current: dict[int, Row]
    ) -> tuple[dict[int, Row], Counter[str]]:
        sql, last = SQL[table], self._ours.get(table, {})
        ours: dict[int, Row] = {}
        done: Counter[str] = Counter()
        for row_id, row in wanted.items():
            now, mine = current.get(row_id), last.get(row_id)
            if now is None and mine is None:
                conn.execute(sql.replace, row)
                done["inserted"] += 1
            elif now is not None and now in (mine, row):
                if now != row:
                    conn.execute(sql.replace, row)
                    done["updated"] += 1
            else:  # the twin holds this id for itself, or deleted the row: keep the twin's version
                if mine is not None:
                    ours[row_id] = mine
                continue
            ours[row_id] = row
        for row_id, mine in last.items():
            if row_id not in wanted and current.get(row_id) == mine:
                conn.execute(sql.delete, (row_id,))
                done["deleted"] += 1
        return ours, done

    def _held(self, table: str, row_id: int, row: Row, current: Mapping[int, Row]) -> bool:
        """The twin has another row at this id than `row` and than the one this job wrote."""
        return current.get(row_id) not in (None, row, self._ours.get(table, {}).get(row_id))

    def _blocked(
        self, columns: Mapping[str, list[str]], wanted: Tables, current: Tables
    ) -> set[object]:
        """Ids of the orders that stay out of the twin: one the twin holds a row of (the order
        itself or one of its rows), and any order of an account the twin holds for itself."""
        users, twin_users = wanted.get("users", {}), current.get("users", {})
        held_users = {i for i, row in users.items() if self._held("users", i, row, twin_users)}
        blocked: set[object] = set()
        for table, rows in wanted.items():
            order = _index(columns, table, SQL[table].order_key)
            if order is None:
                continue
            owner = _index(columns, table, SQL[table].user_key)
            for row_id, row in rows.items():
                held_account = owner is not None and row[owner] in held_users
                if held_account or self._held(table, row_id, row, current[table]):
                    blocked.add(row[order])
        return blocked

    def copy(self, cookie: str) -> Copied | None:
        token = parse_cookies(cookie).get(SESSION_COOKIE) or cookie.strip()
        if not token:
            return None
        with contextlib.closing(db.connect(self.real, db.READ_ONLY)) as real:
            session = real.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
        if session is None:
            return None
        user_id = int(session["user_id"])
        projection = project(self.real, self.policy)
        own = projection.account(user_id)
        if not own.get("users"):
            return None
        with self._lock, contextlib.closing(db.connect(self.twin, db.EXISTING)) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(SESSION_REPLACE, tuple(session))
            current = _read(conn, own)
            blocked = self._blocked(projection.columns, own, current)
            orders = 0
            for table, rows in own.items():
                order = _index(projection.columns, table, SQL[table].order_key)
                for row_id, row in rows.items():
                    if self._held(table, row_id, row, current[table]) or (
                        order is not None and row[order] in blocked
                    ):
                        continue
                    conn.execute(SQL[table].replace, row)
                    orders += table == "orders"
        return Copied(user_id, orders)


def _index(columns: Mapping[str, list[str]], table: str, key: str | None) -> int | None:
    return None if key is None else columns[table].index(key)


def _read(conn: sqlite3.Connection, tables: Mapping[str, object]) -> Tables:
    """The rows the twin holds for each of `tables`, by id."""
    out: Tables = {}
    for table in tables:
        key = db.columns(conn, table).index("id")
        out[table] = {int(row[key]): tuple(row) for row in conn.execute(SQL[table].select_all)}
    return out
