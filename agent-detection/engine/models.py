"""Shared data types for the engine. Every module imports these; keep them stable."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

Label = Literal["human", "probing", "probing_ai"]
RuleId = Literal["R1", "R2", "R3"]


@dataclass(frozen=True, slots=True)
class Request:
    """One access-log entry, reduced to what the rules need."""

    ts: float  # Unix seconds, sub-second precision when the log has it
    ip: str
    user_agent: str
    method: str
    path: str  # raw path, no query string
    query: str  # raw query string without the leading "?", "" when absent

    @property
    def session_id(self) -> str:
        """Version 0 session key: IP + User-Agent."""
        return session_key(self.ip, self.user_agent)


def session_key(ip: str, user_agent: str) -> str:
    return f"{ip}|{user_agent}"


@dataclass(frozen=True, slots=True)
class RuleHit:
    """What a rule returns when it fires."""

    rule: RuleId
    reason: str
    critical: bool = False


@dataclass(frozen=True, slots=True)
class Verdict:
    """What the engine posts to the dashboard webhook."""

    session_id: str
    ip: str
    user_agent: str
    rule: RuleId
    reason: str
    critical: bool
    ts: float  # timestamp of the request that triggered the verdict
    request_count: int  # requests seen in the session up to and including the trigger
    verdict: Literal["probing"] = "probing"
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
