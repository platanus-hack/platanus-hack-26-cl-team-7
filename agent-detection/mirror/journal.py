"""Append-only JSON Lines files: the key table, the virtual patches and the reporter spool.

append() writes all its records with one os.write on an O_APPEND descriptor, under a lock, so
lines from threads never interleave and a crash leaves at most one torn last line. read() skips
torn or foreign lines, and the first append after a torn line starts on a new line, so a torn
line never spoils the next record. rewrite() replaces the file atomically (temp file, fsync,
os.replace), and move_to() renames it, so a reader never sees half of either.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import threading
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

FILE_MODE = 0o600
NEWLINE = b"\n"
_APPEND = os.O_RDWR | os.O_APPEND | os.O_CREAT  # read access for the torn-line check
_TRUNCATE = os.O_WRONLY | os.O_CREAT | os.O_TRUNC

log = logging.getLogger(__name__)


class Journal:
    def __init__(self, path: str | os.PathLike[str]) -> None:
        self.path = Path(path)
        self._lock = threading.Lock()
        self._fd: int | None = None

    def append(self, records: Iterable[Mapping[str, Any]]) -> None:
        data = b"".join(_encode(record) for record in records)
        if not data:
            return
        with self._lock:
            _write_all(self._open(), data)

    def read(self) -> list[dict[str, Any]]:
        """Every whole JSON object line, in file order; [] when the file is absent."""
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            return []
        records: list[dict[str, Any]] = []
        skipped = 0
        for line in raw.splitlines():
            try:
                record = json.loads(line)
            except ValueError:
                record = None
            if isinstance(record, dict):
                records.append(record)
            elif line.strip():
                skipped += 1
        if skipped:
            log.warning("%s: skipped %d unreadable line(s)", self.path, skipped)
        return records

    def rewrite(self, records: Iterable[Mapping[str, Any]]) -> None:
        data = b"".join(_encode(record) for record in records)
        temp = self.path.with_name(self.path.name + ".tmp")
        with self._lock:
            self._close()
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(temp, _TRUNCATE, FILE_MODE)
            try:
                _write_all(fd, data)
                os.fsync(fd)
            finally:
                os.close(fd)
            os.replace(temp, self.path)

    def move_to(self, target: Path) -> bool:
        """Rename the file to `target`; False when there is no file. Later appends start anew."""
        with self._lock:
            self._close()
            try:
                os.replace(self.path, target)
            except FileNotFoundError:
                return False
            return True

    def exists(self) -> bool:
        return self.path.exists()

    def remove(self) -> None:
        with self._lock:
            self._close()
            with contextlib.suppress(FileNotFoundError):
                self.path.unlink()

    def close(self) -> None:
        with self._lock:
            self._close()

    def _open(self) -> int:
        if self._fd is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(self.path, _APPEND, FILE_MODE)
            if _ends_torn(fd):
                _write_all(fd, NEWLINE)
            self._fd = fd
        return self._fd

    def _close(self) -> None:
        if self._fd is not None:
            os.close(self._fd)
            self._fd = None


def _encode(record: Mapping[str, Any]) -> bytes:
    return json.dumps(record, separators=(",", ":")).encode() + NEWLINE


def _ends_torn(fd: int) -> bool:
    size = os.fstat(fd).st_size
    return size > 0 and os.pread(fd, 1, size - 1) != NEWLINE


def _write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        view = view[os.write(fd, view) :]
