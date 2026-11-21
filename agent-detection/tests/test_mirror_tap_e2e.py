"""The router end to end: python -m mirror's main() with its default listeners (lane, tap, relay),
a real shop and a masked twin from demo.seed and demo.mask, a stub Sentinel and a callback server.
Edge.send() routes each request the way deploy/lanes.caddy does. One agent walks the planted flaws
on the twin; other clients show an attack in a login body, a twin-born username and a human."""

from __future__ import annotations

import contextlib
import hashlib
import json
import socketserver
import sqlite3
import threading
import time
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import pytest

from demo import auth, db
from demo.masking import load_policy
from demo.replica import Syncer
from demo.site import make_unix_server
from demo.sync import SyncServer
from demo.web import Shop
from mirror import cli
from mirror.sockets import UnixHTTPConnection
from tests.test_mirror_relay import free_port
from tests.test_mirror_tap_proxy import serving
from tests.test_twin_support import POLICY_FILE, make_shop, make_twin, socket_dir

AGENT = ("203.0.113.50", "python-httpx/0.27.0")
FORM = {"Content-Type": "application/x-www-form-urlencoded"}
LOGINS = ("/login", "/api/session")
SQLI = "username=" + quote_plus("' OR 1=1 --") + "&password=x"
WAIT = 10.0

Reply = tuple[int, str, dict[str, str]]


@dataclass
class Helper:
    """Stands in for Sentinel (POST) and for the attacker's callback server (GET)."""

    events: list[dict[str, Any]] = field(default_factory=list)
    callbacks: list[str] = field(default_factory=list)
    url: str = ""

    def handler(self) -> type[BaseHTTPRequestHandler]:
        helper = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                batch = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                helper.events.extend(batch)
                self.answer(202, json.dumps({"accepted": len(batch), "duplicates": 0}).encode())

            def do_GET(self) -> None:
                helper.callbacks.append(self.path)
                self.answer(200, b"pong")

            def answer(self, status: int, body: bytes) -> None:
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format: str, *args: Any) -> None:
                return None

        return Handler


@dataclass
class Edge:
    run: Path
    jar: dict[tuple[str, str], str] = field(default_factory=dict)
    count: int = 0

    def send(self, method: str, uri: str, body: str = "", who: tuple[str, str] = AGENT) -> Reply:
        self.count += 1
        base = {"X-Client-Ip": who[0], "User-Agent": who[1], "X-Request-Id": f"req-{self.count}"}
        base |= {"Cookie": self.jar[who]} if who in self.jar else {}
        asked = base | {"X-Forwarded-Method": method, "X-Forwarded-Uri": uri}
        lane = self.call("lane.sock", "GET", "/lane", "", asked)[2]
        routed = base | FORM | {"X-Lane": lane["X-Lane"], "X-Track-Id": lane["X-Track-Id"]}
        tap = lane["X-Lane"] == "mirror" or (method == "POST" and uri in LOGINS)
        status, text, headers = self.call(
            "tap.sock" if tap else "real.sock", method, uri, body, routed
        )
        cookie = headers.get("Set-Cookie", "").partition(";")[0]
        if cookie.startswith("session=") and cookie != "session=":
            self.jar[who] = cookie
        return status, text, lane | headers

    def call(self, sock: str, method: str, uri: str, body: str, headers: dict[str, str]) -> Reply:
        connection = UnixHTTPConnection(self.run / sock)
        try:
            connection.request(method, uri, body.encode() or None, headers)
            response = connection.getresponse()
            return response.status, response.read().decode(), dict(response.getheaders())
        finally:
            connection.close()


@dataclass
class World:
    edge: Edge
    helper: Helper
    data: Path
    stop: threading.Event
    router: threading.Thread

    def finish(self) -> list[dict[str, Any]]:
        """Stop the router (its reporter flushes on close) and return what Sentinel got."""
        self.stop.set()
        self.router.join(WAIT)
        assert not self.router.is_alive()
        return self.helper.events


@pytest.fixture
def world(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[World]:
    monkeypatch.setenv(cli.INGEST_ENV, "test-ingest-value")
    helper, relay_port = Helper(), free_port()
    real = make_shop(tmp_path)
    twin = make_twin(tmp_path, real, f"http://127.0.0.1:{relay_port}")
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), helper.handler())
    helper.url = f"http://127.0.0.1:{server.server_address[1]}"
    with socket_dir() as run, serving(server):
        names = ("lane", "tap", "real", "twin", "sync")
        argv = [part for name in names for part in (f"--{name}", str(run / f"{name}.sock"))]
        argv += ["--relay", f"127.0.0.1:{relay_port}", "--sentinel", helper.url]
        argv += ["--canaries", str(tmp_path / "canaries.json"), "--relay-allow-cidr", "127.0.0.0/8"]
        for name in ("state", "spool", "patches"):
            argv += [f"--{name}", str(tmp_path / f"{name}.jsonl")]
        stop, syncer = threading.Event(), Syncer(real.db, twin.db, load_policy(POLICY_FILE))
        router = threading.Thread(target=cli.main, args=(argv,), kwargs={"stop": stop})
        with (
            serving(make_unix_server(real, run / "real.sock")),
            serving(make_unix_server(twin, run / "twin.sock")),
            serving(SyncServer(run / "sync.sock", syncer)),
        ):
            router.start()
            deadline = time.monotonic() + WAIT
            while not all((run / f"{name}.sock").exists() for name in ("lane", "tap")):
                assert time.monotonic() < deadline, "the router never listened"
                time.sleep(0.02)
            try:
                yield World(Edge(run), helper, tmp_path, stop, router)
            finally:
                stop.set()
                router.join(WAIT)


def sessions(db: Path) -> set[str]:
    with contextlib.closing(sqlite3.connect(db)) as conn:
        return {row[0] for row in conn.execute("SELECT token FROM sessions")}


def test_an_agent_walks_the_twin_and_every_step_reaches_sentinel(world: World) -> None:
    edge, real_sessions = world.edge, sessions(world.data / "real.db")
    assert edge.send("GET", "/.env")[0] == 404
    assert edge.send("POST", "/login", "username=admin&password=guess")[0] == 401
    status, _, headers = edge.send("POST", "/login", SQLI)  # the twin's admin, via SQL injection
    track = headers["X-Track-Id"]
    assert status == 303 and headers["Location"] == "/account"
    status, text, _ = edge.send("GET", "/api/users/1")
    admin = json.loads(text)
    assert status == 200 and admin["role"] == "admin"
    assert edge.send("GET", "/account?invoice=../../etc/passwd")[1].startswith("root:x:0:0")
    avatar = "avatar_url=" + quote_plus(f"{world.helper.url}/cb?agent=1")
    assert "not a picture (HTTP 200" in edge.send("POST", "/account", avatar)[1]
    assert world.helper.callbacks == ["/cb?agent=1"]

    stranger = ("198.51.100.77", "Mozilla/5.0 (Windows NT 10.0)")
    status, _, headers = edge.send("POST", "/login", SQLI, stranger)  # an attack in the login body
    assert (status, headers["X-Lane"]) == (303, "real")  # the lane saw a clean URI
    patched_session = edge.jar[stranger].partition("=")[2]
    assert patched_session in sessions(world.data / "twin.db")
    other = ("192.0.2.99", "curl/8.7.1")
    login = f"username={quote_plus(admin['username'])}&password=guess"
    assert edge.send("POST", "/login", login, other)[0] == 401  # a twin-born username
    human = ("198.51.100.200", "Mozilla/5.0 (Macintosh)")
    assert edge.send("GET", "/products", who=human)[0] == 200
    assert edge.send("POST", "/login", "username=nobody&password=pw", human)[0] == 401
    assert sessions(world.data / "real.db") == real_sessions  # no agent reached real data

    events = world.finish()
    by_type = Counter(event["type"] for event in events)
    actions = [event for event in events if event["type"] == "track.action"]
    assert by_type["track.opened"] == 2
    assert {event["kind"] for event in events if event["type"] == "finding.confirmed"} == {
        "auth_flip",
        "canary_read",
        "signature_success",
    }
    mine = [action for action in actions if action["trackId"] == track]
    assert [action["path"] for action in mine] == [
        "/.env",
        "/login",
        "/login",
        "/api/users/1",
        "/account",
        f"{world.helper.url}/cb",
        "/account",
        "/login",
    ]
    assert not [event for event in events if event.get("ip") == human[0]]
    assert len(set(event["eventId"] for event in events)) == len(events)
    patches = (world.data / "patches.jsonl").read_text().splitlines()
    assert len(patches) == 1  # GET /account (file read); a login body needs none: it is read


def twin_dump(world: World) -> str:
    with contextlib.closing(sqlite3.connect(world.data / "twin.db")) as conn:
        return "\n".join(conn.iterdump())


def test_a_flagged_real_customer_stays_signed_in_on_a_twin_without_their_private_data(
    world: World,
) -> None:
    real = Shop(world.data / "real.db", world.data / "real-files")
    alice = auth.login(real, "alice", "wonderland")
    assert alice is not None
    world.edge.jar[AGENT] = f"session={alice.token}"
    assert world.edge.send("GET", "/.env")[0] == 404  # flagged: the session is copied to the twin
    status, text, headers = world.edge.send("GET", "/api/users/2")
    shown = json.loads(text)
    assert (status, headers["X-Lane"]) == (200, "mirror") and shown["id"] == 2
    assert shown["username"] != "alice" and shown["email"] != "alice.liddell@gmail.com"
    dump = twin_dump(world)
    assert alice.token in dump
    for private in ("alice.liddell", "Liddell", auth.password_hash("wonderland")):
        assert private not in dump
    other = ("192.0.2.99", "curl/8.7.1")
    login = "username=alice&password=wonderland"
    status, _, headers = world.edge.send("POST", "/login", login, other)
    assert (status, headers["X-Lane"]) == (303, "real")  # the real customer still logs in for real
    assert "wonderland" not in json.dumps(world.finish())


def test_a_username_the_real_shop_holds_never_routes_its_owner_to_the_twin(world: World) -> None:
    with contextlib.closing(sqlite3.connect(world.data / "twin.db")) as conn:
        shown_name = conn.execute("SELECT username FROM users WHERE id = 2").fetchone()[0]
    with db.opened(world.data / "real.db") as conn:  # a real user registers with that very name
        row = "999, ?, 'N N', 'n@example.net', '1', 'a', 'customer', ?, NULL, 'x'"
        conn.execute(f"INSERT INTO users VALUES ({row})", (shown_name, auth.password_hash("pw")))
    assert world.edge.send("GET", "/.env")[0] == 404
    assert world.edge.send("POST", "/login", "username=admin&password=guess")[0] == 401
    assert world.edge.send("POST", "/login", SQLI)[0] == 303  # the agent signs in on the twin
    assert json.loads(world.edge.send("GET", "/api/users/2")[1])["username"] == shown_name
    other = ("192.0.2.99", "curl/8.7.1")
    owner = f"username={quote_plus(shown_name)}&password=pw"
    status, _, headers = world.edge.send("POST", "/login", owner, other)
    assert (status, headers["X-Lane"]) == (303, "real")
    linked = {e["key"]["value"] for e in world.finish() if e["type"] == "track.linked"}
    assert hashlib.sha256(shown_name.encode()).hexdigest() not in linked
    assert [v for v in linked if len(v) == 64], "the session the twin gave out is still bound"
