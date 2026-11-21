"""The key table: which track a request belongs to, by IP + User-Agent, by IP or by twin-born value.

ip_ua binds on any verdict, ip only on an R3 critical verdict, twin_born on a value the twin gave
out (a token, cookie value, username or email; it matches from any IP). Each key lives IDLE[kind]
seconds after its last use. The table holds a 16-byte digest of kind and value, never the value,
so a key costs the same memory whatever the User-Agent length and a twin-born value is never kept
in clear (its TrackKey value is already a sha256 hex). Each kind is an LRU dict in order of last
use: expiry pops from the front, and MAX_PER_KIND bounds memory.

The journal (run/mirror-keys.jsonl) gets one line per bind, and one per use at most every
TOUCH_PERSIST seconds; load() replays it, drops expired keys and compacts it.
"""

from __future__ import annotations

import hashlib
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mirror.contracts import ID_HEX, TRACK_PREFIX, KeyKind, TrackKey
from mirror.journal import Journal

HOUR = 3600.0
IDLE: dict[KeyKind, float] = {"ip_ua": 24 * HOUR, "ip": HOUR, "twin_born": 24 * HOUR}
TOUCH_PERSIST = 600.0  # a key in use is written again at most this often
MAX_PER_KIND = 100_000
COMPACT_RATIO = 4  # compact once the journal holds this many lines per live key ...
COMPACT_SLACK = 10_000  # ... plus this many
MIN_TWIN_BORN_LEN = 6  # shorter values ("1", "admin") are too common to tell a twin apart
DIGEST_BYTES = 16

_TRACK_ID = re.compile(rf"{TRACK_PREFIX}[0-9a-f]{{{ID_HEX}}}")
_DIGEST_HEX = re.compile(rf"[0-9a-f]{{{2 * DIGEST_BYTES}}}")

Clock = Callable[[], float]


def twin_born_key(raw: str) -> TrackKey | None:
    """The twin_born key for a value the twin gave out, or None when it is too short to bind."""
    if len(raw) < MIN_TWIN_BORN_LEN:
        return None
    return TrackKey("twin_born", hashlib.sha256(raw.encode("utf-8", "surrogatepass")).hexdigest())


def digest(key: TrackKey) -> bytes:
    text = f"{key.kind}|{key.value}".encode("utf-8", "surrogatepass")
    return hashlib.blake2b(text, digest_size=DIGEST_BYTES).digest()


@dataclass(slots=True)
class _Entry:
    track_id: str
    seen: float  # last use, Unix seconds
    saved: float  # `seen` as the journal last recorded it


class KeyTable:
    def __init__(
        self, journal: Journal, *, clock: Clock = time.time, max_per_kind: int = MAX_PER_KIND
    ) -> None:
        self._journal = journal
        self._clock = clock
        self._max = max_per_kind
        self._tables: dict[KeyKind, OrderedDict[bytes, _Entry]] = {k: OrderedDict() for k in IDLE}
        self._lock = threading.Lock()
        self._lines = 0

    @classmethod
    def load(cls, path: str | Path, **options: Any) -> KeyTable:
        table = cls(Journal(path), **options)
        with table._lock:
            table._restore(table._journal.read())
            table._compact()
        return table

    def find(self, keys: Iterable[TrackKey]) -> tuple[str, TrackKey] | None:
        """The track of the first bound key in `keys`, and that key. Every bound key is touched."""
        found: tuple[str, TrackKey] | None = None
        with self._lock:
            now = self._clock()
            for key in keys:
                entry = self._use(key.kind, digest(key), now)
                if entry is not None and found is None:
                    found = (entry.track_id, key)
        return found

    def bind(self, key: TrackKey, track_id: str) -> bool:
        """Bind an unbound key to `track_id`; True when it is new. A key bound to this track is
        only touched, and a key bound to another track keeps it: a track is never taken over."""
        with self._lock:
            now = self._clock()
            kind, code = key.kind, digest(key)
            if self._use(kind, code, now) is not None:
                return False
            table = self._tables[kind]
            table[code] = entry = _Entry(track_id, now, now)
            self._save(kind, code, entry)
            if len(table) > self._max:
                table.popitem(last=False)
            if self._lines > COMPACT_RATIO * len(self) + COMPACT_SLACK:
                self._compact()
            return True

    def __len__(self) -> int:
        return sum(len(table) for table in self._tables.values())

    def close(self) -> None:
        self._journal.close()

    def _use(self, kind: KeyKind, code: bytes, now: float) -> _Entry | None:
        table = self._tables[kind]
        self._expire(table, now - IDLE[kind])
        entry = table.get(code)
        if entry is None:
            return None
        entry.seen = max(entry.seen, now)
        table.move_to_end(code)
        if entry.seen - entry.saved >= TOUCH_PERSIST:
            self._save(kind, code, entry)
        return entry

    @staticmethod
    def _expire(table: OrderedDict[bytes, _Entry], cutoff: float) -> None:
        while table:
            code, oldest = next(iter(table.items()))
            if oldest.seen >= cutoff:
                return
            del table[code]

    def _save(self, kind: KeyKind, code: bytes, entry: _Entry) -> None:
        entry.saved = entry.seen
        self._journal.append([_record(kind, code, entry)])
        self._lines += 1

    def _restore(self, records: list[dict[str, Any]]) -> None:
        latest: dict[tuple[KeyKind, bytes], _Entry] = {}
        for record in records:
            parsed = _parse(record)
            if parsed is not None:
                kind, code, entry = parsed
                known = latest.get((kind, code))
                if known is None or entry.seen >= known.seen:
                    latest[(kind, code)] = entry
        now = self._clock()
        for (kind, code), entry in sorted(latest.items(), key=lambda item: item[1].seen):
            if entry.seen >= now - IDLE[kind]:
                self._tables[kind][code] = entry
        for table in self._tables.values():
            while len(table) > self._max:
                table.popitem(last=False)

    def _compact(self) -> None:
        self._journal.rewrite(
            _record(kind, code, entry)
            for kind, table in self._tables.items()
            for code, entry in table.items()
        )
        self._lines = len(self)


def _record(kind: KeyKind, code: bytes, entry: _Entry) -> dict[str, Any]:
    return {"kind": kind, "digest": code.hex(), "track": entry.track_id, "seen": entry.seen}


def _parse(record: dict[str, Any]) -> tuple[KeyKind, bytes, _Entry] | None:
    kind, code, track, seen = (record.get(k) for k in ("kind", "digest", "track", "seen"))
    if (
        not isinstance(kind, str)
        or kind not in IDLE
        or not isinstance(code, str)
        or _DIGEST_HEX.fullmatch(code) is None
        or not isinstance(track, str)
        or _TRACK_ID.fullmatch(track) is None
        or not isinstance(seen, int | float)
        or isinstance(seen, bool)
    ):
        return None
    known: KeyKind = kind
    return known, bytes.fromhex(code), _Entry(track, float(seen), float(seen))
