"""scripts/e2e/stack.one: the read-only lookup the live checks use on a shop database."""

from __future__ import annotations

import contextlib
import sqlite3
from pathlib import Path

import pytest

from scripts.e2e import stack


@pytest.fixture
def shop_db(tmp_path: Path) -> Path:
    path = tmp_path / "twin.db"
    with contextlib.closing(sqlite3.connect(path)) as conn, conn:
        conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)")
        conn.executemany("INSERT INTO users VALUES (?, ?)", [(1, "leo.e"), (2, "antonia.l")])
    return path


def test_one_gives_the_first_column_of_the_first_row(shop_db: Path) -> None:
    assert stack.one(shop_db, "SELECT username FROM users WHERE id = ?", 2) == "antonia.l"
    assert stack.one(shop_db, "SELECT username FROM users ORDER BY id LIMIT 1") == "leo.e"


def test_one_gives_none_when_no_row_matches(shop_db: Path) -> None:
    assert stack.one(shop_db, "SELECT username FROM users WHERE id = ?", 99) is None


def test_one_cannot_write(shop_db: Path) -> None:
    with pytest.raises(sqlite3.OperationalError):
        stack.one(shop_db, "DELETE FROM users")
