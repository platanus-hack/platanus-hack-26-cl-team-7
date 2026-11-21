"""The canaries of run/canaries.json and the test for one in a twin answer.

A canary is an ordinary private value only the twin holds (demo.mask writes the file): the admin's
masked email, phone and address, the masked ship-to addresses of the newest orders. Never a
secret. An answer holds a canary when it holds the value as UTF-8, JSON-escaped (the shop's JSON
escapes non-ASCII) or HTML-escaped. The file is read again whenever it changes.
"""

from __future__ import annotations

import html
import json
import logging
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Canary:
    kind: str
    where: str  # "<table>.<column> row <id>"
    needles: tuple[bytes, ...]  # the value as UTF-8, JSON-escaped and HTML-escaped


class Canaries:
    """run/canaries.json, read again whenever the file changes (the mask job rewrites it)."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._stamp: tuple[int, int] | None = None
        self._items: tuple[Canary, ...] = ()

    def find(self, body: bytes) -> Canary | None:
        for canary in self._current():
            if any(needle in body for needle in canary.needles):
                return canary
        return None

    def _current(self) -> tuple[Canary, ...]:
        try:
            info = self._path.stat()
        except OSError:
            return ()
        stamp = (info.st_mtime_ns, info.st_size)
        if stamp != self._stamp:
            self._items, self._stamp = _load_canaries(self._path), stamp
        return self._items


def _load_canaries(path: Path) -> tuple[Canary, ...]:
    try:
        items = json.loads(path.read_text(encoding="utf-8"))["canaries"]
        canaries = tuple(
            Canary(
                str(item["kind"]),
                f"{item['table']}.{item['column']} row {item['rowId']}",
                _needles(item["value"]),
            )
            for item in items
            if isinstance(item["value"], str) and item["value"]
        )
    except (OSError, ValueError, KeyError, TypeError) as err:
        log.warning("%s: no canaries (%s)", path, err)
        return ()
    log.info("%s: %d canaries", path, len(canaries))
    return canaries


def _needles(value: str) -> tuple[bytes, ...]:
    forms = (value, json.dumps(value)[1:-1], html.escape(value))
    return tuple(dict.fromkeys(form.encode() for form in forms))
