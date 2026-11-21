"""Log in, sessions and the signed-in user.

PLANTED FLAW 1 (SQL injection login bypass): `login` pastes the username into the SQL text, so
`' OR 1=1 --` signs in as the first user and `' UNION SELECT ...` echoes chosen values back as
the username. The statement runs on `db.injectable`, which can only read this instance's tables.
Real and twin run this same code; only their data differs.
"""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime

from demo import db
from demo.web import Call, Shop

PASSWORD_ITERATIONS = 20_000
# One salt for the whole site, so the hash can be compared inside the SQL text (part of the flaw).
PASSWORD_SALT = b"freshjuice-shop"
TOKEN_BYTES = 24
SIGNED_IN_SQL = (
    "SELECT users.id, username, name, email, phone, address, role, avatar_url, users.created_at"
    " FROM sessions JOIN users ON users.id = sessions.user_id WHERE token = ?"
)


@dataclass(frozen=True)
class Login:
    user_id: int
    username: str
    token: str


def password_hash(password: str) -> str:
    raw = hashlib.pbkdf2_hmac("sha256", password.encode(), PASSWORD_SALT, PASSWORD_ITERATIONS)
    return raw.hex()


def now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def login(shop: Shop, username: str, password: str) -> Login | None:
    """A new session for these credentials, or None. Broken SQL raises sqlite3.Error, which
    the routes show as a database error, as the flawed shop would."""
    if not username or not password:
        return None
    digest = password_hash(password)
    sql = (
        "SELECT id, username FROM users"
        f" WHERE username = '{username}' AND password_hash = '{digest}'"
    )
    with db.injectable(shop.db) as conn:
        row = conn.execute(sql).fetchone()
    if row is None:
        return None
    try:
        user_id = int(row[0])
    except (TypeError, ValueError):
        return None
    with db.opened(shop.db) as conn:
        if conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is None:
            return None
        token = secrets.token_urlsafe(TOKEN_BYTES)
        conn.execute("INSERT INTO sessions VALUES (?, ?, ?)", (token, user_id, now_iso()))
    return Login(user_id, str(row[1]), token)


def current_user(call: Call) -> sqlite3.Row | None:
    token = call.token
    if not token:
        return None
    with db.opened(call.shop.db) as conn:
        row: sqlite3.Row | None = conn.execute(SIGNED_IN_SQL, (token,)).fetchone()
    return row


def logout(call: Call) -> None:
    if call.token:
        with db.opened(call.shop.db) as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (call.token,))


def public_user(row: sqlite3.Row) -> dict[str, object]:
    """What /api/users/{id} returns: every column but the password hash (PLANTED FLAW 2 sends
    it for any id to any signed-in user)."""
    return {
        "id": row["id"],
        "username": row["username"],
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"],
        "address": row["address"],
        "role": row["role"],
        "avatarUrl": row["avatar_url"],
        "createdAt": row["created_at"],
    }
