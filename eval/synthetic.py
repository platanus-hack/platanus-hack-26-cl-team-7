"""Generated (never recorded) human sessions as Caddy log lines; labels say synthetic=true."""

from __future__ import annotations

import json
import random
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from engine.models import Request
from engine.routes import RouteTable

BROWSER_UAS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/18.1 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
)
ASSET_FILES = ("css/site.css", "js/app.js", "img/logo.png", "img/hero.jpg", "fonts/inter.woff2")
SEARCH_WORDS = ("shoes", "red+dress", "laptop", "coffee", "gift+card", "backpack", "lamp")
TYPO_PATHS = ("/abuot", "/hlep", "/contcat", "/shpo", "/acount")
EXIT_CHANCE = 0.008
MAX_EXITS = 2
MAX_VIEWS = 25
HEADERS = {"Accept": ["text/html,*/*;q=0.8"], "Accept-Language": ["en-US,en;q=0.9"]}


class SeededRandom(random.Random):
    """Reproducible generator for synthetic traffic and sampling; never used for secrets."""


@dataclass(frozen=True)
class _Site:
    pages: list[dict[str, object]]
    assets: list[dict[str, object]]
    table: RouteTable


@dataclass(frozen=True)
class _Visitor:
    ip: str
    user_agent: str

    def request(self, ts: float, method: str, path: str, query: str, status: int) -> Request:
        return Request(ts, self.ip, self.user_agent, method, path, query, status)


def synthetic_humans(
    patterns: list[dict[str, object]],
    count: int,
    seed: int,
    start_ts: float = 1_700_000_000.0,
) -> list[list[Request]]:
    rng = SeededRandom(seed)
    site = _site(patterns)
    sessions: list[list[Request]] = []
    ts = start_ts
    for index in range(count):
        visitor = _Visitor(_ip(index), rng.choice(BROWSER_UAS))
        sessions.append(_session(rng, site, visitor, ts))
        ts += rng.expovariate(1 / 6.0)
    return sessions


def _site(patterns: list[dict[str, object]]) -> _Site:
    pages = [p for p in patterns if not p.get("asset")]
    if not pages:
        raise ValueError("the route list has no page route to visit")
    return _Site(pages, [p for p in patterns if p.get("asset")], RouteTable.from_patterns(patterns))


def _ip(index: int) -> str:
    return f"10.{(index >> 16) & 255}.{(index >> 8) & 255}.{index & 255}"


def _session(rng: random.Random, site: _Site, visitor: _Visitor, ts: float) -> list[Request]:
    requests: list[Request] = []
    exits = 0
    for view in range(1 + min(int(rng.expovariate(1 / 3.0)), MAX_VIEWS - 1)):
        page = _page(rng, site, visitor, ts)
        assets = _assets(rng, site, visitor, ts, cold=view == 0)
        requests.extend([page, *assets])
        busy = assets[-1].ts - ts if assets else 0.0
        if exits < MAX_EXITS and rng.random() < EXIT_CHANCE:
            typo = _typo(rng, site, page.path)
            if typo is not None:
                busy += rng.uniform(1.0, 4.0)
                requests.append(visitor.request(ts + busy, "GET", typo, "", 404))
                exits += 1
        ts += busy + _think_time(rng)
    return requests


def _page(rng: random.Random, site: _Site, visitor: _Visitor, ts: float) -> Request:
    route = rng.choice(site.pages)
    path = _fill(rng, str(route["pattern"]), asset=False)
    query = f"q={rng.choice(SEARCH_WORDS)}" if "search" in path else ""
    return visitor.request(ts, _method(route), path, query, 200)


def _assets(
    rng: random.Random, site: _Site, visitor: _Visitor, ts: float, *, cold: bool
) -> list[Request]:
    count = (rng.randint(1, 4) if cold else rng.randint(0, 2)) if site.assets else 0
    assets: list[Request] = []
    offset = 0.0
    for _ in range(count):
        offset += rng.uniform(0.02, 0.8)
        path = _fill(rng, str(rng.choice(site.assets)["pattern"]), asset=True)
        status = 200 if cold else rng.choice((200, 304))
        assets.append(visitor.request(ts + offset, "GET", path, "", status))
    return assets


def _think_time(rng: random.Random) -> float:
    return min(max(rng.lognormvariate(2.5, 1.0), 2.0), 900.0)


def _method(route: dict[str, object]) -> str:
    methods = route.get("methods")
    if isinstance(methods, list) and methods and "GET" not in methods:
        return str(methods[0])
    return "GET"


def _fill(rng: random.Random, pattern: str, *, asset: bool) -> str:
    parts: list[str] = []
    for segment in pattern.split("/"):
        if segment == "**":
            if asset:
                parts.append(rng.choice(ASSET_FILES))
        elif segment.startswith("{") and segment.endswith("}"):
            parts.append(str(rng.randint(1, 500)))
        else:
            parts.append(segment)
    return "/".join(parts) or "/"


def _typo(rng: random.Random, site: _Site, path: str) -> str | None:
    candidates = [path.rstrip("/") + "x", path[:-1], rng.choice(TYPO_PATHS)]
    for candidate in candidates:
        if candidate.startswith("/") and site.table.match("GET", candidate) is None:
            return candidate
    return None


def caddy_line(req: Request, host: str = "shop.localhost") -> str:
    uri = f"{req.path}?{req.query}" if req.query else req.path
    request: dict[str, Any] = {
        "remote_ip": req.ip,
        "remote_port": "51034",
        "client_ip": req.ip,
        "proto": "HTTP/2.0",
        "method": req.method,
        "host": host,
        "uri": uri,
        "headers": {"User-Agent": [req.user_agent], **HEADERS},
    }
    entry = {
        "level": "info",
        "ts": req.ts,
        "logger": "http.log.access.log0",
        "msg": "handled request",
        "request": request,
        "bytes_read": 0,
        "user_id": "",
        "duration": 0.0011,
        "size": 0 if req.status == 304 else 2048,
        "status": req.status,
        "resp_headers": {"Server": ["Caddy"]},
    }
    return json.dumps(entry)


def write_pair(
    directory: Path, name: str, sessions: Sequence[Sequence[Request]], notes: str
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    requests = sorted((req for session in sessions for req in session), key=lambda r: r.ts)
    log_path = directory / f"{name}.jsonl"
    log_path.write_text("".join(caddy_line(req) + "\n" for req in requests), encoding="utf-8")
    labels = {
        "source": name,
        "synthetic": True,
        "notes": notes,
        "sessions": {session[0].session_id: "human" for session in sessions if session},
    }
    (directory / f"{name}.labels.json").write_text(json.dumps(labels, indent=2) + "\n")
    return log_path
