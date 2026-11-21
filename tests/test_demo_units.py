"""In-process tests for the demo shop internals (the black-box suite is test_demo_site.py)."""

import http.client
import json
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest

import demo.__main__ as demo_main
from demo.api import Call
from demo.assets import ASSETS, FAVICON
from demo.pages import respond
from demo.site import (
    ROUTES_FILE,
    Match,
    ShopServer,
    compile_route,
    load_routes,
    make_server,
    parse_form,
    resolve,
    serve,
)
from engine.routes import RouteTable

Answer = tuple[int, dict[str, str], bytes]


@pytest.fixture(scope="module")
def port() -> Iterator[int]:
    server = make_server("127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server.server_address[1]
    server.shutdown()
    server.server_close()


def call(
    port: int,
    method: str,
    path: str,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> Answer:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        return resp.status, dict(resp.getheaders()), resp.read()
    finally:
        conn.close()


def post_json(port: int, path: str, data: object) -> Answer:
    body = json.dumps(data).encode()
    return call(port, "POST", path, body, {"Content-Type": "application/json"})


def test_route_patterns_follow_the_contract_syntax() -> None:
    static = compile_route({"pattern": "/static/**", "asset": True})
    assert static.params("/static") == {}
    assert static.params("/static/css/a/b.css") == {}
    assert static.params("/staticx") is None
    item = compile_route({"pattern": "/api/users/{id}"})
    assert item.params("/api/users/7/") == {"id": "7"}
    assert item.params("/api/users/") is None
    assert item.params("/API/users/7") is None
    login = compile_route({"pattern": "/login", "methods": ["get", "post"]})
    assert login.accepts("GET", "/login") and login.accepts("POST", "/login/")
    assert not login.accepts("HEAD", "/login") and not login.accepts("PUT", "/login")


AGREEMENT_PATHS = ("/", "/login", "/login/", "/products//", "/products/1/", "/static", "/zz")


@pytest.mark.parametrize("method", ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"])
def test_site_serves_exactly_what_the_engine_counts_as_on_the_route_list(method: str) -> None:
    table = RouteTable.from_yaml(ROUTES_FILE)
    routes = load_routes(ROUTES_FILE)
    for path in AGREEMENT_PATHS + ("/cart", "/checkout", "/api/session", "/api/cart"):
        served = isinstance(resolve(routes, method, path), Match)
        assert served == (table.match(method, path) is not None), f"{method} {path}"


def test_empty_method_list_accepts_no_method_like_the_engine() -> None:
    entry = {"pattern": "/x", "methods": []}
    route = compile_route(entry)
    assert RouteTable.from_patterns([entry]).match("GET", "/x") is None
    assert resolve((route,), "GET", "/x") == route


def test_head_on_a_get_post_route_is_405_like_the_engine_exit(port: int) -> None:
    status, headers, _ = call(port, "HEAD", "/login")
    assert status == 405 and headers["Allow"] == "GET, POST"


def test_resolve_tells_wrong_method_from_unknown_path() -> None:
    routes = (
        compile_route({"pattern": "/login", "methods": ["POST"]}),
        compile_route({"pattern": "/login"}),
    )
    assert resolve(routes[:1], "GET", "/login") == routes[0]
    assert resolve(routes, "GET", "/login") is not None
    assert resolve(routes, "GET", "/nope") is None


def test_parse_form_reads_urlencoded_and_json_objects_only() -> None:
    assert parse_form("application/x-www-form-urlencoded", b"a=1&b=x%20y") == {"a": "1", "b": "x y"}
    assert parse_form("application/json", b'{"a": 1}') == {"a": "1"}
    assert parse_form("application/json", b"[1, 2]") == {}
    assert parse_form("application/json", b"{broken") == {}


def test_head_sends_headers_without_body(port: int) -> None:
    status, headers, body = call(port, "HEAD", "/products")
    assert status == 200 and body == b""
    assert int(headers["Content-Length"]) > 0


def test_method_outside_the_route_list_is_405_with_allow(port: int) -> None:
    status, headers, _ = call(port, "PUT", "/login")
    assert status == 405
    assert headers["Allow"] == "GET, POST"


def test_unknown_ids_are_404_on_listed_routes(port: int) -> None:
    assert call(port, "GET", "/products/999")[0] == 404
    assert call(port, "GET", "/api/products/999")[0] == 404
    assert call(port, "GET", "/api/users/999")[0] == 404


def test_json_endpoints_answer_with_data(port: int) -> None:
    status, headers, body = call(port, "GET", "/api/users/1")
    assert status == 200 and headers["Content-Type"] == "application/json"
    assert json.loads(body)["username"] == "alice"
    found = json.loads(call(port, "GET", "/api/search?q=apple")[2])
    assert [p["name"] for p in found] == ["Apple Juice"]
    assert len(json.loads(call(port, "GET", "/api/products")[2])) == 3
    assert call(port, "POST", "/api/cart", b"", {})[0] == 201
    assert call(port, "DELETE", "/api/cart")[0] == 200


def test_api_session_login_by_json(port: int) -> None:
    assert json.loads(call(port, "GET", "/api/session")[2]) == {"user": None}
    status, _, body = post_json(port, "/api/session", {"username": "bob", "password": "pw"})
    assert status == 200 and json.loads(body) == {"user": "bob"}
    assert post_json(port, "/api/session", {"username": "bob"})[0] == 401


def test_login_sets_a_session_cookie_and_rejects_missing_password(port: int) -> None:
    form = {"Content-Type": "application/x-www-form-urlencoded"}
    status, headers, _ = call(port, "POST", "/login", b"username=alice&password=pw", form)
    assert status == 303 and headers["Location"] == "/account"
    assert headers["Set-Cookie"].startswith("session=demo-")
    assert call(port, "POST", "/login", b"username=alice", form)[0] == 401


def test_shop_flow_pages(port: int) -> None:
    assert b"Apple Juice" in call(port, "GET", "/search?q=apple")[2]
    assert b"Apple Juice" not in call(port, "GET", "/search?q=zzz")[2]
    assert b"Add to cart" in call(port, "GET", "/products/2")[2]
    assert call(port, "POST", "/cart", b"id=2")[1]["Location"] == "/cart"
    assert b"Order placed" in call(port, "POST", "/checkout", b"")[2]
    assert call(port, "GET", "/logout")[1]["Location"] == "/"
    assert call(port, "GET", "/robots.txt")[2].startswith(b"User-agent")
    assert call(port, "GET", "/favicon.ico")[2] == FAVICON


def test_bodies_with_bad_or_huge_length_still_get_an_answer(port: int) -> None:
    assert call(port, "POST", "/cart", None, {"Content-Length": "abc"})[0] == 303
    huge = b"x" * (64 * 1024 + 10)
    assert call(port, "POST", "/cart", huge)[0] == 303


def test_assets_are_well_formed() -> None:
    assert ASSETS["/static/img/hero.png"][1].startswith(b"\x89PNG\r\n\x1a\n")
    assert FAVICON[:4] == b"\x00\x00\x01\x00"


def test_routes_without_a_handler_get_a_generic_reply() -> None:
    page = respond("/about", Call("GET", "/about", {}, {}, {}))
    assert page.status == 200 and page.content_type.startswith("text/html")
    api = respond("/api/status", Call("GET", "/api/status", {}, {}, {}))
    assert json.loads(api.body) == {"route": "/api/status"}


def test_serve_prints_address_and_stops_on_ctrl_c(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def interrupt(self: ShopServer, poll_interval: float = 0.5) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr(ShopServer, "serve_forever", interrupt)
    serve("127.0.0.1", 0)
    assert "demo shop on http://127.0.0.1:0" in capsys.readouterr().out


def test_main_passes_arguments_to_serve(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[str, int, Path]] = []
    monkeypatch.setattr(demo_main, "serve", lambda h, p, r: seen.append((h, p, r)))
    demo_main.main(["--port", "9999", "--routes", "x.yaml"])
    assert seen == [("127.0.0.1", 9999, Path("x.yaml"))]
