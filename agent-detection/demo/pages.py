"""HTML pages of the demo shop (catalogue side) and the pattern-to-handler table."""

from __future__ import annotations

from collections.abc import Callable
from html import escape
from typing import Any

from demo import account, store
from demo.api import API_HANDLERS
from demo.assets import ASSETS, FAVICON, ROBOTS
from demo.layout import page
from demo.web import TEXT, Call, Reply, as_json

FEATURED = 8


def product_links(items: list[dict[str, Any]]) -> str:
    rows = "".join(
        f'<li><a href="/products/{p["id"]}">{escape(str(p["name"]))}</a> '
        f'<span class="price">${p["price"]:.2f}</span></li>'
        for p in items
    )
    return f"<ul>{rows}</ul>"


def home(call: Call) -> Reply:
    hero = '<img src="/static/img/hero.png" alt="Fresh juice" width="64" height="32">'
    featured = store.products(call.shop)[:FEATURED]
    return page("Welcome", hero + "<h2>Featured</h2>" + product_links(featured))


def products(call: Call) -> Reply:
    return page("Products", product_links(store.products(call.shop)))


def product(call: Call) -> Reply:
    item = store.product(call.shop, call.params.get("id", ""))
    if item is None:
        return page("Product not found", "<p>No such product.</p>", 404)
    form = (
        f'<form method="post" action="/cart"><input type="hidden" name="id" value="{item["id"]}">'
        '<label>Quantity <input name="quantity" value="1" size="2"></label>'
        '<button type="submit">Add to cart</button></form>'
    )
    stock = "In stock" if item["stock"] > 0 else "Sold out"
    body = (
        f"<p>{escape(str(item['description']))}</p>"
        f'<p class="price">${item["price"]:.2f}</p><p>{stock}</p>{form}'
    )
    return page(str(item["name"]), body)


def search(call: Call) -> Reply:
    query = call.query.get("q", "")
    form = (
        f'<form action="/search"><input name="q" value="{escape(query)}">'
        '<button type="submit">Search</button></form>'
    )
    found = store.search(call.shop, query) if query else []
    return page("Search", form + product_links(found))


def static(call: Call) -> Reply:
    asset = ASSETS.get(call.path)
    return Reply(200, asset[0], asset[1]) if asset else Reply(404, TEXT, b"Not found\n")


HANDLERS: dict[str, Callable[[Call], Reply]] = {
    "/": home,
    "/login": account.login,
    "/logout": account.logout,
    "/products": products,
    "/products/{id}": product,
    "/search": search,
    "/cart": account.cart,
    "/checkout": account.checkout,
    "/account": account.account,
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
