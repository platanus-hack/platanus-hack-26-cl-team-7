"""Shared helpers for the demo shop and twin data tests: a small seeded shop, servers that run
in-process (so coverage sees them) and a client for TCP or Unix sockets."""

from __future__ import annotations

import contextlib
import http.client
import json
import tempfile
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from socketserver import BaseServer
from typing import Any

import pytest

from demo.mask import mask
from demo.masking import load_policy
from demo.seed import Plan, seed
from demo.web import Shop
from mirror.sockets import UnixHTTPConnection

ROOT = Path(__file__).resolve().parents[1]
POLICY_FILE = ROOT / "config" / "mask.yaml"
ANCHOR = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
SMALL = Plan(seed=11, users=30, orders=120, anchor=ANCHOR)
FORM = {"Content-Type": "application/x-www-form-urlencoded"}
JSON_TYPE = {"Content-Type": "application/json"}


@dataclass(frozen=True)
class Answer:
    status: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body)

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")


def make_shop(folder: Path, plan: Plan = SMALL, proxy: str | None = None) -> Shop:
    folder.mkdir(parents=True, exist_ok=True)
    seed(folder / "real.db", plan)
    return Shop(folder / "real.db", folder / "real-files", proxy)


def make_twin(folder: Path, real: Shop, proxy: str | None = None) -> Shop:
    twin = Shop(folder / "twin.db", folder / "twin-files", proxy)
    mask(real.db, twin.db, load_policy(POLICY_FILE), folder / "canaries.json")
    return twin


@contextlib.contextmanager
def running(server: BaseServer) -> Iterator[BaseServer]:
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@contextlib.contextmanager
def socket_dir() -> Iterator[Path]:
    # macOS caps AF_UNIX paths near 104 bytes; pytest's tmp_path can be longer.
    with tempfile.TemporaryDirectory(dir="/tmp") as name:
        yield Path(name)


class Client:
    """Requests to a TCP port or a Unix socket path, with a cookie jar of one session."""

    def __init__(self, where: int | Path) -> None:
        self.where = where
        self.cookies: dict[str, str] = {}

    def connection(self) -> http.client.HTTPConnection:
        if isinstance(self.where, Path):
            return UnixHTTPConnection(self.where)
        return http.client.HTTPConnection("127.0.0.1", self.where, timeout=5)

    def request(
        self,
        method: str,
        path: str,
        body: bytes | str | None = None,
        headers: dict[str, str] | None = None,
    ) -> Answer:
        sent = dict(headers or {})
        if self.cookies and "Cookie" not in sent:
            sent["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        conn = self.connection()
        try:
            conn.request(method, path, body=body, headers=sent)
            resp = conn.getresponse()
            answer = Answer(resp.status, dict(resp.getheaders()), resp.read())
        finally:
            conn.close()
        cookie = answer.headers.get("Set-Cookie", "")
        name, _, rest = cookie.partition("=")
        if name:
            value = rest.split(";", 1)[0]
            if value and "Max-Age=0" not in cookie:
                self.cookies[name] = value
            else:
                self.cookies.pop(name, None)
        return answer

    def get(self, path: str, headers: dict[str, str] | None = None) -> Answer:
        return self.request("GET", path, headers=headers)

    def form(self, path: str, body: str) -> Answer:
        return self.request("POST", path, body, FORM)

    def post_json(self, path: str, data: object, headers: dict[str, str] | None = None) -> Answer:
        return self.request("POST", path, json.dumps(data), {**JSON_TYPE, **(headers or {})})


def test_small_shop_and_twin_build_in_one_folder(tmp_path: Path) -> None:
    real = make_shop(tmp_path)
    twin = make_twin(tmp_path, real)
    assert real.db.is_file() and twin.db.is_file()
    assert (tmp_path / "canaries.json").is_file()
    with pytest.raises(ValueError):
        mask(real.db, real.db, load_policy(POLICY_FILE), tmp_path / "c.json")
