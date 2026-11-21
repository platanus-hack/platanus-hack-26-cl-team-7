"""R1 contract exits: too many requests outside the route list in a short window."""

from __future__ import annotations

from typing import Final

from engine.config import Thresholds
from engine.models import Request, RuleHit, RuleId
from engine.routes import RouteMatch
from engine.session import Session


class ContractExitsRule:
    rule_id: Final[RuleId] = "R1"

    def __init__(self, thresholds: Thresholds) -> None:
        self.min_exits = thresholds.r1_min_exits
        self.window = thresholds.r1_window

    def evaluate(self, session: Session, req: Request, match: RouteMatch | None) -> RuleHit | None:
        # The window ends at the newest ts seen, not at req.ts: under load Caddy writes lines a
        # few ms out of order, and an earlier line with a later ts must still count.
        exits = session.count_exits(session.last_ts, self.window)
        if exits < self.min_exits:
            return None
        reason = f"{exits} requests outside the route list within {self.window:g} s"
        return RuleHit(rule=self.rule_id, reason=reason)
