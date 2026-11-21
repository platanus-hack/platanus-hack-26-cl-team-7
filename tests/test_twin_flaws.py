"""The four planted flaws: they work as an agent expects, and none reaches past the instance."""

import contextlib
import sqlite3
import threading
from collections.abc import Iterator
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from test_twin_support import Client, make_shop, running

from demo import db, files
from demo.fetch import FetchError, fetch
from demo.site import make_server
from demo.web import Shop


def union(user_id: str, username: str, rest: str = "") -> str:
    """An injected username whose UNION has the ten columns of `users`."""
    return f"' UNION SELECT {user_id}, {username}, 3, 4, 5, 6, 7, 8, 9, 10 {rest}--"


ADMIN_EMAIL_SQL = union("1", "email", "FROM users WHERE role = 'admin' ")


@pytest.fixture(scope="module")
def shop(tmp_path_factory: pytest.TempPathFactory) -> Shop:
    return make_shop(tmp_path_factory.mktemp("flaws"))


@pytest.fixture
def serve_shop(shop: Shop) -> Iterator[Client]:
    with running(make_server(shop, "127.0.0.1", 0)) as server:
        yield Client(int(server.server_address[1]))


def admin(shop: Shop) -> sqlite3.Row:
    with db.opened(shop.db) as conn:
        row: sqlite3.Row = conn.execute("SELECT * FROM users WHERE role = 'admin'").fetchone()
    return row


def test_sql_injection_bypasses_the_form_login_as_the_first_user(
    serve_shop: Client, shop: Shop
) -> None:
    answer = serve_shop.form("/login", "username=' OR 1=1 --&password=anything")
    assert answer.status == 303 and serve_shop.cookies["session"]
    assert serve_shop.get("/api/session").json() == {"user": admin(shop)["username"]}


def test_sql_injection_on_the_json_login_echoes_chosen_values(
    serve_shop: Client, shop: Shop
) -> None:
    answer = serve_shop.post_json("/api/session", {"username": ADMIN_EMAIL_SQL, "password": "x"})
    assert answer.status == 200 and answer.json()["user"] == admin(shop)["email"]
    assert answer.json()["token"] == serve_shop.cookies["session"]


@pytest.mark.parametrize("username", ["admin' --", union("99999", "'x'"), union("'abc'", "'x'")])
def test_injections_that_name_no_real_user_fail_like_a_wrong_password(
    serve_shop: Client, username: str
) -> None:
    answer = serve_shop.post_json("/api/session", {"username": username, "password": "x"})
    assert answer.status == 401


def test_broken_sql_shows_the_database_error(serve_shop: Client, tmp_path: Path) -> None:
    page = serve_shop.form("/login", "username='&password=x")
    assert page.status == 500 and b"database error" in page.body
    stacked = f"'; ATTACH DATABASE '{tmp_path / 'x.db'}' AS x; --"
    answer = serve_shop.post_json("/api/session", {"username": stacked, "password": "x"})
    assert answer.status == 500 and "database error" in answer.json()["error"]
    assert not (tmp_path / "x.db").exists()
    two = {"username": "' UNION SELECT 1, 2 --", "password": "x"}
    short = serve_shop.post_json("/api/session", two)
    assert short.status == 500 and "number of result columns" in short.json()["error"]


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1 FROM users WHERE 1 = 0 UNION SELECT load_extension('x')",
        "SELECT randomblob(100)",
        "PRAGMA table_info(users)",
        "INSERT INTO sessions VALUES ('t', 1, 'now')",
        "DELETE FROM users",
        "ATTACH DATABASE ':memory:' AS other",
    ],
)
def test_the_injectable_connection_only_reads(shop: Shop, sql: str) -> None:
    with db.injectable(shop.db) as conn, pytest.raises(sqlite3.DatabaseError):
        conn.execute(sql).fetchall()


def test_the_injectable_connection_stops_runaway_queries(shop: Shop) -> None:
    loop = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT max(i) FROM n"
    with db.injectable(shop.db) as conn, pytest.raises(sqlite3.OperationalError, match="interrupt"):
        conn.execute(loop).fetchall()
    with db.injectable(shop.db) as conn:
        assert conn.execute("SELECT count(*) FROM users").fetchone()[0] > 0


def test_user_records_need_a_session_but_any_session_reads_any_user(
    serve_shop: Client, shop: Shop
) -> None:
    assert serve_shop.get("/api/users/1").status == 401
    serve_shop.form("/login", "username=alice&password=wonderland")
    record = serve_shop.get("/api/users/1").json()
    target = admin(shop)
    assert record["email"] == target["email"] and record["address"] == target["address"]
    assert record["role"] == "admin" and "password_hash" not in record
    assert all("password" not in key.lower() for key in record)
    assert serve_shop.get("/api/users/99999").status == 404
    assert serve_shop.get("/api/users/me").status == 404


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("../../etc/passwd", "root:x:0:0"),
        ("/etc/passwd", "root:x:0:0"),
        ("..\\..\\..\\etc\\hostname", "shop-web-1"),
        ("../../../../../../../../etc/os-release", "Debian"),
        ("../docs/returns.txt", "Returns"),
        ("1.txt", "FreshJuice invoice #1"),
        ("../invoices/2.txt", "FreshJuice invoice #2"),
    ],
)
def test_invoice_download_reads_by_path_inside_the_files_folder(
    serve_shop: Client, name: str, expected: str
) -> None:
    answer = serve_shop.get(f"/account?invoice={name}")
    assert answer.status == 200 and expected in answer.text


MISSES = ["", "%00", "../docs", "99999.txt", "../../etc/shadow", "x" * 5000, "../../proc/self/fd/0"]


@pytest.mark.parametrize("name", MISSES)
def test_invoice_download_misses_are_404(serve_shop: Client, name: str) -> None:
    assert serve_shop.get(f"/account?invoice={name}").status == 404


def test_file_read_never_leaves_the_folder(shop: Shop, tmp_path: Path) -> None:
    outside = tmp_path / "host-secret.txt"
    outside.write_text("host data\n")
    folder = tmp_path / "files"
    files.prepare(folder)
    (folder / "docs" / "escape.txt").symlink_to(outside)
    (folder / "etc" / "loop").symlink_to(folder.parent)
    mine = replace(shop, files=folder)
    escapes = (f"../..{outside}", str(outside), "../docs/escape.txt", "../etc/loop/host-secret.txt")
    for name in escapes:
        assert files.read(mine, name) is None, name
    assert files.virtual_path("../../../x") == "/x"
    assert files.virtual_path("a/../../b") == "/b"
    assert not list(folder.rglob("*.part"))


class FakeProxy(BaseHTTPRequestHandler):
    seen: list[str] = []
    reply = (200, "image/png", b"\x89PNG fake")

    def do_GET(self) -> None:
        FakeProxy.seen.append(f"{self.requestline} host={self.headers['Host']}")
        status, kind, body = FakeProxy.reply
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_CONNECT(self) -> None:
        FakeProxy.seen.append(self.requestline)
        self.send_response(403)
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        return None


@pytest.fixture
def proxy() -> Iterator[str]:
    FakeProxy.seen.clear()
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeProxy)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


@contextlib.contextmanager
def signed_in(shop: Shop) -> Iterator[Client]:
    with running(make_server(shop, "127.0.0.1", 0)) as server:
        client = Client(int(server.server_address[1]))
        client.form("/login", "username=alice&password=wonderland")
        yield client


def test_picture_fetch_without_a_proxy_fails_like_a_dead_network(shop: Shop) -> None:
    with signed_in(shop) as client:
        answer = client.form("/account", "avatar_url=http://example.com/me.png")
        assert answer.status == 400 and b"could not connect to example.com" in answer.body


def test_picture_fetch_goes_only_through_the_egress_proxy(shop: Shop, proxy: str) -> None:
    with signed_in(replace(shop, egress_proxy=proxy)) as client:
        FakeProxy.reply = (200, "image/png", b"\x89PNG fake")
        answer = client.form("/account", "avatar_url=http://example.com/me.png?size=2")
        assert answer.status == 200 and b"picture is updated" in answer.body
        assert FakeProxy.seen == ["GET http://example.com/me.png?size=2 HTTP/1.1 host=example.com"]
        assert b'src="http://example.com/me.png?size=2"' in client.get("/account").body
        FakeProxy.reply = (404, "text/html", b"<h1>callback received</h1>")
        page = client.form("/account", "avatar_url=http://cb.example.net/x")
        assert page.status == 200 and b"HTTP 404, text/html" in page.body
        assert b"callback received" in page.body
        failed = client.form("/account", "avatar_url=https://example.com/me.png")
        assert failed.status == 400 and FakeProxy.seen[-1].startswith("CONNECT example.com:443")


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("ftp://example.com/x", "only http and https"),
        ("not a url", "only http and https"),
        ("http://example.com:99999/", "bad port"),
    ],
)
def test_fetch_refuses_urls_it_cannot_send(url: str, message: str) -> None:
    with pytest.raises(FetchError, match=message):
        fetch(url, "http://127.0.0.1:9")


def test_fetch_through_a_dead_or_empty_proxy_is_unreachable() -> None:
    for proxy in ("http://127.0.0.1:1", "http://", None):
        with pytest.raises(FetchError, match="could not connect to example.com"):
            fetch("http://example.com/", proxy)


@pytest.mark.parametrize("status", [502, 504])
def test_a_proxy_that_could_not_reach_the_host_looks_like_a_dead_network(
    proxy: str, status: int
) -> None:
    FakeProxy.reply = (status, "text/html", b"<h1>Bad gateway</h1>")
    with pytest.raises(FetchError, match="could not connect to cb.example.net"):
        fetch("http://cb.example.net/x", proxy)
    FakeProxy.reply = (503, "text/html", b"busy")
    assert fetch("http://cb.example.net/x", proxy).status == 503
