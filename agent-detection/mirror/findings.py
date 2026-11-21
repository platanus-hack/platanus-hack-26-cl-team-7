"""The finding rules the tap runs on every mirror-lane exchange.

canary_read        the twin's answer holds a canary from run/canaries.json: a private value only
                   the twin holds (the admin's masked email, a masked ship-to address);
auth_flip          an endpoint answered this track 401, and now answers 2xx, or 3xx as the login
                   form's redirect, to a request with an attack signature;
signature_success  a request with an attack signature gets 2xx with a body larger than the twin's
                   404 page.

The attack signature is engine.rules.r3_flags.flag() on the path and query, else on the body as
form text (flag_form), the same tests R3 uses. Each rule gives one finding.confirmed per (track,
kind, endpoint, signature). A finding with a signature in the URI starts a virtual patch on its
endpoint and signature: the lane endpoint sees only the URI, so that is all a patch can match.
A signature only in the body starts none, since the real lane never sends a body but a login
POST's, and mirror.logins checks every login body for every signature anyway. One without any
signature (a canary read through an ordinary request) starts none: a whole-endpoint patch would
mirror every real user of that endpoint.
"""

from __future__ import annotations

import http.client
import logging
import secrets
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from http import HTTPStatus
from pathlib import Path

from engine.models import RuleId
from engine.routes import RouteTable
from engine.rules.r3_flags import flag, flag_form
from mirror.canaries import Canaries
from mirror.contracts import (
    MAX_BODY,
    MAX_TEXT,
    MAX_URI,
    FindingConfirmed,
    FindingKind,
    event_id,
    new_finding_id,
)
from mirror.exchange import Exchange
from mirror.lane import Emit
from mirror.patches import Patch, PatchBook, endpoint_of
from mirror.sockets import UnixHTTPConnection

AUTH_SUCCESS = range(200, 400)
SIGNATURE_SUCCESS = range(200, 300)
PATCH_RULE: RuleId = "R3"  # every signature is an R3 signature
MAX_TRACKS = 10_000  # tracks whose 401 endpoints are remembered
MAX_REFUSED = 64  # 401 endpoints remembered per track
MAX_SEEN = 10_000  # findings remembered for the one-finding-per-signature rule
PROBE_TIMEOUT = 2.0
PROBE_BYTES = 8  # random bytes in the path of the 404 probe

log = logging.getLogger(__name__)


class NotFoundSize:
    """The body size of the twin's 404 page, asked once of the twin (again after a failure)."""

    def __init__(self, twin: Path) -> None:
        self._twin, self._size = twin, -1

    def __call__(self) -> int | None:
        if self._size < 0:
            connection = UnixHTTPConnection(self._twin, PROBE_TIMEOUT)
            try:
                connection.request("GET", f"/{secrets.token_hex(PROBE_BYTES)}")
                answer = connection.getresponse()
                body = answer.read()
                if answer.status == HTTPStatus.NOT_FOUND:
                    self._size = len(body)
            except (OSError, http.client.HTTPException) as err:
                log.warning("404 probe of the twin failed: %s", err)
            finally:
                connection.close()
        return self._size if self._size >= 0 else None


NotFound = Callable[[], "int | None"]  # the twin's 404 body size, None while unknown


class FindingRules:
    """Thread-safe: the tap's handler threads share one."""

    def __init__(
        self,
        canaries: Canaries,
        routes: RouteTable,
        patches: PatchBook,
        emit: Emit,
        not_found_size: NotFound,
    ) -> None:
        self._canaries, self._routes, self._patches, self._emit = canaries, routes, patches, emit
        self._not_found_size = not_found_size
        self._refused: OrderedDict[str, OrderedDict[tuple[str, str], str]] = OrderedDict()
        self._seen: OrderedDict[tuple[str, ...], None] = OrderedDict()
        self._lock = threading.Lock()

    def check(self, ex: Exchange) -> list[FindingConfirmed]:
        """Emit the findings of one exchange and start their patches; returns the findings."""
        endpoint = endpoint_of(self._routes, ex.method, ex.path)
        uri_signature = flag(ex.path, ex.query) or ""
        signature = uri_signature or flag_form(ex.body_form) or ""
        found: list[tuple[FindingKind, str, str]] = []
        canary = self._canaries.find(ex.response_body)
        if canary is not None:
            found.append(
                ("canary_read", canary.kind, f"holds canary {canary.kind} ({canary.where})")
            )
        refused_by = self._remember(ex, endpoint)
        if signature and refused_by and ex.status in AUTH_SUCCESS:
            why = f"answered this track 401 (request {refused_by}), now {ex.status}"
            found.append(("auth_flip", signature, f"{why} with signature '{signature}'"))
        if signature and ex.status in SIGNATURE_SUCCESS:
            baseline = self._not_found_size()
            if baseline is not None and ex.response_size > baseline:
                why = f"with signature '{signature}' got {ex.status}, {ex.response_size} bytes"
                found.append(
                    ("signature_success", signature, f"{why}; the 404 page has {baseline}")
                )
        findings = []
        for kind, mark, evidence in found:
            if self._first((ex.track_id, kind, ex.method, endpoint, mark)):
                findings.append(self._confirm(ex, endpoint, uri_signature, kind, evidence))
        return findings

    def _remember(self, ex: Exchange, endpoint: str) -> str:
        """The request that got this track a 401 on this endpoint ("" if none); records a 401."""
        place = (ex.method, endpoint)
        with self._lock:
            refused = self._refused.get(ex.track_id)
            if ex.status == HTTPStatus.UNAUTHORIZED:
                if refused is None:
                    refused = self._refused[ex.track_id] = OrderedDict()
                refused.setdefault(place, ex.request_id)
                _trim(refused, MAX_REFUSED)
                self._refused.move_to_end(ex.track_id)
                _trim(self._refused, MAX_TRACKS)
            return "" if refused is None else refused.get(place, "")

    def _first(self, mark: tuple[str, ...]) -> bool:
        with self._lock:
            if mark in self._seen:
                return False
            self._seen[mark] = None
            _trim(self._seen, MAX_SEEN)
            return True

    def _confirm(
        self, ex: Exchange, endpoint: str, uri_signature: str, kind: FindingKind, evidence: str
    ) -> FindingConfirmed:
        finding = FindingConfirmed(
            event_id=event_id("finding.confirmed", ex.request_id, kind),
            track_id=ex.track_id,
            ts=int(time.time() * 1000),
            finding_id=new_finding_id(),
            kind=kind,
            endpoint=f"{ex.method} {endpoint}"[:MAX_URI],
            evidence=f"{ex.method} {endpoint} {evidence}. Request: {_request(ex)}"[:MAX_BODY],
        )
        self._emit(finding)
        if uri_signature:
            try:
                patch = Patch(finding.finding_id, ex.method, endpoint, uri_signature, PATCH_RULE)
            except ValueError as err:  # an endpoint off the route list longer than a URI
                log.warning("finding %s: no virtual patch: %s", finding.finding_id, err)
            else:
                self._patches.add(patch)
        return finding


def _request(ex: Exchange) -> str:
    target = f"{ex.path}?{ex.query}" if ex.query else ex.path
    body = ex.request_body[:MAX_TEXT].decode("utf-8", "replace")
    return f"{ex.method} {target[:MAX_TEXT]}" + (f" body {body}" if body else "")


def _trim[K, V](table: OrderedDict[K, V], limit: int) -> None:
    while len(table) > limit:
        table.popitem(last=False)
