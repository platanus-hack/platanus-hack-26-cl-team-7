"""mirror.logins: when a real-lane login POST moves to the mirror lane (twin-born username, or an
attack payload in its body) and when it stays real."""

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
from mirror.patches import PatchBook

REPO = Path(__file__).resolve().parent.parent
IP, UA = "198.51.100.9", "Mozilla/5.0 (X11; Linux x86_64)"
TRACK = "trk_0123456789abcdef"
SQLI = b"username=%27+OR+1%3D1+--&password=x"
REASON = "critical flag: sql tautology (login body)"
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
    return Harness(Logins(lane), lane, keys, patches, events, copies)


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


def test_an_attack_payload_in_the_login_body_opens_a_track(harness: Harness) -> None:
    cookie = "session=real-session-77"
    track = harness.route(SQLI, Cookie=cookie)
    assert track.startswith("trk_")
    [opened] = harness.events
    assert isinstance(opened, TrackOpened)
    assert (opened.event_id, opened.track_id, opened.rule) == ("track.opened:req-9", track, "R3")
    assert opened.reason == REASON
    assert opened.keys == (TrackKey("ip_ua", f"{IP}|{UA}"), TrackKey("ip", IP))  # critical
    assert (opened.ip, opened.user_agent) == (IP, UA)
    assert harness.copies == [cookie]
    assert harness.route(b"username=bob&password=pw") == track  # the client stays on it
    assert len(harness.events) == 1


def test_the_client_stays_on_the_mirror_for_every_request_after_the_login(
    harness: Harness,
) -> None:
    track = harness.route(SQLI)
    products = Forwarded("req-10", "GET", "/products", "", IP, UA)
    assert harness.lane.decide(products).track_id == track
    rotated = Forwarded("req-11", "GET", "/", "", IP, "curl/8.7.1")  # the IP key follows a new UA
    assert harness.lane.decide(rotated).track_id == track


@pytest.mark.parametrize(
    ("body", "path", "kind", "signature"),
    [
        (b"username=admin&password=%27+OR+%271%27%3D%271", "/login", FORM, "sql tautology"),
        (b"username=a&password=1+UNION+SELECT+pw+FROM+users", "/login", FORM, "sql union select"),
        (b"username=%253Cscript%253Ealert(1)%253C/script%253E", "/login", FORM, "xss script tag"),
        (b"username=..%2f..%2f..%2fetc%2fpasswd&password=x", "/login", FORM, "path traversal"),
        (b"username=admin%27--&password=x", "/login/", FORM, "sql comment break"),
        (
            b'{"username": "\' OR 1=1 --", "password": "x"}',
            "/api/session",
            "application/json",
            "sql tautology",
        ),
        (
            b'{"username": "admin", "password": "x\' or \'a\'=\'a"}',
            "/api/session/",
            "application/json",
            "sql tautology",
        ),
    ],
)
def test_every_payload_signature_in_any_form_value_counts(
    harness: Harness, body: bytes, path: str, kind: str, signature: str
) -> None:
    assert harness.route(body, path, **{"Content-Type": kind}).startswith("trk_")
    [opened] = harness.events
    assert isinstance(opened, TrackOpened)
    assert opened.reason == f"critical flag: {signature} (login body)"


@pytest.mark.parametrize(
    "body",
    [
        b"username=o%27brien%40example.com&password=it%27s-my-pass",
        b"username=maria&password=p%40ss%23word%21+and+more",
        b"username=rock%26roll&password=or-and-select-union",
        b"username=ana.perez%40example.org&password=%3Cmy%3E+secret",
        b'{"username": "ana", "password": "a;b|c`d"}',
    ],
)
def test_a_human_login_with_punctuation_stays_real(harness: Harness, body: bytes) -> None:
    assert harness.route(body) == ""
    assert harness.events == [] and harness.copies == []


def test_a_json_login_with_a_payload_but_a_form_content_type_is_still_read(
    harness: Harness,
) -> None:
    body = b'{"username": "\' OR 1=1 --", "password": "x"}'
    assert harness.route(body, "/api/session").startswith("trk_")


def test_a_login_without_a_client_ip_stays_real(harness: Harness) -> None:
    assert harness.route(SQLI, **{"X-Client-Ip": ""}) == ""
    assert harness.events == []


def test_a_key_bound_while_the_track_opened_is_followed(harness: Harness) -> None:
    fwd = Forwarded("req-9", "POST", "/login", "", IP, UA, cookie="session=real-session-77")
    harness.keys.bind(fwd.ip_ua_key, TRACK)
    assert harness.lane.open(fwd, ("R3", "virtual patch"), [fwd.ip_ua_key]).track_id == TRACK
    assert harness.events == [] and harness.copies == []


def test_a_bearer_login_copies_its_token(harness: Harness) -> None:
    track = harness.route(SQLI, Authorization="Bearer tok-real-55")
    assert track.startswith("trk_") and harness.copies == ["tok-real-55"]
