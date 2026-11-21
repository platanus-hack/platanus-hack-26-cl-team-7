"""Runs the three rules over each request and emits at most one verdict per session and rule."""

from __future__ import annotations

import hashlib
from collections.abc import Iterable

from engine.config import Thresholds
from engine.models import Request, RuleHit, RuleId, Verdict
from engine.routes import RouteTable
from engine.rules.r1_exits import ContractExitsRule
from engine.rules.r2_breadth import EndpointBreadthRule
from engine.rules.r3_flags import CriticalFlagRule
from engine.session import Session, SessionStore

Rule = CriticalFlagRule | ContractExitsRule | EndpointBreadthRule


class Detector:
    def __init__(self, routes: RouteTable, thresholds: Thresholds) -> None:
        self.routes = routes
        self.thresholds = thresholds
        self.sessions = SessionStore.for_thresholds(thresholds)
        self.rules: tuple[Rule, ...] = (
            CriticalFlagRule(thresholds),
            ContractExitsRule(thresholds),
            EndpointBreadthRule(thresholds),
        )
        # Fired (session, rule) pairs outlive session expiry ("one verdict ever"), so they are
        # kept as fixed-size digests: a scanner that rotates long User-Agents costs ~16 bytes
        # per verdict here, not the whole UA.
        self._fired: set[bytes] = set()
        self._next_expiry = float("-inf")

    def process(self, req: Request) -> list[Verdict]:
        self._expire_idle(req.ts)
        match = self.routes.match(req.method, req.path)
        session = self.sessions.get_or_create(req)
        session.add(req, match)
        verdicts: list[Verdict] = []
        for rule in self.rules:
            key = fired_key(session.id, rule.rule_id)
            if key in self._fired:
                continue
            hit = rule.evaluate(session, req, match)
            if hit is not None:
                self._fired.add(key)
                verdicts.append(_verdict(session, req, hit))
        return verdicts

    def _expire_idle(self, now: float) -> None:
        """Free idle sessions about once per idle_timeout. SessionStore.get_or_create already
        restarts an idle session, so this sweep only bounds memory."""
        if now < self._next_expiry:
            return
        self.sessions.expire(now)
        self._next_expiry = now + self.thresholds.idle_timeout


def fired_key(session_id: str, rule: RuleId) -> bytes:
    text = f"{rule}|{session_id}".encode("utf-8", "surrogatepass")
    return hashlib.blake2b(text, digest_size=16).digest()


def replay(requests: Iterable[Request], detector: Detector) -> list[Verdict]:
    verdicts: list[Verdict] = []
    for req in requests:
        verdicts.extend(detector.process(req))
    return verdicts


def _verdict(session: Session, req: Request, hit: RuleHit) -> Verdict:
    return Verdict(
        session_id=session.id,
        ip=session.ip,
        user_agent=session.user_agent,
        rule=hit.rule,
        reason=hit.reason,
        critical=hit.critical,
        ts=req.ts,
        request_count=session.request_count,
    )
