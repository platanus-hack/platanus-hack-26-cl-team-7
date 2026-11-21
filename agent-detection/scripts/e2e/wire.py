"""HTTP for the e2e harness, stdlib only: the public edge on :8080 (a Client per source address
and User-Agent), the lane endpoint on run/lane.sock, Sentinel's API and its SSE stream.
"""

from __future__ import annotations

import http.client
import json
import socket
import threading
import time
from dataclasses import dataclass, field
from typing import Any

EDGE_PORT = 8080
SENTINEL = ("127.0.0.1", 8787)
TIMEOUT = 5.0
STREAM_TIMEOUT = 30.0  # Sentinel pings an open stream more often than this
RETRY = 0.2
NET_ERRORS = (OSError, http.client.HTTPException)


@dataclass(frozen=True)
class Reply:
    status: int
    headers: list[tuple[str, str]]
    body: bytes
    ms: float  # client side, from sending the request to the last body byte

    def header(self, name: str) -> list[str]:
        return [value for key, value in self.headers if key.lower() == name.lower()]

    def text(self) -> str:
        return self.body.decode("utf-8", "replace")

    def json(self) -> Any:
        return json.loads(self.body)


@dataclass
class Tally:
    """Every reply that reached a track: what the leak scan reads and how many there were."""

    replies: list[Reply] = field(default_factory=list)


@dataclass
class Client:
    """One client of the public edge. The edge sees `ip` ("127.0.0.1" or "::1") as {remote_host}.
    With `keep` it reuses one connection, as a browser does; else each request closes it."""

    ip: str
    ua: str
    cookie: str = ""
    keep: bool = False
    tally: Tally | None = None
    _conn: http.client.HTTPConnection | None = None

    def send(self, method: str, target: str, form: str = "") -> Reply:
        headers = {"Host": f"localhost:{EDGE_PORT}", "User-Agent": self.ua, "Accept": "*/*"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        if form:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        if not self.keep:
            headers["Connection"] = "close"
        conn = self._conn or http.client.HTTPConnection(self.ip, EDGE_PORT, timeout=TIMEOUT)
        self._conn = None
        started = time.perf_counter()
        try:
            conn.request(method, target, form.encode() if form else None, headers)
            response = conn.getresponse()
            body = response.read()
        except NET_ERRORS:
            conn.close()
            raise
        reply = Reply(response.status, response.getheaders(), body,
                      (time.perf_counter() - started) * 1000)
        if self.keep and not response.will_close:
            self._conn = conn
        else:
            conn.close()
        if self.tally is not None:
            self.tally.replies.append(reply)
        return reply


class _UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str) -> None:
        super().__init__("localhost", timeout=TIMEOUT)
        self._path = path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(TIMEOUT)
        sock.connect(self._path)
        self.sock = sock


class Lane:
    """GET /lane on the router's socket, as Caddy's forward_auth asks it, on one kept connection."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._conn: _UnixConnection | None = None

    def ask(self, headers: dict[str, str]) -> tuple[str, str]:
        """(X-Lane, X-Track-Id). A dropped kept connection is opened again once."""
        try:
            return self._ask(headers)
        except NET_ERRORS:
            self.close()
            return self._ask(headers)

    def _ask(self, headers: dict[str, str]) -> tuple[str, str]:
        conn = self._conn = self._conn or _UnixConnection(self._path)
        conn.request("GET", "/lane", headers=headers)
        response = conn.getresponse()
        response.read()
        return response.getheader("X-Lane", ""), response.getheader("X-Track-Id", "")

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
        self._conn = None


def sentinel(method: str, path: str, body: Any = None, token: str = "") -> tuple[int, Any]:
    """One call to Sentinel's API: (status, decoded JSON or None)."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    conn = http.client.HTTPConnection(*SENTINEL, timeout=TIMEOUT)
    try:
        conn.request(method, path, None if body is None else json.dumps(body).encode(), headers)
        response = conn.getresponse()
        data = response.read()
    finally:
        conn.close()
    return response.status, json.loads(data) if data else None


@dataclass
class Stream:
    """Reads GET /v1/stream on a thread and keeps every track change with its arrival time. It
    connects again after Sentinel restarts."""

    tracks: list[tuple[float, dict[str, Any]]] = field(default_factory=list)
    connects: int = 0
    stop: threading.Event = field(default_factory=threading.Event)

    def start(self) -> None:
        threading.Thread(target=self._run, name="sse", daemon=True).start()

    def seen(self, track_id: str) -> list[tuple[float, int]]:
        """(arrival, actions) of each streamed change of this track."""
        return [(at, t["actions"]) for at, t in list(self.tracks) if t["trackId"] == track_id]

    def _run(self) -> None:
        while not self.stop.is_set():
            try:
                self._read()
            except (*NET_ERRORS, ValueError):
                self.stop.wait(RETRY)

    def _read(self) -> None:
        conn = http.client.HTTPConnection(*SENTINEL, timeout=STREAM_TIMEOUT)
        try:
            conn.request("GET", "/v1/stream", headers={"Accept": "text/event-stream"})
            response = conn.getresponse()
            self.connects += 1
            event, data = "", ""
            while not self.stop.is_set():
                line = response.readline().decode("utf-8")
                if not line:
                    return
                if line.startswith("event:"):
                    event = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    data += line[len("data:"):].strip()
                elif not line.strip():
                    self._frame(event, data)
                    event, data = "", ""
        finally:
            conn.close()

    def _frame(self, event: str, data: str) -> None:
        if event != "batch" or not data:
            return
        now = time.time()
        for change in json.loads(data).get("changes", []):
            if change.get("kind") == "track":
                self.tracks.append((now, change["track"]))
