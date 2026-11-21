"""Fixed SQL for whole-row work on each shop table (mask, sync and copy).

Table names cannot be SQL parameters, so each table has its own literal statements here and
nothing builds SQL from a table name.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TableSql:
    select_all: str
    replace: str
    delete: str
    order_key: str | None = None  # the column with the id of the order this row belongs to
    user_key: str | None = None  # the column with the id of the user this row belongs to


SQL = {
    "products": TableSql(
        "SELECT * FROM products ORDER BY id",
        "INSERT OR REPLACE INTO products VALUES (?, ?, ?, ?, ?, ?)",
        "DELETE FROM products WHERE id = ?",
    ),
    "users": TableSql(
        "SELECT * FROM users ORDER BY id",
        "INSERT OR REPLACE INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        "DELETE FROM users WHERE id = ?",
    ),
    "orders": TableSql(
        "SELECT * FROM orders ORDER BY id",
        "INSERT OR REPLACE INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        "DELETE FROM orders WHERE id = ?",
        "id",
        "user_id",
    ),
    "order_items": TableSql(
        "SELECT * FROM order_items ORDER BY id",
        "INSERT OR REPLACE INTO order_items VALUES (?, ?, ?, ?, ?)",
        "DELETE FROM order_items WHERE id = ?",
        "order_id",
    ),
    "order_events": TableSql(
        "SELECT * FROM order_events ORDER BY id",
        "INSERT OR REPLACE INTO order_events VALUES (?, ?, ?, ?)",
        "DELETE FROM order_events WHERE id = ?",
        "order_id",
    ),
}
SESSION_REPLACE = "INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)"
