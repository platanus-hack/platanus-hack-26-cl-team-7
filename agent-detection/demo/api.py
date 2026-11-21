"""JSON endpoints of the demo shop.

PLANTED FLAW 2 (user record read): /api/users/{id} needs a signed-in user but never checks that
the id is theirs, so any session reads any user's private fields. /api/session POST is the JSON
login and carries PLANTED FLAW 1 (see demo.auth).
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable

from demo import auth, store
from demo.web import CART_COOKIE, Call, Reply, as_json, cleared, session_cookie

LOGIN_FAILED = "wrong username or password"
LOGIN_REQUIRED = "login required"


def database_error(exc: sqlite3.Error) -> str:
    return f"database error: {exc}"


def api_products(call: Call) -> Reply:
    return as_json(store.products(call.shop))


def api_product(call: Call) -> Reply:
    item = store.product(call.shop, call.params.get("id", ""))
    return as_json(item) if item else as_json({"error": "not found"}, 404)


def api_search(call: Call) -> Reply:
    return as_json(store.search(call.shop, call.query.get("q", "")))


def cart_items(call: Call, cart: dict[int, int]) -> list[dict[str, object]]:
    return [{**item, "quantity": count} for item, count in store.cart_lines(call.shop, cart)]


def api_cart(call: Call) -> Reply:
    cart = store.parse_cart(call.cookies.get(CART_COOKIE, ""))
    if call.method == "DELETE":
        return as_json({"items": []}, headers={"Set-Cookie": cleared(CART_COOKIE)})
    if call.method != "POST":
        return as_json({"items": cart_items(call, cart)})
    cart = store.add_to_cart(cart, call.form.get("id", ""), call.form.get("quantity", "1"))
    cookie = f"{CART_COOKIE}={store.format_cart(cart)}; Path=/; SameSite=Lax"
    return as_json({"items": cart_items(call, cart)}, 201, {"Set-Cookie": cookie})


def api_user(call: Call) -> Reply:
    if auth.current_user(call) is None:
        return as_json({"error": LOGIN_REQUIRED}, 401)
    row = store.user(call.shop, call.params.get("id", ""))
    return as_json(auth.public_user(row)) if row else as_json({"error": "not found"}, 404)


def api_session(call: Call) -> Reply:
    if call.method != "POST":
        account = auth.current_user(call)
        return as_json({"user": account["username"] if account else None})
    try:
        login = auth.login(call.shop, call.form.get("username", ""), call.form.get("password", ""))
    except sqlite3.Error as exc:
        return as_json({"error": database_error(exc)}, 500)
    if login is None:
        return as_json({"error": LOGIN_FAILED}, 401)
    body = {"user": login.username, "token": login.token}
    return as_json(body, headers={"Set-Cookie": session_cookie(login.token)})


API_HANDLERS: dict[str, Callable[[Call], Reply]] = {
    "/api/products": api_products,
    "/api/products/{id}": api_product,
    "/api/search": api_search,
    "/api/cart": api_cart,
    "/api/users/{id}": api_user,
    "/api/session": api_session,
}
