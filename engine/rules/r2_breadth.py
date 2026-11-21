"""R2 endpoint breadth: too many distinct endpoints in a short window."""

from __future__ import annotations

from typing import Final

from engine.config import Thresholds
from engine.models import Request, RuleHit, RuleId
from engine.routes import RouteMatch
from engine.session import Session


class EndpointBreadthRule:
    rule_id: Final[RuleId] = "R2"

    def __init__(self, thresholds: Thresholds) -> None:
        self.max_endpoints = thresholds.r2_max_endpoints
        self.window = thresholds.r2_window

    def evaluate(self, session: Session, req: Request, match: RouteMatch | None) -> RuleHit | None:
        # The window ends at the newest ts seen, not at req.ts: under load Caddy writes lines a
        # few ms out of order, and an earlier line with a later ts must still count.
        endpoints = session.count_endpoints(session.last_ts, self.window)
        if endpoints <= self.max_endpoints:
            return None
        reason = f"{endpoints} distinct endpoints within {self.window:g} s"
        return RuleHit(rule=self.rule_id, reason=reason)
