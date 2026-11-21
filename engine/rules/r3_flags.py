"""R3 critical flag: one request for a sensitive file or with a known attack payload."""

from __future__ import annotations

from typing import Final
from urllib.parse import unquote, unquote_plus

from engine.config import Thresholds
from engine.models import Request, RuleHit, RuleId
from engine.routes import RouteMatch
from engine.session import Session
from engine.signatures import match_payload, match_sensitive

MAX_DECODE_ROUNDS = 3


class CriticalFlagRule:
    rule_id: Final[RuleId] = "R3"

    def __init__(self, thresholds: Thresholds) -> None:
        self.enabled = thresholds.r3_enabled

    def evaluate(self, session: Session, req: Request, match: RouteMatch | None) -> RuleHit | None:
        if not self.enabled:
            return None
        signature = flag(req.path, req.query)
        if signature is None:
            return None
        return RuleHit(rule=self.rule_id, reason=f"critical flag: {signature}", critical=True)


def flag(path: str, query: str) -> str | None:
    """Name of the first signature the request matches, or None."""
    decoded_path = decode(path, plus_is_space=False)
    found = match_sensitive(decoded_path) or match_payload(decoded_path)
    if found is not None or not query:
        return found
    return match_payload(decode(query, plus_is_space=True))


def decode(text: str, *, plus_is_space: bool) -> str:
    """Percent-decode up to MAX_DECODE_ROUNDS times, then lowercase.

    A "+" means a space only in the first round of a query string; a "+" that comes from
    a decoded %2B stays a plus sign.
    """
    current = unquote_plus(text) if plus_is_space else unquote(text)
    for _ in range(MAX_DECODE_ROUNDS - 1):
        decoded = unquote(current)
        if decoded == current:
            break
        current = decoded
    return current.lower()
