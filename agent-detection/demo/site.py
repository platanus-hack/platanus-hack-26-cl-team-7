"""Stand-in demo shop: serves exactly the routes in config/routes.yaml and 404 for anything else.

The same handler serves on TCP (--port, old tests and the plain local stack) and on a Unix
socket (--socket, the real and twin instances behind Caddy). Replies depend only on the request
and the instance's data, never on which listener or instance served them."""

from __future__ import annotations

import contextlib
import re
import sys
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import yaml

from demo import files
from demo.pages import respond
from demo.web import TEXT, Call, Reply, Shop, parse_cookies, parse_form, parse_query
from engine.routes import RouteTable
from mirror.sockets import UnixHTTPServer

ROUTES_FILE = Path(__file__).resolve().parents[1] / "config" / "routes.yaml"
MAX_BODY = 64 * 1024
PARAM = re.compile(r"\{[^/{}]+\}")


@dataclass(frozen=True)
class Route:
    """One route list entry. Matching is engine.routes.RouteTable's, so the site serves exactly
    the (method, path) pairs the engine counts as on the list and nothing it calls an exit."""

    pattern: str
    methods: frozenset[str]
    table: RouteTable
    any_method: RouteTable

    def params(self, path: str) -> dict[str, str] | None:
        if self.any_method.match("GET", path) is None:
            return None
        pairs = zip(self.pattern.split("/"), path.split("/"), strict=False)
        return {seg[1:-1]: part for seg, part in pairs if PARAM.fullmatch(seg)}

    def accepts(self, method: str, path: str) -> bool:
        return self.table.match(method, path) is not None


@dataclass(frozen=True)
class Match:
    route: Route
    params: dict[str, str]


def compile_route(entry: dict[str, Any]) -> Route:
    methods = frozenset(str(m).upper() for m in entry.get("methods") or [])
    unfiltered = {key: value for key, value in entry.items() if key != "methods"}
    table, any_method = RouteTable.from_patterns([entry]), RouteTable.from_patterns([unfiltered])
    return Route(str(entry["pattern"]), methods, table, any_method)


def load_routes(path: Path) -> tuple[Route, ...]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return tuple(compile_route(entry) for entry in data["routes"])


def resolve(routes: tuple[Route, ...], method: str, path: str) -> Match | Route | None:
    """A Match when a route takes this method; the Route alone when it only takes others."""
    refused: Route | None = None
    for route in routes:
        params = route.params(path)
        if params is None:
            continue
        if route.accepts(method, path):
            return Match(route, params)
        refused = refused or route
    return refused


class ShopServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], routes: tuple[Route, ...], shop: Shop) -> None:
        super().__init__(address, ShopHandler)
        self.routes, self.shop = routes, shop


class UnixShopServer(UnixHTTPServer):
    def __init__(self, path: Path, routes: tuple[Route, ...], shop: Shop) -> None:
        super().__init__(path, ShopHandler)
        self.routes, self.shop = routes, shop


INTERNAL_ERROR = Reply(500, TEXT, b"Internal server error\n")


class ShopHandler(BaseHTTPRequestHandler):
    server: ShopServer | UnixShopServer
    server_version = "DemoShop/0.1"

    def version_string(self) -> str:
        return self.server_version

    def do_GET(self) -> None:
        self.dispatch()

    do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_GET

    def read_body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > MAX_BODY:
            self.close_connection = True
        return self.rfile.read(min(max(length, 0), MAX_BODY))

    def dispatch(self) -> None:
        url = urlsplit(self.path)
        form = parse_form(self.headers.get("Content-Type") or "", self.read_body())
        found = resolve(self.server.routes, self.command, url.path)
        if isinstance(found, Match):
            call = Call(
                self.command,
                url.path,
                found.params,
                parse_query(url.query),
                form,
                self.server.shop,
                parse_cookies(self.headers.get("Cookie") or ""),
                self.headers.get("Authorization") or "",
            )
            self.send(self.answer(found.route.pattern, call))
        elif isinstance(found, Route):
            allow = ", ".join(sorted(found.methods))
            self.send(Reply(405, TEXT, b"Method not allowed\n", {"Allow": allow}))
        else:
            self.send(Reply(404, TEXT, b"Not found\n"))

    def answer(self, pattern: str, call: Call) -> Reply:
        try:
            return respond(pattern, call)
        except Exception as exc:  # one broken request must not drop the connection unanswered
            sys.stderr.write(f"error on {call.method} {call.path}: {exc!r}\n")
            return INTERNAL_ERROR

    def send(self, reply: Reply) -> None:
        self.send_response(reply.status)
        self.send_header("Content-Type", reply.content_type)
        self.send_header("Content-Length", str(len(reply.body)))
        for name, value in reply.headers.items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(reply.body)

    def log_message(self, format: str, *args: Any) -> None:
        sys.stdout.write(f"{self.address_string()} {format % args}\n")


def ready(shop: Shop) -> Shop:
    if not shop.db.is_file():
        raise FileNotFoundError(f"{shop.db}: no shop database (run python -m demo.seed first)")
    files.prepare(shop.files)
    return shop


def make_server(shop: Shop, host: str, port: int, routes_file: Path = ROUTES_FILE) -> ShopServer:
    return ShopServer((host, port), load_routes(routes_file), ready(shop))


def make_unix_server(shop: Shop, path: Path, routes_file: Path = ROUTES_FILE) -> UnixShopServer:
    return UnixShopServer(path, load_routes(routes_file), ready(shop))


def serve(server: ShopServer | UnixShopServer, where: str) -> None:
    with server:
        print(f"demo shop on {where} ({len(server.routes)} routes)", flush=True)
        with contextlib.suppress(KeyboardInterrupt):
            server.serve_forever()
