"""Catalogue data and JSON endpoints of the stand-in demo shop."""

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

JSON = "application/json"
TEXT = "text/plain; charset=utf-8"


@dataclass(frozen=True)
class Reply:
    status: int
    content_type: str
    body: bytes
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Call:
    method: str
    path: str
    params: dict[str, str]
    query: dict[str, str]
    form: dict[str, str]


PRODUCTS = {
    "1": {"id": 1, "name": "Apple Juice", "price": 1.99},
    "2": {"id": 2, "name": "Orange Juice", "price": 2.49},
    "3": {"id": 3, "name": "Green Smoothie", "price": 3.99},
}
USERS = {"1": {"id": 1, "username": "alice"}, "2": {"id": 2, "username": "bob"}}


def as_json(data: Any, status: int = 200) -> Reply:
    return Reply(status, JSON, json.dumps(data).encode())


def matching(query: str) -> list[dict[str, Any]]:
    needle = query.lower()
    return [p for p in PRODUCTS.values() if needle in str(p["name"]).lower()]


def has_credentials(form: dict[str, str]) -> bool:
    return bool(form.get("username") and form.get("password"))


def lookup(table: dict[str, dict[str, Any]]) -> Callable[[Call], Reply]:
    def handler(call: Call) -> Reply:
        item = table.get(call.params.get("id", ""))
        return as_json(item) if item else as_json({"error": "not found"}, 404)

    return handler


def api_cart(call: Call) -> Reply:
    return as_json({"items": []}, 201 if call.method == "POST" else 200)


def api_session(call: Call) -> Reply:
    if call.method != "POST":
        return as_json({"user": None})
    if not has_credentials(call.form):
        return as_json({"error": "wrong username or password"}, 401)
    return as_json({"user": call.form["username"]})


API_HANDLERS: dict[str, Callable[[Call], Reply]] = {
    "/api/products": lambda call: as_json(list(PRODUCTS.values())),
    "/api/products/{id}": lookup(PRODUCTS),
    "/api/search": lambda call: as_json(matching(call.query.get("q", ""))),
    "/api/cart": api_cart,
    "/api/users/{id}": lookup(USERS),
    "/api/session": api_session,
}
