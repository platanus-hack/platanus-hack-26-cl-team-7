"""mirror.lane: the lane decision (keys, verdicts, virtual patches) and its /lane endpoint."""

from __future__ import annotations

import tempfile
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from email.message import Message
from pathlib import Path

import pytest

from engine.config import Thresholds, load_thresholds
from engine.detector import Detector
from engine.models import Request, Verdict
from engine.routes import RouteTable
from mirror.contracts import DeceptionEvent, TrackKey, TrackLinked, TrackOpened
from mirror.forwarded import Forwarded
from mirror.keys import KeyTable, twin_born_key
from mirror.lane import REAL, Decision, LaneRouter, handler_for
from mirror.patches import ANY_SIGNATURE, Patch, PatchBook
from mirror.sockets import UnixHTTPConnection, UnixHTTPServer

REPO = Path(__file__).resolve().parent.parent
IP, OTHER_IP = "203.0.113.7", "198.51.100.9"
UA = "python-httpx/0.27.0"
PATCH = Patch("fnd_00000000000000f1", "GET", "/api/users/{id}", ANY_SIGNATURE, "R3")


@dataclass
class Harness:
    router: LaneRouter
    keys: KeyTable
    patches: PatchBook
    events: list[DeceptionEvent] = field(default_factory=list)
    copies: list[str] = field(default_factory=list)


def build(tmp_path: Path, thresholds: Thresholds | None = None) -> Harness:
    routes = RouteTable.from_yaml(REPO / "config" / "routes.yaml")
    detector = Detector(routes, thresholds or load_thresholds(REPO / "config" / "rules.yaml"))
    keys = KeyTable.load(tmp_path / "keys.jsonl")
    patches = PatchBook.load(tmp_path / "patches.jsonl", routes)
    events: list[DeceptionEvent] = []
    copies: list[str] = []
    router = LaneRouter(detector, keys, patches, events.append, copies.append)
    return Harness(router, keys, patches, events, copies)


@pytest.fixture
def lane(tmp_path: Path) -> Harness:
    return build(tmp_path)


def fwd(path: str = "/", *, n: int = 0, **overrides: str) -> Forwarded:
    target, _, query = path.partition("?")
    fields = {"request_id": f"req-{n}", "method": "GET", "path": target, "query": query}
    fields |= {"ip": IP, "user_agent": UA}
    return Forwarded(**(fields | overrides))


def test_an_ordinary_request_goes_real_with_no_events(lane: Harness) -> None:
    assert lane.router.decide(fwd("/products")) == REAL
    assert lane.events == []
    assert lane.copies == []


def test_a_critical_verdict_opens_a_track_on_ip_ua_and_ip(lane: Harness) -> None:
    decision = lane.router.decide(fwd("/.env", cookie="session=real-cookie-1"))
    assert decision.lane == "mirror"
    assert decision.track_id.startswith("trk_")
    [opened] = lane.events
    assert isinstance(opened, TrackOpened)
    assert (opened.event_id, opened.track_id, opened.rule) == (
        "track.opened:req-0",
        decision.track_id,
        "R3",
    )
    assert opened.reason == "critical flag: dotenv file"
    assert opened.keys == (TrackKey("ip_ua", f"{IP}|{UA}"), TrackKey("ip", IP))
    assert (opened.ip, opened.user_agent) == (IP, UA)
    assert lane.copies == ["session=real-cookie-1"]


def test_a_bearer_client_has_its_token_copied(lane: Harness) -> None:
    lane.router.decide(fwd("/.env", authorization="Bearer tok-real-55"))
    assert lane.copies == ["tok-real-55"]


def test_the_track_keeps_the_client_on_the_mirror(lane: Harness) -> None:
    track = lane.router.decide(fwd("/.env")).track_id
    assert lane.copies == []
    assert lane.router.decide(fwd("/products", n=1)) == Decision("mirror", track)
    assert len(lane.events) == 1


def test_the_ip_key_catches_a_rotated_user_agent_and_links_it(lane: Harness) -> None:
    track = lane.router.decide(fwd("/.git/config")).track_id
    assert lane.router.decide(fwd("/", n=1, user_agent="Mozilla/5.0")) == Decision("mirror", track)
    linked = lane.events[-1]
    assert isinstance(linked, TrackLinked)
    assert linked.event_id == "track.linked:req-1:ip_ua"
    assert linked.key == TrackKey("ip_ua", f"{IP}|Mozilla/5.0")
    lane.router.decide(fwd("/", n=2, user_agent="Mozilla/5.0"))
    assert len(lane.events) == 2


def test_a_non_critical_verdict_binds_only_ip_ua(lane: Harness) -> None:
    decisions = [lane.router.decide(fwd(f"/nope-{n}", n=n)) for n in range(5)]
    assert decisions[-1].lane == "mirror"
    assert all(d == REAL for d in decisions[:-1])
    [opened] = lane.events
    assert isinstance(opened, TrackOpened)
    assert opened.rule == "R1"
    assert opened.keys == (TrackKey("ip_ua", f"{IP}|{UA}"),)
    assert lane.router.decide(fwd("/", n=9, user_agent="Mozilla/5.0")) == REAL


def test_twin_born_values_route_from_any_ip_and_link_the_new_client(lane: Harness) -> None:
    track = lane.router.decide(fwd("/.env")).track_id
    token = twin_born_key("twin-session-4821")
    assert token is not None
    assert lane.router.link(track, token, "req-login", "twin_born-0") is True
    assert lane.router.link(track, token, "req-login", "twin_born-0") is False
    assert lane.events[-1].event_id == "track.linked:req-login:twin_born-0"
    elsewhere = fwd("/account", n=3, ip=OTHER_IP, cookie="session=twin-session-4821")
    assert lane.router.decide(elsewhere) == Decision("mirror", track)
    linked = lane.events[-1]
    assert isinstance(linked, TrackLinked)
    assert linked.key == TrackKey("ip_ua", f"{OTHER_IP}|{UA}")
    carriers = ({"authorization": "Bearer twin-session-4821"}, {"query": "t=twin-session-4821"})
    for carrier in carriers:
        stranger = fwd("/", n=4, ip="192.0.2.44", user_agent="curl/8", **carrier)
        assert lane.router.decide(stranger) == Decision("mirror", track)


def test_a_twin_born_key_wins_over_a_key_of_another_track(lane: Harness) -> None:
    first = lane.router.decide(fwd("/.env")).track_id
    second = lane.router.decide(fwd("/.env", n=1, ip=OTHER_IP)).track_id
    token = twin_born_key("twin-token-second")
    assert token is not None
    lane.router.link(second, token, "req-2")
    assert lane.router.decide(fwd("/", n=3, query="t=twin-token-second")).track_id == second
    assert lane.keys.find([fwd().ip_ua_key]) == (first, fwd().ip_ua_key)


def test_follow_moves_a_twin_born_login_to_its_track(lane: Harness) -> None:
    track = lane.router.decide(fwd("/.env")).track_id
    user = twin_born_key("mara.quint@example.net")
    assert user is not None
    lane.router.link(track, user, "req-1", "twin_born-0")
    login = fwd("/login", n=2, ip=OTHER_IP, method="POST")
    assert lane.router.follow([], [login.ip_ua_key], login.request_id) is None
    assert lane.router.follow([user], [login.ip_ua_key], "req-2") == Decision("mirror", track)
    assert lane.keys.find([login.ip_ua_key]) == (track, login.ip_ua_key)
    assert lane.events[-1].event_id == "track.linked:req-2:ip_ua"


def test_a_virtual_patch_mirrors_any_client(lane: Harness) -> None:
    lane.patches.add(PATCH)
    decision = lane.router.decide(fwd("/api/users/12", ip=OTHER_IP))
    assert decision.lane == "mirror"
    [opened] = lane.events
    assert isinstance(opened, TrackOpened)
    assert opened.rule == "R3"
    assert opened.reason == "virtual patch fnd_00000000000000f1: GET /api/users/{id}"
    assert opened.keys == (TrackKey("ip_ua", f"{OTHER_IP}|{UA}"),)


def test_a_signature_patch_works_without_a_verdict(tmp_path: Path) -> None:
    lane = build(tmp_path, Thresholds(r3_enabled=False))
    lane.patches.add(Patch("fnd_00000000000000f3", "GET", "/search", "sql union select", "R3"))
    assert lane.router.decide(fwd("/search?q=shoes")) == REAL
    assert lane.router.decide(fwd("/search?q=1+union+select+pw", n=1)).lane == "mirror"
    [opened] = lane.events
    assert isinstance(opened, TrackOpened)
    assert opened.reason == "virtual patch fnd_00000000000000f3: sql union select"


def test_concurrent_trigger_requests_open_exactly_one_track(lane: Harness) -> None:
    barrier = threading.Barrier(8)
    decisions: list[Decision] = []

    def hit(n: int) -> None:
        barrier.wait()
        decisions.append(lane.router.decide(fwd("/.env", n=n)))

    pool = [threading.Thread(target=hit, args=(n,)) for n in range(8)]
    for thread in pool:
        thread.start()
    for thread in pool:
        thread.join()
    assert len({d.track_id for d in decisions}) == 1
    assert [e.TYPE for e in lane.events] == ["track.opened"]


def headers(**values: str) -> Message[str, str]:
    message: Message[str, str] = Message()
    for name, value in values.items():
        message[name.replace("_", "-")] = value
    return message


def test_answer_never_raises(lane: Harness, caplog: pytest.LogCaptureFixture) -> None:
    assert lane.router.answer(headers(X_Forwarded_Uri="/.env")) == REAL
    assert "bad forwarded request" in caplog.text

    class Broken(Detector):
        def process(self, req: Request) -> list[Verdict]:
            raise RuntimeError("boom")

    broken = LaneRouter(Broken(RouteTable([]), Thresholds()), lane.keys, lane.patches, print, print)
    assert broken.answer(headers(X_Client_Ip=IP)) == REAL
    assert "decision failed" in caplog.text


@pytest.fixture
def sock_dir() -> Iterator[Path]:
    # macOS caps AF_UNIX paths near 104 bytes; pytest's tmp_path can be longer.
    with tempfile.TemporaryDirectory(dir="/tmp") as name:
        yield Path(name)


@pytest.fixture
def lane_socket(lane: Harness, sock_dir: Path) -> Iterator[Path]:
    path = sock_dir / "lane.sock"
    server = UnixHTTPServer(path, handler_for(lane.router))
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    yield path
    server.shutdown()
    server.server_close()
    thread.join()


def test_lane_endpoint_answers_200_with_headers_on_one_connection(lane_socket: Path) -> None:
    connection = UnixHTTPConnection(lane_socket)
    answers = []
    for uri in ("/products", "/.env", "/products"):
        connection.request("GET", "/lane", headers={"X-Forwarded-Uri": uri, "X-Client-Ip": IP})
        response = connection.getresponse()
        answers.append((response.status, response.getheader("X-Lane"), response.read()))
        track = response.getheader("X-Track-Id")
    connection.close()
    assert answers == [(200, "real", b""), (200, "mirror", b""), (200, "mirror", b"")]
    assert track is not None
    assert track.startswith("trk_")
