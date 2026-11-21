"""Runs the three rules over each request and emits at most one verdict per session and rule."""

from __future__ import annotations

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
        self._fired: set[tuple[str, RuleId]] = set()
        self._next_expiry = float("-inf")

    def process(self, req: Request) -> list[Verdict]:
        self._expire_idle(req.ts)
        match = self.routes.match(req.method, req.path)
        session = self.sessions.get_or_create(req)
        session.add(req, match)
        verdicts: list[Verdict] = []
        for rule in self.rules:
            key = (session.id, rule.rule_id)
            if key in self._fired:
                continue
            hit = rule.evaluate(session, req, match)
            if hit is not None:
                self._fired.add(key)
                verdicts.append(_verdict(session, req, hit))
        return verdicts

    def _expire_idle(self, now: float) -> None:
        if now < self._next_expiry:
            return
        self.sessions.expire(now)
        self._next_expiry = now + self.thresholds.idle_timeout


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
