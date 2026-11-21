"""Stand-in demo shop: serves exactly the routes in config/routes.yaml and 404 for anything else."""

from __future__ import annotations

import contextlib
import json
import re
import sys
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit

import yaml

from demo.api import TEXT, Call, Reply
from demo.pages import respond
from engine.routes import RouteTable

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


def parse_form(content_type: str, body: bytes) -> dict[str, str]:
    text = body.decode("utf-8", errors="replace")
    if content_type.startswith("application/json"):
        with contextlib.suppress(ValueError):
            data = json.loads(text)
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
        return {}
    return dict(parse_qsl(text))


class ShopServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], routes: tuple[Route, ...]) -> None:
        super().__init__(address, ShopHandler)
        self.routes = routes


class ShopHandler(BaseHTTPRequestHandler):
    server_version = "DemoShop/0.1"
    sys_version = ""

    def do_GET(self) -> None:
        self.dispatch()

    do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_GET

    def routes(self) -> tuple[Route, ...]:
        return self.server.routes if isinstance(self.server, ShopServer) else ()

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
        found = resolve(self.routes(), self.command, url.path)
        if isinstance(found, Match):
            call = Call(self.command, url.path, found.params, dict(parse_qsl(url.query)), form)
            self.send(respond(found.route.pattern, call))
        elif isinstance(found, Route):
            allow = ", ".join(sorted(found.methods))
            self.send(Reply(405, TEXT, b"Method not allowed\n", {"Allow": allow}))
        else:
            self.send(Reply(404, TEXT, b"Not found\n"))

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


def make_server(host: str, port: int, routes_file: Path = ROUTES_FILE) -> ShopServer:
    return ShopServer((host, port), load_routes(routes_file))


def serve(host: str, port: int, routes_file: Path = ROUTES_FILE) -> None:
    with make_server(host, port, routes_file) as server:
        print(f"demo shop on http://{host}:{port} ({len(server.routes)} routes)", flush=True)
        with contextlib.suppress(KeyboardInterrupt):
            server.serve_forever()
