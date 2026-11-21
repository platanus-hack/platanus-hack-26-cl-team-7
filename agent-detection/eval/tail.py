"""Synthetic heavy-tail humans: real browser habits that leave the route list or browse fast.

eval.synthetic models a typical visit, which stays far from the rule thresholds. These
generated sessions model the rarer visits that can trip R1 or R2 on a real site:

- devtools: Chrome with DevTools open asks for /.well-known/appspecific/com.chrome.devtools.json
  on every page load (an exit when the site does not list it).
- touch-icon: iOS Safari asks for /apple-touch-icon-precomposed.png and /apple-touch-icon.png.
- tabs: the visitor opens the pages in new tabs, well under two seconds apart.

Each tail session is an ordinary synthetic session reshaped by one habit (habits rotate by
index). Generated, never recorded: anything written from it is labeled synthetic.
"""

from __future__ import annotations

import dataclasses
import random

from engine.models import Request
from engine.routes import RouteTable
from eval.synthetic import BROWSER_UAS, synthetic_humans

HABITS = ("devtools", "touch-icon", "tabs")
DEVTOOLS_PATH = "/.well-known/appspecific/com.chrome.devtools.json"
TOUCH_ICONS = ("/apple-touch-icon-precomposed.png", "/apple-touch-icon.png")
CHROME_UA = BROWSER_UAS[0]
IPHONE_UA = BROWSER_UAS[3]
TAB_GAP = (0.3, 1.5)


def tail_humans(
    patterns: list[dict[str, object]],
    count: int,
    seed: int,
    start_ts: float = 1_700_000_000.0,
    ip_block: int | None = None,
) -> list[list[Request]]:
    """`count` heavy-tail sessions; IPs default to block (seed + 128) % 256 so they never share
    an "ip|ua" session with synthetic_humans(seed=seed)."""
    block = (seed + 128) % 256 if ip_block is None else ip_block
    ordinary = synthetic_humans(patterns, count, seed, start_ts, ip_block=block)
    table = RouteTable.from_patterns(patterns)
    rng = random.Random(seed)
    return [
        _reshape(rng, table, HABITS[index % len(HABITS)], session)
        for index, session in enumerate(ordinary)
    ]


def _reshape(
    rng: random.Random, table: RouteTable, habit: str, session: list[Request]
) -> list[Request]:
    if habit == "tabs":
        return _tabs(rng, table, session)
    agent = CHROME_UA if habit == "devtools" else IPHONE_UA
    reshaped = [dataclasses.replace(req, user_agent=agent) for req in session]
    pages = [req for req in reshaped if _is_page(table, req)]
    extra: list[Request] = []
    for number, page in enumerate(pages):
        if habit == "devtools":
            extra.append(_fetch(table, page, DEVTOOLS_PATH, rng.uniform(0.05, 0.4)))
        elif number == 0 or rng.random() < 0.25:
            extra.extend(_fetch(table, page, icon, rng.uniform(0.1, 0.9)) for icon in TOUCH_ICONS)
    return sorted([*reshaped, *extra], key=lambda req: req.ts)


def _tabs(rng: random.Random, table: RouteTable, session: list[Request]) -> list[Request]:
    reshaped: list[Request] = []
    shift = 0.0
    previous: Request | None = None
    for req in session:
        if previous is not None and _is_page(table, req):
            shift += (req.ts - previous.ts) - rng.uniform(*TAB_GAP)
        if _is_page(table, req):
            previous = req
        reshaped.append(dataclasses.replace(req, ts=req.ts - shift))
    return sorted(reshaped, key=lambda req: req.ts)


def _is_page(table: RouteTable, req: Request) -> bool:
    match = table.match(req.method, req.path)
    return match is not None and not match.asset


def _fetch(table: RouteTable, page: Request, path: str, delay: float) -> Request:
    status = 200 if table.match("GET", path) is not None else 404
    return dataclasses.replace(
        page, ts=page.ts + delay, method="GET", path=path, query="", status=status
    )
