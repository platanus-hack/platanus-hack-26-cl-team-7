"""Real and twin shops on Unix sockets: the same code and replies, only the data differs."""

import json
import stat
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
from test_twin_support import Answer, Client, make_shop, make_twin, running, socket_dir

import demo.__main__ as demo_main
from demo.site import UnixShopServer, make_unix_server
from demo.web import Shop

SQLI_LOGIN = "username=' OR 1=1 --&password=x"
AGENTS = 24  # more than socketserver's default listen queue of 5
# Headers whose values may differ between two replies: the clock, the size of the data and the
# session token.
PER_REPLY = {"Date", "Content-Length", "Set-Cookie"}
PUBLIC_PAGES = [
    ("GET", "/", None),
    ("GET", "/products", None),
    ("GET", "/products/3", None),
    ("GET", "/api/products", None),
    ("GET", "/search?q=juice", None),
    ("GET", "/login", None),
    ("GET", "/static/css/site.css", None),
    ("GET", "/favicon.ico", None),
    ("GET", "/account?invoice=../../etc/passwd", None),
    ("GET", "/zz-unknown", None),
    ("PUT", "/login", None),
    ("POST", "/login", "username=alice&password=nope"),
    ("POST", "/login", "username='&password=x"),
    ("GET", "/api/users/1", None),
    ("GET", "/account", None),
]


@pytest.fixture(scope="module")
def lanes(tmp_path_factory: pytest.TempPathFactory) -> Iterator[tuple[Path, Path, Shop, Shop]]:
    folder = tmp_path_factory.mktemp("lanes")
    real = make_shop(folder)
    twin = make_twin(folder, real, proxy="http://127.0.0.1:9")
    with socket_dir() as sockets:
        real_sock, twin_sock = sockets / "real.sock", sockets / "twin.sock"
        with running(make_unix_server(real, real_sock)), running(make_unix_server(twin, twin_sock)):
            yield real_sock, twin_sock, real, twin


def send(client: Client, method: str, path: str, form: str | None) -> Answer:
    if form is None:
        return client.request(method, path)
    return client.form(path, form)


def assert_alike(mine: Answer, theirs: Answer) -> None:
    assert mine.status == theirs.status
    assert list(mine.headers) == list(theirs.headers)
    for name, value in mine.headers.items():
        if name not in PER_REPLY:
            assert theirs.headers[name] == value, name


@pytest.mark.parametrize(("method", "path", "form"), PUBLIC_PAGES)
def test_public_replies_are_byte_for_byte_the_same_on_both_lanes(
    lanes: tuple[Path, Path, Shop, Shop], method: str, path: str, form: str | None
) -> None:
    real = send(Client(lanes[0]), method, path, form)
    twin = send(Client(lanes[1]), method, path, form)
    assert_alike(real, twin)
    assert real.body == twin.body
    assert real.headers.get("Server") == "DemoShop/0.1"


def test_signed_in_replies_differ_only_in_data(lanes: tuple[Path, Path, Shop, Shop]) -> None:
    real, twin = Client(lanes[0]), Client(lanes[1])
    logins = real.form("/login", SQLI_LOGIN), twin.form("/login", SQLI_LOGIN)
    assert_alike(*logins)
    assert logins[0].status == 303 and real.cookies["session"] != twin.cookies["session"]
    for path in ("/api/users/1", "/api/users/2", "/account", "/account?invoice=1.txt"):
        mine, theirs = real.get(path), twin.get(path)
        assert_alike(mine, theirs)
        assert mine.status == 200 and mine.body != theirs.body, path
    record = twin.get("/api/users/1").json()
    canaries = json.loads((lanes[3].db.with_name("canaries.json")).read_text())["canaries"]
    assert record["email"] in {c["value"] for c in canaries}
    assert real.get("/api/users/1").json()["email"] not in {c["value"] for c in canaries}


def test_real_passwords_do_not_work_on_the_twin(lanes: tuple[Path, Path, Shop, Shop]) -> None:
    login = "username=alice&password=wonderland"
    assert Client(lanes[0]).form("/login", login).status == 303
    assert Client(lanes[1]).form("/login", login).status == 401


def test_each_lane_reads_only_its_own_files_folder(lanes: tuple[Path, Path, Shop, Shop]) -> None:
    real_sock, twin_sock, real, _ = lanes
    (real.files / "docs" / "only-real.txt").write_text("real lane file\n")
    for name in ("../docs/only-real.txt", "/docs/only-real.txt"):
        assert Client(real_sock).get(f"/account?invoice={name}").status == 200
        assert Client(twin_sock).get(f"/account?invoice={name}").status == 404
    escape = f"../../../..{real.files}/docs/only-real.txt"
    assert Client(twin_sock).get(f"/account?invoice={escape}").status == 404


def test_sockets_are_owner_only(lanes: tuple[Path, Path, Shop, Shop]) -> None:
    for sock in lanes[:2]:
        assert stat.S_ISSOCK(sock.stat().st_mode) and stat.S_IMODE(sock.stat().st_mode) == 0o600


def test_many_agents_at_once_get_their_own_sessions_and_orders(
    lanes: tuple[Path, Path, Shop, Shop],
) -> None:
    placed: list[str] = []
    errors: list[BaseException] = []

    def shopper() -> None:
        try:
            client = Client(lanes[1])
            assert client.form("/login", SQLI_LOGIN).status == 303
            client.form("/cart", "id=2&quantity=1")
            answer = client.form("/checkout", "")
            assert answer.status == 200
            placed.append(answer.text.split("order #")[1].split(".")[0])
        except BaseException as exc:  # reported to the test thread below
            errors.append(exc)

    threads = [threading.Thread(target=shopper) for _ in range(AGENTS)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == [] and len(set(placed)) == AGENTS


def test_main_serves_a_socket_with_the_given_instance(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    shop = make_shop(tmp_path)
    seen: list[tuple[str, Shop, int]] = []

    def record(server: UnixShopServer, where: str) -> None:
        seen.append((where, server.shop, stat.S_IMODE(server.socket_path.stat().st_mode)))
        server.server_close()

    monkeypatch.setattr(demo_main, "serve", record)
    with socket_dir() as sockets:
        sock = sockets / "twin.sock"
        argv = ["--socket", str(sock), "--db", str(shop.db), "--files", str(tmp_path / "f")]
        demo_main.main([*argv, "--egress-proxy", "http://127.0.0.1:8097"])
        assert not sock.exists()
    expected = Shop(shop.db, tmp_path / "f", "http://127.0.0.1:8097")
    assert seen == [(f"unix:{sock}", expected, 0o600)]
    assert (tmp_path / "f" / "etc" / "passwd").is_file()


def test_socket_and_port_are_one_or_the_other(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        demo_main.parse(["--socket", "run/x.sock", "--port", "1"])
    assert "not allowed with argument" in capsys.readouterr().err
