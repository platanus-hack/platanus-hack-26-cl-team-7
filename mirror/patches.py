"""Virtual patches: after a confirmed finding, every request that matches the finding's signature
goes to the mirror lane, from any client, so the flaw stays shut while a human fixes it.

A patch names a method, an endpoint (the RouteTable pattern, or the raw path for a request off the
route list) and an R3 signature name from engine.signatures; an empty signature covers every
request to the endpoint (a canary read through an ordinary route has no attack signature). The
signature is engine.rules.r3_flags.flag(), the same test R3 uses, and it only runs for a request
to a patched endpoint. Patches persist as JSONL, one line each, and reload on restart. Reads take
no lock: add() swaps in a new index, so a reader sees the old one or the new one, never half.
"""

from __future__ import annotations

import re
import threading
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import get_args

from engine.models import RuleId
from engine.routes import RouteTable
from engine.rules.r3_flags import flag
from engine.signatures import PAYLOAD_PATTERNS, SENSITIVE_PATHS
from mirror.contracts import FINDING_PREFIX, ID_HEX, MAX_METHOD, MAX_URI
from mirror.journal import Journal

MAX_PATCHES = 1000
ANY_SIGNATURE = ""
SIGNATURES = frozenset(name for name, _ in (*SENSITIVE_PATHS, *PAYLOAD_PATTERNS))

_FINDING_ID = re.compile(rf"{FINDING_PREFIX}[0-9a-f]{{{ID_HEX}}}")

Index = dict[tuple[str, str], dict[str, "Patch"]]


@dataclass(frozen=True, slots=True)
class Patch:
    finding_id: str
    method: str
    endpoint: str
    signature: str  # an R3 signature name, or ANY_SIGNATURE for the whole endpoint
    rule: RuleId  # rule of the track the finding came from; a track this patch opens reports it

    def __post_init__(self) -> None:
        if _FINDING_ID.fullmatch(self.finding_id) is None:
            raise ValueError(f"bad patch finding id {self.finding_id!r:.80}")
        if not 0 < len(self.method) <= MAX_METHOD or not 0 < len(self.endpoint) <= MAX_URI:
            raise ValueError(f"bad patch endpoint {self.method!r:.20} {self.endpoint!r:.80}")
        if self.signature != ANY_SIGNATURE and self.signature not in SIGNATURES:
            raise ValueError(f"unknown patch signature {self.signature!r:.80}")
        if self.rule not in get_args(RuleId):
            raise ValueError(f"bad patch rule {self.rule!r:.20}")


def endpoint_of(routes: RouteTable, method: str, path: str) -> str:
    """The endpoint a patch names for (method, path): its route pattern, else the raw path."""
    match = routes.match(method, path)
    return path if match is None else match.pattern


class PatchBook:
    def __init__(self, journal: Journal, routes: RouteTable) -> None:
        self._journal = journal
        self._routes = routes
        self._index: Index = {}
        self._count = 0
        self._lock = threading.Lock()

    @classmethod
    def load(cls, path: str | Path, routes: RouteTable) -> PatchBook:
        book = cls(Journal(path), routes)
        for record in book._journal.read():
            try:
                patch = Patch(**record)
            except (TypeError, ValueError):
                continue
            book._insert(patch)
        return book

    def add(self, patch: Patch) -> bool:
        """Record a patch; False when one with the same signature exists or the book is full."""
        with self._lock:
            if not self._insert(patch):
                return False
            self._journal.append([asdict(patch)])
            return True

    def match(self, method: str, path: str, query: str) -> Patch | None:
        """The patch this request falls under. `query` is the raw query string, or for the tap a
        form-encoded body (the same encoding, so the same signatures apply)."""
        index = self._index
        if not index:
            return None
        bucket = index.get((method, endpoint_of(self._routes, method, path)))
        if bucket is None:
            return None
        whole = bucket.get(ANY_SIGNATURE)
        if whole is not None:
            return whole
        signature = flag(path, query)
        return None if signature is None else bucket.get(signature)

    def __len__(self) -> int:
        return self._count

    def close(self) -> None:
        self._journal.close()

    def _insert(self, patch: Patch) -> bool:
        place = (patch.method, patch.endpoint)
        bucket = self._index.get(place, {})
        if self._count >= MAX_PATCHES or patch.signature in bucket:
            return False
        self._index = {**self._index, place: {**bucket, patch.signature: patch}}
        self._count += 1
        return True
