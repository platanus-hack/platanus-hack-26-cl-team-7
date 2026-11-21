"""In-process tests for the demo shop internals (the black-box suite is test_demo_site.py)."""

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from test_twin_support import FORM, Client, make_shop, running

import demo.__main__ as demo_main
from demo.assets import ASSETS, FAVICON
from demo.pages import respond
from demo.site import (
    ROUTES_FILE,
    Match,
    ShopServer,
    compile_route,
    load_routes,
    make_server,
    resolve,
    serve,
)
from demo.store import MAX_CART_LINES, MAX_QUANTITY, add_to_cart, parse_cart
from demo.web import Call, Shop, parse_cookies, parse_form, parse_query
from engine.routes import RouteTable


@pytest.fixture(scope="module")
def shop(tmp_path_factory: pytest.TempPathFactory) -> Shop:
    return make_shop(tmp_path_factory.mktemp("units"))


@pytest.fixture(scope="module")
def port(shop: Shop) -> Iterator[int]:
    with running(make_server(shop, "127.0.0.1", 0)) as server:
        yield int(server.server_address[1])


@pytest.fixture
def client(port: int) -> Client:
    return Client(port)


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


def test_parse_form_reads_urlencoded_and_json_objects_only() -> None:
    assert parse_form("application/x-www-form-urlencoded", b"a=1&b=x%20y") == {"a": "1", "b": "x y"}
    assert parse_form("application/json", b'{"a": 1}') == {"a": "1"}
    assert parse_form("application/json", b"[1, 2]") == {}
    assert parse_form("application/json", b"{broken") == {}
    assert parse_query("invoice=&q=a&q=b") == {"invoice": "", "q": "b"}


def test_cookie_header_parsing_and_bearer_tokens(shop: Shop) -> None:
    assert parse_cookies("session=abc; cart=1:2") == {"session": "abc", "cart": "1:2"}
    messy = "a@b=1; junk; =x; session=tok; session=old"
    assert parse_cookies(messy) == {"a@b": "1", "session": "tok"}
    assert parse_cookies("") == {}
    bearer = Call("GET", "/", {}, {}, {}, shop, {"session": "c"}, "Bearer  tok ")
    assert bearer.token == "tok"
    assert Call("GET", "/", {}, {}, {}, shop, {"session": "c"}, "Basic x").token == "c"


def test_head_and_wrong_methods(client: Client) -> None:
    head = client.request("HEAD", "/")
    assert head.status == 200 and head.body == b"" and int(head.headers["Content-Length"]) > 0
    for method in ("HEAD", "PUT"):
        answer = client.request(method, "/login")
        assert answer.status == 405 and answer.headers["Allow"] == "GET, POST"
    assert client.get("/zz-unknown").status == 404


def test_catalogue_pages_and_json(client: Client) -> None:
    products = client.get("/api/products").json()
    assert len(products) >= 20 and products[0]["name"] == "Apple Juice"
    assert client.get("/api/products/2").json()["name"] == "Orange Juice"
    for path in ("/products/999", "/api/products/999", "/api/products/x", "/products/x"):
        assert client.get(path).status == 404
    found = [p["name"] for p in client.get("/api/search?q=apple").json()]
    assert "Apple Juice" in found and "Orange Juice" not in found
    assert client.get("/api/search?q=100%25").json() == []
    assert b"Apple Juice" in client.get("/search?q=apple").body
    assert b"Apple Juice" not in client.get("/search?q=zzz").body
    assert b"Add to cart" in client.get("/products/2").body
    assert b"Featured" in client.get("/").body
    assert client.get("/robots.txt").body.startswith(b"User-agent")
    assert client.get("/favicon.ico").body == FAVICON


def test_login_by_form_and_json_issues_a_cookie_and_a_token(client: Client) -> None:
    answer = client.form("/login", "username=alice&password=wonderland")
    assert answer.status == 303 and answer.headers["Location"] == "/account"
    assert answer.headers["Set-Cookie"].startswith("session=")
    assert "HttpOnly" in answer.headers["Set-Cookie"]
    assert client.get("/api/session").json() == {"user": "alice"}
    page = client.get("/account")
    assert page.status == 200 and b"Alice Liddell" in page.body and b"invoice=" in page.body
    token = Client(client.where).post_json(
        "/api/session", {"username": "alice", "password": "wonderland"}
    )
    assert token.status == 200 and token.json()["user"] == "alice"
    bearer = {"Authorization": f"Bearer {token.json()['token']}"}
    assert Client(client.where).get("/api/session", bearer).json() == {"user": "alice"}


def test_wrong_or_missing_credentials_are_401(client: Client) -> None:
    assert client.form("/login", "username=alice&password=nope").status == 401
    assert client.form("/login", "username=alice").status == 401
    assert client.post_json("/api/session", {"username": "alice"}).status == 401
    assert client.post_json("/api/session", {"username": "nobody", "password": "x"}).status == 401
    assert client.get("/api/session").json() == {"user": None}


def test_logout_ends_the_session(client: Client) -> None:
    client.form("/login", "username=alice&password=wonderland")
    session = client.cookies["session"]
    answer = client.get("/logout")
    assert answer.status == 303 and answer.headers["Location"] == "/"
    assert "Max-Age=0" in answer.headers["Set-Cookie"]
    stale = Client(client.where)
    stale.cookies["session"] = session
    assert stale.get("/api/session").json() == {"user": None}
    assert client.get("/logout").status == 303


def test_signed_out_account_and_checkout(client: Client) -> None:
    assert client.get("/account").headers["Location"] == "/login"
    assert client.get("/checkout").headers["Location"] == "/login"
    assert client.form("/account", "avatar_url=http://example.com/a.png").status == 401
    assert client.form("/checkout", "").status == 401


def test_cart_and_checkout_create_an_order_with_history(client: Client) -> None:
    assert b"Your cart is empty" in client.get("/cart").body
    assert client.form("/cart", "id=2&quantity=2").headers["Location"] == "/cart"
    client.form("/cart", "id=3")
    client.form("/cart", "id=x")
    assert client.cookies["cart"] == "2:2,3:1"
    assert b"2 x Orange Juice" in client.get("/cart").body
    client.form("/login", "username=alice&password=wonderland")
    assert b"Place order" in client.get("/checkout").body
    placed = client.form("/checkout", "")
    assert placed.status == 200 and b"Thank you for your order #" in placed.body
    assert "cart" not in client.cookies
    order_id = placed.text.split("order #")[1].split(".")[0]
    invoice = client.get(f"/account?invoice={order_id}.txt").text
    assert "2 x Orange Juice" in invoice and "placed" in invoice and "Alice Liddell" in invoice
    assert client.form("/checkout", "").status == 400


def test_api_cart_keeps_items_in_a_cookie(client: Client) -> None:
    assert client.get("/api/cart").json() == {"items": []}
    added = client.post_json("/api/cart", {"id": 1, "quantity": 3})
    assert added.status == 201 and added.json()["items"][0]["quantity"] == 3
    assert client.get("/api/cart").json()["items"][0]["name"] == "Apple Juice"
    cleared = client.request("DELETE", "/api/cart")
    assert cleared.json() == {"items": []} and "cart" not in client.cookies


def test_cart_cookie_parsing_is_bounded() -> None:
    assert parse_cart("1:2,x:1,2:0,3:99,4:1") == {1: 2, 4: 1}
    full = {n: 1 for n in range(MAX_CART_LINES)}
    assert add_to_cart(full, "999", "1") == full
    assert add_to_cart({1: MAX_QUANTITY}, "1", "5") == {1: MAX_QUANTITY}
    assert add_to_cart({}, "1", "zero") == {1: 1}


def test_bodies_with_bad_or_huge_length_still_get_an_answer(client: Client) -> None:
    assert client.request("POST", "/cart", None, {"Content-Length": "abc"}).status == 303
    assert client.request("POST", "/cart", b"x" * (64 * 1024 + 10), FORM).status == 303


def test_a_handler_error_is_a_500_not_a_dropped_connection(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(shop: Shop) -> list[object]:
        raise RuntimeError("boom")

    monkeypatch.setattr("demo.store.products", broken)
    assert client.get("/products").status == 500


def test_assets_and_generic_replies(shop: Shop) -> None:
    assert ASSETS["/static/img/hero.png"][1].startswith(b"\x89PNG\r\n\x1a\n")
    assert FAVICON[:4] == b"\x00\x00\x01\x00"
    page = respond("/about", Call("GET", "/about", {}, {}, {}, shop))
    assert page.status == 200 and page.content_type.startswith("text/html")
    api = respond("/api/status", Call("GET", "/api/status", {}, {}, {}, shop))
    assert json.loads(api.body) == {"route": "/api/status"}


def test_a_missing_database_stops_the_shop_before_it_listens(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="demo.seed"):
        make_server(Shop(tmp_path / "none.db", tmp_path / "files"), "127.0.0.1", 0)


def test_serve_prints_address_and_stops_on_ctrl_c(
    shop: Shop, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def interrupt(self: ShopServer, poll_interval: float = 0.5) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr(ShopServer, "serve_forever", interrupt)
    serve(make_server(shop, "127.0.0.1", 0), "http://127.0.0.1:0")
    assert "demo shop on http://127.0.0.1:0" in capsys.readouterr().out


def test_main_runs_a_given_database_or_a_scratch_shop(
    shop: Shop, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[tuple[str, Shop]] = []

    def record(server: ShopServer, where: str) -> None:
        seen.append((where, server.shop))
        server.server_close()

    monkeypatch.setattr(demo_main, "serve", record)
    demo_main.main(["--port", "0", "--db", str(shop.db), "--egress-proxy", "http://p:1"])
    expected = Shop(shop.db, demo_main.files_for(shop.db), "http://p:1")
    assert seen[-1] == ("http://127.0.0.1:0", expected)
    assert demo_main.files_for(Path("run/real.db")) == Path("run/real-files")
    monkeypatch.setattr(demo_main, "SCRATCH_PLAN", demo_main.Plan(users=5, orders=5))
    demo_main.main(["--port", "0"])
    assert seen[-1][1].db.name == "shop.db" and seen[-1][1].egress_proxy is None
