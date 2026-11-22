"""Shop queries: catalogue, orders, invoices and the cart cookie. All parameterized."""

from __future__ import annotations

import sqlite3
from typing import Any

from demo import db
from demo.auth import now_iso
from demo.web import CART_COOKIE, Call, Shop

CENTS = 100
MAX_CART_LINES = 20
MAX_QUANTITY = 20
PRODUCT_SQL = "SELECT id, name, description, price_cents, stock FROM products"


def product_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "price": row["price_cents"] / CENTS,
        "stock": row["stock"],
    }


def products(shop: Shop) -> list[dict[str, Any]]:
    with db.opened(shop.db) as conn:
        return [product_dict(r) for r in conn.execute(PRODUCT_SQL + " ORDER BY id")]


def product(shop: Shop, raw_id: str) -> dict[str, Any] | None:
    if not raw_id.isdigit():
        return None
    with db.opened(shop.db) as conn:
        row = conn.execute(PRODUCT_SQL + " WHERE id = ?", (int(raw_id),)).fetchone()
    return product_dict(row) if row else None


def search(shop: Shop, query: str) -> list[dict[str, Any]]:
    pattern = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    sql = PRODUCT_SQL + " WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'"
    with db.opened(shop.db) as conn:
        return [product_dict(r) for r in conn.execute(sql + " ORDER BY id", (pattern, pattern))]


def user(shop: Shop, raw_id: str) -> sqlite3.Row | None:
    if not raw_id.isdigit():
        return None
    with db.opened(shop.db) as conn:
        row: sqlite3.Row | None = conn.execute(
            "SELECT * FROM users WHERE id = ?", (int(raw_id),)
        ).fetchone()
    return row


def orders_of(shop: Shop, user_id: int) -> list[sqlite3.Row]:
    sql = "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC"
    with db.opened(shop.db) as conn:
        return list(conn.execute(sql, (user_id,)))


def invoice(shop: Shop, order_id: int) -> str | None:
    """The invoice text of one order, as /account?invoice=<id>.txt serves it."""
    with db.opened(shop.db) as conn:
        order = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if order is None:
            return None
        lines = conn.execute(
            "SELECT p.name, i.quantity, i.price_cents FROM order_items i"
            " JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id",
            (order_id,),
        ).fetchall()
        history = conn.execute(
            "SELECT status, at FROM order_events WHERE order_id = ? ORDER BY at, id", (order_id,)
        ).fetchall()
    items = [f"  {q} x {name}  ${q * cents / CENTS:.2f}" for name, q, cents in lines]
    return "\n".join(
        [
            f"FreshJuice invoice #{order['id']}",
            f"Date: {order['created_at']}",
            f"Ship to: {order['ship_name'] or ''}",
            f"         {order['ship_address'] or ''}",
            "Items:",
            *items,
            f"Total: ${order['total_cents'] / CENTS:.2f}",
            "History:",
            *(f"  {at}  {status}" for status, at in history),
            "",
        ]
    )


def parse_cart(raw: str) -> dict[int, int]:
    """The cart cookie "<product id>:<quantity>,...". Bad parts are dropped."""
    cart: dict[int, int] = {}
    for part in raw.split(",")[:MAX_CART_LINES]:
        key, _, count = part.partition(":")
        if key.isdigit() and count.isdigit() and 0 < int(count) <= MAX_QUANTITY:
            cart[int(key)] = int(count)
    return cart


def format_cart(cart: dict[int, int]) -> str:
    return ",".join(f"{key}:{count}" for key, count in sorted(cart.items()))


def cart_of(call: Call) -> dict[int, int]:
    """The cart in the request's cart cookie."""
    return parse_cart(call.cookies.get(CART_COOKIE, ""))


def cart_cookie(cart: dict[int, int]) -> str:
    return f"{CART_COOKIE}={format_cart(cart)}; Path=/; SameSite=Lax"


def add_to_cart(cart: dict[int, int], raw_id: str, raw_quantity: str) -> dict[int, int]:
    quantity = int(raw_quantity) if raw_quantity.isdigit() else 1
    if not raw_id.isdigit() or len(cart) >= MAX_CART_LINES and int(raw_id) not in cart:
        return cart
    total = min(cart.get(int(raw_id), 0) + max(quantity, 1), MAX_QUANTITY)
    return {**cart, int(raw_id): total}


def cart_lines(shop: Shop, cart: dict[int, int]) -> list[tuple[dict[str, Any], int]]:
    found = {p["id"]: p for p in products(shop)}
    return [(found[key], count) for key, count in sorted(cart.items()) if key in found]


def place_order(shop: Shop, account: sqlite3.Row, cart: dict[int, int]) -> int | None:
    """Create the order, its items and its first history event in one transaction."""
    lines = cart_lines(shop, cart)
    if not lines:
        return None
    total = sum(round(p["price"] * CENTS) * count for p, count in lines)
    stamp = now_iso()
    with db.opened(shop.db) as conn:
        cursor = conn.execute(
            "INSERT INTO orders (user_id, status, total_cents, ship_name, ship_address,"
            " created_at, updated_at) VALUES (?, 'placed', ?, ?, ?, ?, ?)",
            (account["id"], total, account["name"], account["address"], stamp, stamp),
        )
        order_id = int(cursor.lastrowid or 0)
        conn.executemany(
            "INSERT INTO order_items (order_id, product_id, quantity, price_cents)"
            " VALUES (?, ?, ?, ?)",
            [(order_id, p["id"], count, round(p["price"] * CENTS)) for p, count in lines],
        )
        conn.execute(
            "INSERT INTO order_events (order_id, status, at) VALUES (?, 'placed', ?)",
            (order_id, stamp),
        )
    return order_id


def set_avatar(shop: Shop, user_id: int, url: str) -> None:
    with db.opened(shop.db) as conn:
        conn.execute("UPDATE users SET avatar_url = ? WHERE id = ?", (url, user_id))
