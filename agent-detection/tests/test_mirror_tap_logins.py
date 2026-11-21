"""mirror.logins: when a real-lane login POST moves to the mirror lane (twin-born username, or a
body a virtual patch covers) and when it stays real."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from email.message import Message
from pathlib import Path

import pytest

from engine.config import load_thresholds
from engine.detector import Detector
from engine.routes import RouteTable
from mirror.contracts import DeceptionEvent, TrackKey, TrackLinked, TrackOpened
from mirror.forwarded import Forwarded
from mirror.keys import KeyTable, twin_born_key
from mirror.lane import LaneRouter
from mirror.logins import Logins
from mirror.patches import Patch, PatchBook

REPO = Path(__file__).resolve().parent.parent
IP, UA = "198.51.100.9", "Mozilla/5.0 (X11; Linux x86_64)"
TRACK = "trk_0123456789abcdef"
PATCH = Patch("fnd_00000000000000a1", "POST", "/login", "sql tautology", "R3")
FORM = "application/x-www-form-urlencoded"


@dataclass
class Harness:
    logins: Logins
    lane: LaneRouter
    keys: KeyTable
    patches: PatchBook
    events: list[DeceptionEvent] = field(default_factory=list)
    copies: list[str] = field(default_factory=list)

    def route(self, body: bytes, path: str = "/login", method: str = "POST", **extra: str) -> str:
        values = {"X-Client-Ip": IP, "User-Agent": UA, "Content-Type": FORM} | extra
        headers: Message[str, str] = Message()
        for name, value in values.items():
            if value:
                headers[name] = value
        return self.logins.track_of(method, path, headers, body, "req-9")


@pytest.fixture
def harness(tmp_path: Path) -> Harness:
    routes = RouteTable.from_yaml(REPO / "config" / "routes.yaml")
    detector = Detector(routes, load_thresholds(REPO / "config" / "rules.yaml"))
    keys = KeyTable.load(tmp_path / "keys.jsonl")
    patches = PatchBook.load(tmp_path / "patches.jsonl", routes)
    events: list[DeceptionEvent] = []
    copies: list[str] = []
    lane = LaneRouter(detector, keys, patches, events.append, copies.append)
    return Harness(Logins(lane, patches), lane, keys, patches, events, copies)


def bind_twin_born(harness: Harness, value: str) -> None:
    key = twin_born_key(value)
    assert key is not None
    harness.keys.bind(key, TRACK)


def test_an_ordinary_login_stays_real_and_leaves_no_trace(harness: Harness) -> None:
    assert harness.route(b"username=maria.perez&password=secret-1") == ""
    assert harness.events == [] and harness.copies == [] and len(harness.keys) == 0


@pytest.mark.parametrize(
    ("method", "path"), [("GET", "/login"), ("POST", "/account"), ("POST", "/login/extra")]
)
def test_only_a_login_post_is_read(harness: Harness, method: str, path: str) -> None:
    bind_twin_born(harness, "leo.espinoza68")
    assert harness.route(b"username=leo.espinoza68", path, method) == ""


@pytest.mark.parametrize("path", ["/login", "/login/", "/api/session", "/api/session/"])
def test_a_twin_born_username_follows_its_track_from_any_ip(harness: Harness, path: str) -> None:
    bind_twin_born(harness, "leo.espinoza68")
    assert harness.route(b"username=leo.espinoza68&password=x", path) == TRACK
    [linked] = harness.events
    assert isinstance(linked, TrackLinked)
    assert (linked.event_id, linked.track_id) == ("track.linked:req-9:ip_ua", TRACK)
    assert linked.key == TrackKey("ip_ua", f"{IP}|{UA}")


def test_a_json_login_with_a_twin_born_email_follows_too(harness: Harness) -> None:
    bind_twin_born(harness, "leo.espinoza68@yahoo.com")
    body = json.dumps({"username": "leo.espinoza68@yahoo.com", "password": "x"}).encode()
    assert harness.route(body, "/api/session", **{"Content-Type": "application/json"}) == TRACK


def test_a_login_from_a_client_already_on_a_track_stays_on_it(harness: Harness) -> None:
    harness.keys.bind(TrackKey("ip_ua", f"{IP}|{UA}"), TRACK)
    assert harness.route(b"username=anyone&password=x") == TRACK
    assert harness.events == []  # its key was already bound


def test_a_login_body_a_virtual_patch_covers_opens_a_track(harness: Harness) -> None:
    harness.patches.add(PATCH)
    cookie = "session=real-session-77"
    track = harness.route(b"username=%27+OR+1%3D1+--&password=x", Cookie=cookie)
    assert track.startswith("trk_")
    [opened] = harness.events
    assert isinstance(opened, TrackOpened)
    assert (opened.event_id, opened.track_id, opened.rule) == ("track.opened:req-9", track, "R3")
    assert opened.reason == "virtual patch fnd_00000000000000a1: sql tautology"
    assert opened.keys == (TrackKey("ip_ua", f"{IP}|{UA}"),)
    assert (opened.ip, opened.user_agent) == (IP, UA)
    assert harness.copies == [cookie]
    assert harness.route(b"username=bob&password=pw") == track  # the client stays on it


def test_a_whole_endpoint_patch_names_the_endpoint(harness: Harness) -> None:
    harness.patches.add(Patch("fnd_00000000000000a2", "POST", "/api/session", "", "R3"))
    assert harness.route(b"username=x&password=y", "/api/session")
    [opened] = harness.events
    assert isinstance(opened, TrackOpened)
    assert opened.reason == "virtual patch fnd_00000000000000a2: POST /api/session"
    assert harness.copies == []


def test_a_login_without_a_client_ip_stays_real(harness: Harness) -> None:
    harness.patches.add(PATCH)
    assert harness.route(b"username=%27+OR+1%3D1+--", **{"X-Client-Ip": ""}) == ""
    assert harness.events == []


def test_a_key_bound_while_the_track_opened_is_followed(harness: Harness) -> None:
    fwd = Forwarded("req-9", "POST", "/login", "", IP, UA, cookie="session=real-session-77")
    harness.keys.bind(fwd.ip_ua_key, TRACK)
    assert harness.lane.open(fwd, ("R3", "virtual patch"), [fwd.ip_ua_key]).track_id == TRACK
    assert harness.events == [] and harness.copies == []


def test_a_bearer_login_copies_its_token(harness: Harness) -> None:
    harness.patches.add(PATCH)
    track = harness.route(b"username=%27+OR+1%3D1+--", Authorization="Bearer tok-real-55")
    assert track.startswith("trk_") and harness.copies == ["tok-real-55"]
