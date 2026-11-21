"""mirror.contracts: typed deception events and their camelCase wire form.

The wire form must match packages/contracts (zod). Both suites read the same fixture,
packages/contracts/test/fixtures/deception-batch.json: this file checks that Python writes
exactly it, and packages/contracts/test/deception.test.ts checks that zod accepts exactly it.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pytest

from mirror import contracts as c
from mirror.contracts import (
    FindingConfirmed,
    TrackAction,
    TrackKey,
    TrackLinked,
    TrackOpened,
    event_id,
    from_wire,
    to_wire,
)

REPO_ROOT = Path(__file__).resolve().parents[2]  # the monorepo root, above agent-detection/
FIXTURE = REPO_ROOT / "packages/contracts/test/fixtures/deception-batch.json"
TRACK = "trk_0123456789abcdef"
REQUEST = "5f0c7c1e-3b9a-4d21-9a43-7c2b1e9f0a11"
TS = 1_763_700_000_000
TWIN = hashlib.sha256(b"twin-session-4821").hexdigest()
UA = "python-httpx/0.27.0"
LIMITS = {
    "batch": c.MAX_BATCH,
    "body": c.MAX_BODY,
    "text": c.MAX_TEXT,
    "uri": c.MAX_URI,
    "method": c.MAX_METHOD,
    "keyValue": c.MAX_KEY_VALUE,
    "keys": c.MAX_KEYS,
}

OPENED = TrackOpened(
    event_id=event_id("track.opened", REQUEST),
    track_id=TRACK,
    ts=TS,
    ip="203.0.113.7",
    user_agent=UA,
    rule="R3",
    reason="critical flag: sql injection in query",
    keys=(TrackKey("ip_ua", f"203.0.113.7|{UA}"), TrackKey("ip", "203.0.113.7")),
)
LINKED = TrackLinked(
    event_id=event_id("track.linked", REQUEST, "twin_born-0"),
    track_id=TRACK,
    ts=TS + 1,
    key=TrackKey("twin_born", TWIN),
)
ACTION = TrackAction(
    event_id=event_id("track.action", REQUEST),
    track_id=TRACK,
    ts=TS + 2,
    method="POST",
    path="/login",
    query="next=%2Faccount",
    status=401,
    duration_ms=12,
    request_body="username=admin'--&pw=guess",
    response_body="<p>Wrong user name or password — try again \U0001f512</p>",
)
FINDING = FindingConfirmed(
    event_id=event_id("finding.confirmed", REQUEST, "auth_flip"),
    track_id=TRACK,
    ts=TS + 3,
    finding_id="fnd_fedcba9876543210",
    kind="auth_flip",
    endpoint="POST /login",
    evidence="401 for this track, then 200 with signature 'sql comment'",
)
IPV6_TRACK = dataclasses.replace(
    OPENED,
    event_id=event_id("track.opened", "req-2"),
    ip="2001:db8::7",
    user_agent="",
    keys=(TrackKey("ip", "2001:db8::7"),),
)
SAMPLES = (OPENED, LINKED, ACTION, FINDING, IPV6_TRACK)


def fixture_document() -> dict[str, Any]:
    return {"limits": LIMITS, "batch": [to_wire(event) for event in SAMPLES]}


def test_python_writes_exactly_the_shared_fixture() -> None:
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == fixture_document()


def test_wire_names_are_camel_case_with_type_first() -> None:
    wire = to_wire(ACTION)
    assert list(wire) == [
        "type",
        "eventId",
        "trackId",
        "ts",
        "method",
        "path",
        "query",
        "status",
        "durationMs",
        "requestBody",
        "responseBody",
    ]
    assert to_wire(OPENED)["keys"] == [
        {"kind": "ip_ua", "value": f"203.0.113.7|{UA}"},
        {"kind": "ip", "value": "203.0.113.7"},
    ]
    assert to_wire(LINKED)["key"] == {"kind": "twin_born", "value": TWIN}


@pytest.mark.parametrize("event", SAMPLES, ids=lambda e: e.TYPE)
def test_wire_round_trip_through_json(event: c.DeceptionEvent) -> None:
    assert from_wire(json.loads(json.dumps(to_wire(event)))) == event


def test_from_wire_refuses_unknown_type_and_wrong_field_sets() -> None:
    wire = to_wire(ACTION)
    with pytest.raises(ValueError, match="unknown event type"):
        from_wire({**wire, "type": "track.closed"})
    with pytest.raises(ValueError, match="exactly the fields"):
        from_wire({**wire, "lane": "mirror"})
    with pytest.raises(ValueError, match="exactly the fields"):
        from_wire({k: v for k, v in wire.items() if k != "durationMs"})
    with pytest.raises(ValueError, match="exactly the fields kind and value"):
        from_wire({**to_wire(LINKED), "key": {"kind": "ip", "value": "203.0.113.7", "x": 1}})
    with pytest.raises(ValueError, match="bad keys"):
        from_wire({**to_wire(OPENED), "keys": ["203.0.113.7"]})


def test_event_id_format_and_stability() -> None:
    assert event_id("track.action", REQUEST) == f"track.action:{REQUEST}"
    assert event_id("finding.confirmed", "r1", "canary_read") == "finding.confirmed:r1:canary_read"
    assert event_id("track.action", "r1") == event_id("track.action", "r1")
    for bad_request, part in (("", ""), ("a b", ""), ("x" * 129, ""), ("r1", "a:b")):
        with pytest.raises(ValueError, match="bad request id"):
            event_id("track.action", bad_request, part)


def test_new_ids_have_the_prefix_and_differ() -> None:
    tracks = {c.new_track_id() for _ in range(50)}
    assert len(tracks) == 50
    assert all(re.fullmatch(r"trk_[0-9a-f]{16}", track) for track in tracks)
    assert re.fullmatch(r"fnd_[0-9a-f]{16}", c.new_finding_id())


@pytest.mark.parametrize(
    ("event", "changes", "field"),
    [
        (ACTION, {"event_id": "track.opened:" + REQUEST}, "names another type"),
        (ACTION, {"event_id": "track.action"}, "eventId"),
        (ACTION, {"track_id": "trk_XYZ"}, "trackId"),
        (ACTION, {"ts": 0}, "ts"),
        (ACTION, {"ts": True}, "ts"),
        (ACTION, {"status": 99}, "status"),
        (ACTION, {"status": 600}, "status"),
        (ACTION, {"duration_ms": -1}, "durationMs"),
        (ACTION, {"method": ""}, "method"),
        (ACTION, {"path": "/" * (c.MAX_URI + 1)}, "path"),
        (ACTION, {"request_body": "a" * (c.MAX_BODY + 1)}, "requestBody"),
        (OPENED, {"ip": "203.0.113.999"}, "ip"),
        (OPENED, {"ip": "fe80::1%en0"}, "ip"),
        (OPENED, {"rule": "R9"}, "rule"),
        (OPENED, {"reason": ""}, "reason"),
        (OPENED, {"keys": ()}, "keys"),
        (OPENED, {"keys": (TrackKey("ip", "203.0.113.7"),) * (c.MAX_KEYS + 1)}, "keys"),
        (LINKED, {"key": "ip"}, "key"),
        (FINDING, {"finding_id": "trk_fedcba9876543210"}, "findingId"),
        (FINDING, {"kind": "canary"}, "kind"),
        (FINDING, {"evidence": ""}, "evidence"),
    ],
)
def test_events_refuse_values_zod_would_refuse(
    event: c.DeceptionEvent, changes: dict[str, Any], field: str
) -> None:
    with pytest.raises(ValueError, match=field):
        dataclasses.replace(event, **changes)


@pytest.mark.parametrize(
    ("kind", "value"),
    [("ip", "not-an-ip"), ("ip_ua", ""), ("twin_born", "raw-cookie-value"), ("lane", "x")],
)
def test_track_keys_check_their_value(kind: Any, value: str) -> None:
    with pytest.raises(ValueError, match="track key value"):
        TrackKey(kind, value)


def test_string_limits_count_code_points_like_zod() -> None:
    lock = "\U0001f512"  # one code point, two UTF-16 units: zod 4.6 counts it once, like len()
    fits = dataclasses.replace(ACTION, response_body=lock * c.MAX_BODY)
    assert len(fits.response_body) == c.MAX_BODY
    with pytest.raises(ValueError, match="responseBody"):
        dataclasses.replace(ACTION, response_body="a" + lock * c.MAX_BODY)
