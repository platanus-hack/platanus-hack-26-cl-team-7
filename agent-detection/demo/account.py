"""HTML pages for signed-in work: log in and out, account, cart and checkout.

The account page carries PLANTED FLAW 3 (`?invoice=` file read, see demo.files) and PLANTED FLAW
4 (picture URL fetch, see demo.fetch). The login form carries PLANTED FLAW 1 (see demo.auth).
"""

from __future__ import annotations

import sqlite3
from html import escape

from demo import auth, fetch, files, store
from demo.api import LOGIN_FAILED, database_error
from demo.web import (
    CART_COOKIE,
    SESSION_COOKIE,
    TEXT,
    Call,
    Reply,
    cleared,
    page,
    redirect,
    session_cookie,
)

PREVIEW_BYTES = 300

LOGIN_FORM = """<form method="post" action="/login">
<label>Username <input name="username" autocomplete="username"></label>
<label>Password <input name="password" type="password" autocomplete="current-password"></label>
<button type="submit">Log in</button></form>"""
AVATAR_FORM = """<form method="post" action="/account">
<label>Profile picture URL <input name="avatar_url" type="url"></label>
<button type="submit">Use this picture</button></form>"""
SIGN_IN_FIRST = '<p>Please <a href="/login">log in</a> first.</p>'


def login(call: Call) -> Reply:
    if call.method != "POST":
        return page("Log in", LOGIN_FORM)
    try:
        result = auth.login(call.shop, call.form.get("username", ""), call.form.get("password", ""))
    except sqlite3.Error as exc:
        return page("Log in", f"<p>{escape(database_error(exc))}</p>" + LOGIN_FORM, 500)
    if result is None:
        return page("Log in", f"<p>{LOGIN_FAILED.capitalize()}.</p>" + LOGIN_FORM, 401)
    return redirect("/account", {"Set-Cookie": session_cookie(result.token)})


def logout(call: Call) -> Reply:
    auth.logout(call)
    return redirect("/", {"Set-Cookie": cleared(SESSION_COOKIE)})


def account(call: Call) -> Reply:
    if "invoice" in call.query:
        content = files.read(call.shop, call.query["invoice"])
        if content is None:
            return page("Invoice not found", "<p>No such invoice.</p>", 404)
        return Reply(200, TEXT, content)
    user = auth.current_user(call)
    if user is None:
        return redirect("/login") if call.method == "GET" else page("Account", SIGN_IN_FIRST, 401)
    if call.method == "POST":
        return update_avatar(call, user)
    return page("Account", profile(user) + order_table(call, int(user["id"])) + AVATAR_FORM)


def profile(user: sqlite3.Row) -> str:
    avatar = user["avatar_url"]
    picture = f'<img src="{escape(avatar)}" alt="" width="48" height="48">' if avatar else ""
    fields = ("name", "email", "phone", "address")
    rows = "".join(f"<dt>{name.title()}</dt><dd>{escape(user[name] or '')}</dd>" for name in fields)
    return f"{picture}<p>Signed in as {escape(user['username'] or '')}.</p><dl>{rows}</dl>"


def order_table(call: Call, user_id: int) -> str:
    rows = "".join(
        f"<tr><td>#{o['id']}</td><td>{escape(o['created_at'])}</td><td>{escape(o['status'])}</td>"
        f"<td>${o['total_cents'] / store.CENTS:.2f}</td>"
        f'<td><a href="/account?invoice={o["id"]}.txt">Invoice</a></td></tr>'
        for o in store.orders_of(call.shop, user_id)
    )
    return f"<h2>Orders</h2><table>{rows}</table>" if rows else "<p>No orders yet.</p>"


def update_avatar(call: Call, user: sqlite3.Row) -> Reply:
    url = call.form.get("avatar_url", "").strip()
    try:
        got = fetch.fetch(url, call.shop.egress_proxy)
    except fetch.FetchError as exc:
        return page("Account", f"<p>We could not get that picture: {escape(str(exc))}.</p>", 400)
    if got.status == 200 and got.content_type.startswith("image/"):
        store.set_avatar(call.shop, int(user["id"]), url)
        updated = auth.current_user(call) or user
        return page("Account", "<p>Your picture is updated.</p>" + profile(updated))
    preview = escape(got.body[:PREVIEW_BYTES].decode("utf-8", errors="replace"))
    kind = escape(got.content_type or "no content type")
    message = f"<p>That link is not a picture (HTTP {got.status}, {kind}):</p><pre>{preview}</pre>"
    return page("Account", message)


def cart(call: Call) -> Reply:
    current = store.cart_of(call)
    if call.method == "POST":
        current = store.add_to_cart(
            current, call.form.get("id", ""), call.form.get("quantity", "1")
        )
        return redirect("/cart", {"Set-Cookie": store.cart_cookie(current)})
    lines = store.cart_lines(call.shop, current)
    if not lines:
        return page("Cart", '<p>Your cart is empty.</p><p><a href="/products">Shop</a></p>')
    rows = "".join(
        f"<li>{count} x {escape(str(item['name']))} ${item['price'] * count:.2f}</li>"
        for item, count in lines
    )
    return page("Cart", f'<ul>{rows}</ul><p><a href="/checkout">Checkout</a></p>')


def checkout(call: Call) -> Reply:
    user = auth.current_user(call)
    if user is None:
        return redirect("/login") if call.method == "GET" else page("Checkout", SIGN_IN_FIRST, 401)
    current = store.cart_of(call)
    if call.method != "POST":
        form = '<form method="post" action="/checkout"><button type="submit">Place order</button>'
        return page("Checkout", f"<p>Ship to {escape(user['address'] or '')}.</p>{form}</form>")
    order_id = store.place_order(call.shop, user, current)
    if order_id is None:
        return page("Checkout", "<p>Your cart is empty.</p>", 400)
    body = f'<p>Thank you for your order #{order_id}.</p><p><a href="/account">Your orders</a></p>'
    return page("Order placed", body, headers={"Set-Cookie": cleared(CART_COOKIE)})
