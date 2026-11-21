"""HTML pages of the stand-in demo shop and the pattern-to-handler table."""

import zlib
from collections.abc import Callable
from html import escape
from typing import Any

from demo.api import API_HANDLERS, PRODUCTS, TEXT, Call, Reply, as_json, has_credentials, matching
from demo.assets import ASSETS, FAVICON, ROBOTS

HTML = "text/html; charset=utf-8"


LAYOUT = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{title} - Demo Shop</title>
<link rel="stylesheet" href="/static/css/site.css"><link rel="icon" href="/favicon.ico">
<script src="/static/js/app.js" defer></script></head><body>
<header><img src="/static/img/logo.svg" alt="Demo Shop" width="32" height="32">
<nav><a href="/">Home</a> <a href="/products">Products</a> <a href="/search">Search</a>
<a href="/cart">Cart</a> <a href="/account">Account</a> <a href="/login">Log in</a>
<a href="/logout">Log out</a></nav></header>
<main><h1>{title}</h1>{body}</main></body></html>
"""


def page(title: str, body: str, status: int = 200, headers: dict[str, str] | None = None) -> Reply:
    html = LAYOUT.format(title=escape(title), body=body)
    return Reply(status, HTML, html.encode(), headers or {})


def redirect(location: str, headers: dict[str, str] | None = None) -> Reply:
    return Reply(303, TEXT, b"See other\n", {"Location": location, **(headers or {})})


def product_links(products: list[dict[str, Any]]) -> str:
    items = "".join(
        f'<li><a href="/products/{p["id"]}">{escape(str(p["name"]))}</a> '
        f'<span class="price">${p["price"]:.2f}</span></li>'
        for p in products
    )
    return f"<ul>{items}</ul>"


def home(call: Call) -> Reply:
    hero = '<img src="/static/img/hero.png" alt="Fresh juice" width="64" height="32">'
    return page("Welcome", hero + product_links(list(PRODUCTS.values())))


def products(call: Call) -> Reply:
    return page("Products", product_links(list(PRODUCTS.values())))


LOGIN_FORM = """<form method="post" action="/login">
<label>Username <input name="username" autocomplete="username"></label>
<label>Password <input name="password" type="password" autocomplete="current-password"></label>
<button type="submit">Log in</button></form>"""


def login(call: Call) -> Reply:
    if call.method != "POST":
        return page("Log in", LOGIN_FORM)
    if not has_credentials(call.form):
        return page("Log in", "<p>Wrong username or password.</p>" + LOGIN_FORM, 401)
    cookie = f"session=demo-{zlib.crc32(call.form['username'].encode()):08x}; HttpOnly; Path=/"
    return redirect("/account", {"Set-Cookie": cookie})


def product(call: Call) -> Reply:
    item = PRODUCTS.get(call.params.get("id", ""))
    if item is None:
        return page("Product not found", "<p>No such product.</p>", 404)
    form = (
        f'<form method="post" action="/cart"><input type="hidden" name="id" '
        f'value="{item["id"]}"><button type="submit">Add to cart</button></form>'
    )
    return page(str(item["name"]), f'<p class="price">${item["price"]:.2f}</p>{form}')


def search(call: Call) -> Reply:
    query = call.query.get("q", "")
    form = (
        f'<form action="/search"><input name="q" value="{escape(query)}">'
        '<button type="submit">Search</button></form>'
    )
    return page("Search", form + product_links(matching(query) if query else []))


def cart(call: Call) -> Reply:
    if call.method == "POST":
        return redirect("/cart")
    return page("Cart", '<p>Your cart is empty.</p><p><a href="/checkout">Checkout</a></p>')


def checkout(call: Call) -> Reply:
    if call.method == "POST":
        return page("Order placed", "<p>Thank you for your order.</p>")
    return page(
        "Checkout",
        '<form method="post" action="/checkout"><button type="submit">Place order</button></form>',
    )


def static(call: Call) -> Reply:
    asset = ASSETS.get(call.path)
    return Reply(200, asset[0], asset[1]) if asset else Reply(404, TEXT, b"Not found\n")


def logout(call: Call) -> Reply:
    return redirect("/", {"Set-Cookie": "session=; Max-Age=0; Path=/"})


def account(call: Call) -> Reply:
    return page("Account", '<p>Signed in as a demo user.</p><p><a href="/cart">Cart</a></p>')


HANDLERS: dict[str, Callable[[Call], Reply]] = {
    "/": home,
    "/login": login,
    "/logout": logout,
    "/products": products,
    "/products/{id}": product,
    "/search": search,
    "/cart": cart,
    "/checkout": checkout,
    "/account": account,
    "/static/**": static,
    **API_HANDLERS,
    "/favicon.ico": lambda call: Reply(200, "image/x-icon", FAVICON),
    "/robots.txt": lambda call: Reply(200, TEXT, ROBOTS),
}


def respond(pattern: str, call: Call) -> Reply:
    handler = HANDLERS.get(pattern)
    if handler is not None:
        return handler(call)
    if call.path.startswith("/api/"):
        return as_json({"route": pattern})
    return page(pattern, "<p>This page is part of the demo shop.</p>")
