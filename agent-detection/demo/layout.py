"""The page frame every HTML reply shares."""

from __future__ import annotations

from html import escape

from demo.web import HTML, TEXT, Reply

LAYOUT = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{title} - FreshJuice</title>
<link rel="stylesheet" href="/static/css/site.css"><link rel="icon" href="/favicon.ico">
<script src="/static/js/app.js" defer></script></head><body>
<header><img src="/static/img/logo.svg" alt="FreshJuice" width="32" height="32">
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
