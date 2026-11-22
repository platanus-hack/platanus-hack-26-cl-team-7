"""Deception events the router posts to Sentinel (POST /v1/deception/events), as typed values.

Mirrors DeceptionEvent in packages/contracts/src/deception.ts: snake_case here, camelCase on
the wire.
Both test suites parse packages/contracts/test/fixtures/deception-batch.json, so the two sides
agree on names and limits. Events validate when built: a bad one fails here, not at Sentinel."""

from __future__ import annotations

import ipaddress
import re
import secrets
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field, fields
from typing import Any, ClassVar, Literal, TypeGuard, get_args

from engine.models import RuleId

Lane = Literal["real", "mirror"]
EventType = Literal["track.opened", "track.linked", "track.action", "finding.confirmed"]
KeyKind = Literal["ip", "ip_ua", "twin_born"]
FindingKind = Literal["canary_read", "auth_flip", "signature_success"]

MAX_BATCH = 500
MAX_BODY = 8192  # string limits count code points (len), as zod 4.6's .max() does
MAX_TEXT = 512
MAX_URI = 2048
MAX_METHOD = 16
MAX_KEY_VALUE = 1024
MAX_KEYS = 16
ID_HEX = 16
TRACK_PREFIX = "trk_"
FINDING_PREFIX = "fnd_"
STATUS_RANGE = range(100, 600)

_TRACK_ID = re.compile(rf"{TRACK_PREFIX}[0-9a-f]{{{ID_HEX}}}")
_FINDING_ID = re.compile(rf"{FINDING_PREFIX}[0-9a-f]{{{ID_HEX}}}")
_EVENT_ID = re.compile(r"(?P<type>[a-z.]+):[A-Za-z0-9._-]{1,128}(?::[A-Za-z0-9._-]{1,64})?")
_DIGEST = re.compile(r"[0-9a-f]{64}")

Check = Callable[[object], bool]


def new_track_id() -> str:
    return TRACK_PREFIX + secrets.token_hex(ID_HEX // 2)


def new_finding_id() -> str:
    return FINDING_PREFIX + secrets.token_hex(ID_HEX // 2)


def event_id(event_type: EventType, request_id: str, part: str = "") -> str:
    """The id "<type>:<requestId>", stable across retries. `part` tells apart two events of one
    type from one request (two keys linked, two findings): "<type>:<requestId>:<part>"."""
    value = f"{event_type}:{request_id}:{part}" if part else f"{event_type}:{request_id}"
    if _EVENT_ID.fullmatch(value) is None:
        raise ValueError(f"bad request id or part in {value!r}")
    return value


def _is_int(value: object) -> TypeGuard[int]:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_ip(value: object) -> bool:
    try:  # zod refuses IPv6 zone ids ("fe80::1%en0"); ipaddress takes them
        return isinstance(value, str) and "%" not in value and bool(ipaddress.ip_address(value))
    except ValueError:
        return False


def _text(limit: int, *, empty: bool = False) -> Check:
    return lambda v: isinstance(v, str) and (empty or v != "") and len(v) <= limit


def _matches(pattern: re.Pattern[str]) -> Check:
    return lambda v: isinstance(v, str) and pattern.fullmatch(v) is not None


def _spec(check: Check) -> Any:
    return field(metadata={"check": check})


# A twin_born value is the sha256 hex of the token, cookie, username or email the twin gave out.
_KEY_VALUE = {"ip": _is_ip, "ip_ua": _text(MAX_KEY_VALUE), "twin_born": _matches(_DIGEST)}


def _key_tuple(v: object) -> bool:
    return isinstance(v, tuple) and 0 < len(v) <= MAX_KEYS and all(type(k) is TrackKey for k in v)


@dataclass(frozen=True, slots=True)
class TrackKey:
    kind: KeyKind
    value: str

    def __post_init__(self) -> None:
        check = _KEY_VALUE.get(self.kind)
        if check is None or not check(self.value):
            raise ValueError(f"bad {self.kind!r} track key value {self.value!r:.80}")


@dataclass(frozen=True, slots=True)
class _Event:
    """Fields every event carries. Subclasses add theirs; each field names its own check."""

    TYPE: ClassVar[EventType]
    event_id: str = _spec(_matches(_EVENT_ID))
    track_id: str = _spec(_matches(_TRACK_ID))
    ts: int = _spec(lambda v: _is_int(v) and v > 0)  # Unix milliseconds

    def __post_init__(self) -> None:
        for spec in fields(self):
            value = getattr(self, spec.name)
            if not spec.metadata["check"](value):
                raise ValueError(f"{self.TYPE}: bad {_camel(spec.name)} {value!r:.80}")
        if self.event_id.partition(":")[0] != self.TYPE:
            raise ValueError(f"{self.TYPE}: eventId {self.event_id!r} names another type")


@dataclass(frozen=True, slots=True)
class TrackOpened(_Event):
    TYPE: ClassVar[EventType] = "track.opened"
    ip: str = _spec(_is_ip)
    user_agent: str = _spec(_text(MAX_TEXT, empty=True))
    rule: RuleId = _spec(lambda v: v in get_args(RuleId))
    reason: str = _spec(_text(MAX_TEXT))
    keys: tuple[TrackKey, ...] = _spec(_key_tuple)


@dataclass(frozen=True, slots=True)
class TrackLinked(_Event):
    TYPE: ClassVar[EventType] = "track.linked"
    key: TrackKey = _spec(lambda v: isinstance(v, TrackKey))


@dataclass(frozen=True, slots=True)
class TrackAction(_Event):
    TYPE: ClassVar[EventType] = "track.action"
    method: str = _spec(_text(MAX_METHOD))
    path: str = _spec(_text(MAX_URI))
    query: str = _spec(_text(MAX_URI, empty=True))
    status: int = _spec(lambda v: _is_int(v) and v in STATUS_RANGE)
    duration_ms: int = _spec(lambda v: _is_int(v) and v >= 0)
    request_body: str = _spec(_text(MAX_BODY, empty=True))
    response_body: str = _spec(_text(MAX_BODY, empty=True))


@dataclass(frozen=True, slots=True)
class FindingConfirmed(_Event):
    TYPE: ClassVar[EventType] = "finding.confirmed"
    finding_id: str = _spec(_matches(_FINDING_ID))
    kind: FindingKind = _spec(lambda v: v in get_args(FindingKind))
    endpoint: str = _spec(_text(MAX_URI))
    evidence: str = _spec(_text(MAX_BODY))


DeceptionEvent = TrackOpened | TrackLinked | TrackAction | FindingConfirmed
EVENT_TYPES: dict[str, type[DeceptionEvent]] = {
    cls.TYPE: cls for cls in (TrackOpened, TrackLinked, TrackAction, FindingConfirmed)
}


def to_wire(event: DeceptionEvent) -> dict[str, Any]:
    """The JSON object Sentinel expects: "type", then the camelCase fields in contract order."""
    wire = {_camel(k): list(v) if isinstance(v, tuple) else v for k, v in asdict(event).items()}
    return {"type": event.TYPE, **wire}


def from_wire(data: Mapping[str, Any]) -> DeceptionEvent:
    """Parse one wire object (a spooled event, a fixture). Raises ValueError on any mismatch."""
    cls = EVENT_TYPES.get(str(data.get("type")))
    if cls is None:
        raise ValueError(f"unknown event type {data.get('type')!r:.80}")
    names = {_camel(spec.name): spec.name for spec in fields(cls)}
    if set(data) != {"type", *names}:
        raise ValueError(f"{cls.TYPE} takes exactly the fields {sorted(names)}")
    return cls(**{names[k]: _from_wire_value(v) for k, v in data.items() if k != "type"})


def _from_wire_value(value: object) -> Any:  # checked by the event it builds
    if isinstance(value, dict):
        if set(value) != {"kind", "value"}:
            raise ValueError("a track key takes exactly the fields kind and value")
        return TrackKey(value["kind"], value["value"])
    if isinstance(value, list):
        return tuple(_from_wire_value(item) for item in value)
    return value


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)
