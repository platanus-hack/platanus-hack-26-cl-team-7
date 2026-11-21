"""Reads Caddy v2 JSON access-log lines into Request objects, from a file or a live tail."""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any, BinaryIO

from engine.models import Request

_ACCESS_LOGGER = "http.log.access"


def parse_line(line: str) -> Request | None:
    try:
        entry = json.loads(line)
    except ValueError:
        return None
    if not isinstance(entry, dict) or not _is_access(entry):
        return None
    request = entry.get("request")
    ts, status = _number(entry.get("ts")), _number(entry.get("status"))
    if not isinstance(request, dict) or ts is None or status is None:
        return None
    method, uri = request.get("method"), request.get("uri")
    if not isinstance(method, str) or not isinstance(uri, str):
        return None
    path, _, query = uri.partition("?")
    return Request(
        ts=ts,
        ip=_client_ip(request),
        user_agent=_user_agent(request.get("headers")),
        method=method,
        path=path,
        query=query,
        status=int(status),
    )


def read_requests(path: str | Path) -> Iterator[Request]:
    with Path(path).open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            req = parse_line(line)
            if req is not None:
                yield req


def follow(
    path: str | Path,
    poll_interval: float = 0.2,
    stop: threading.Event | None = None,
    *,
    from_start: bool = False,
) -> Iterator[Request]:
    """Yield requests appended to path, like `tail -F`: survives truncation and rotation."""
    halt = stop or threading.Event()
    tail = _Tail(Path(path), at_end=not from_start)
    try:
        while not halt.is_set():
            lines = tail.poll()
            for line in lines:
                req = parse_line(line)
                if req is not None:
                    yield req
            if not lines:
                halt.wait(poll_interval)
    finally:
        tail.close()


class _Tail:
    def __init__(self, path: Path, *, at_end: bool) -> None:
        self.path = path
        self.handle: BinaryIO | None = None
        self.identity: tuple[int, int] = (0, 0)
        self.buffer = b""
        self._open(at_end=at_end)

    def poll(self) -> list[str]:
        if self.handle is None and not self._open(at_end=False):
            return []
        data = self._read()
        if not data and self._reset_if_replaced():
            data = self._read()
        return self._lines(data)

    def close(self) -> None:
        if self.handle is not None:
            self.handle.close()
            self.handle = None

    def _open(self, *, at_end: bool) -> bool:
        try:
            handle = self.path.open("rb")
        except OSError:
            return False
        self.close()
        stat = os.fstat(handle.fileno())
        if at_end:
            handle.seek(0, os.SEEK_END)
        self.handle, self.identity, self.buffer = handle, (stat.st_dev, stat.st_ino), b""
        return True

    def _read(self) -> bytes:
        return self.handle.read() if self.handle is not None else b""

    def _reset_if_replaced(self) -> bool:
        try:
            stat = os.stat(self.path)
        except OSError:
            return False
        if (stat.st_dev, stat.st_ino) != self.identity:
            return self._open(at_end=False)
        if self.handle is not None and stat.st_size < self.handle.tell():
            self.handle.seek(0)
            self.buffer = b""
            return True
        return False

    def _lines(self, data: bytes) -> list[str]:
        if not data:
            return []
        *complete, self.buffer = (self.buffer + data).split(b"\n")
        return [raw.decode("utf-8", errors="replace") for raw in complete]


def _is_access(entry: dict[str, Any]) -> bool:
    logger = entry.get("logger")
    return logger is None or (isinstance(logger, str) and logger.startswith(_ACCESS_LOGGER))


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _client_ip(request: dict[str, Any]) -> str:
    for key in ("client_ip", "remote_ip"):
        value = request.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _user_agent(headers: Any) -> str:
    if not isinstance(headers, dict):
        return ""
    values = headers.get("User-Agent")
    if isinstance(values, list) and values and isinstance(values[0], str):
        return values[0]
    return ""
