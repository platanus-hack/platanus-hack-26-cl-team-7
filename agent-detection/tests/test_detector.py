"""Detector tests: verdict de-duplication, rule order, counts, session isolation, replay."""

from __future__ import annotations

from collections.abc import Iterator

from engine.config import Thresholds
from engine.detector import Detector, replay
from engine.models import Request, Verdict
from engine.routes import RouteTable

UA = "curl/8.7.1"
UA_OTHER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0"
IP = "203.0.113.20"
IP_OTHER = "203.0.113.21"

PATTERNS: list[dict[str, object]] = [
    {"pattern": "/"},
    {"pattern": "/search"},
    {"pattern": "/products/{id}"},
    {"pattern": "/cart"},
    {"pattern": "/static/**", "asset": True},
]


def make_detector(thresholds: Thresholds | None = None) -> Detector:
    return Detector(RouteTable.from_patterns(PATTERNS), thresholds or Thresholds())


def req(ts: float, path: str, query: str = "", ip: str = IP, ua: str = UA) -> Request:
    return Request(ts=ts, ip=ip, user_agent=ua, method="GET", path=path, query=query)


def process_all(detector: Detector, requests: list[Request]) -> list[Verdict]:
    verdicts: list[Verdict] = []
    for request in requests:
        verdicts.extend(detector.process(request))
    return verdicts


def noisy_probe(count: int, ip: str = IP, ua: str = UA, start: float = 0.0) -> list[Request]:
    """Distinct unlisted paths, one per 0.5 s: trips R1 at 5 and R2 at 11."""
    return [req(start + n * 0.5, f"/probe-{n}", ip=ip, ua=ua) for n in range(count)]


def test_process_returns_empty_list_for_ordinary_request() -> None:
    assert make_detector().process(req(0.0, "/")) == []


def test_at_most_one_verdict_per_session_and_rule() -> None:
    requests = noisy_probe(60) + [req(40.0 + n, "/.env") for n in range(5)]
    verdicts = process_all(make_detector(), requests)
    rules = [v.rule for v in verdicts]
    assert sorted(rules) == ["R1", "R2", "R3"]


def test_no_repeat_verdict_after_long_idle_gap() -> None:
    detector = make_detector()
    first = process_all(detector, noisy_probe(12) + [req(10.0, "/.env")])
    later = process_all(detector, noisy_probe(12, start=10_000.0) + [req(10_010.0, "/.env")])
    assert sorted(v.rule for v in first) == ["R1", "R2", "R3"]
    assert later == []


def test_rearm_lets_one_session_fire_each_rule_again() -> None:
    detector = make_detector()
    attack = req(1.0, "/.env")
    other = req(1.0, "/.env", ip=IP_OTHER)
    assert [v.rule for v in detector.process(attack) + detector.process(other)] == ["R3", "R3"]
    assert detector.process(attack) == []
    detector.rearm(attack.session_id)
    assert [v.rule for v in detector.process(attack)] == ["R3"]
    assert detector.process(other) == []  # only the rearmed session


def test_r1_fires_on_fifth_and_r2_on_eleventh_request() -> None:
    detector = make_detector()
    by_index = [detector.process(r) for r in noisy_probe(11)]
    assert [[v.rule for v in vs] for vs in by_index] == [[]] * 4 + [["R1"]] + [[]] * 5 + [["R2"]]


def test_rules_run_in_order_r3_r1_r2_on_one_request() -> None:
    thresholds = Thresholds(r1_min_exits=1, r2_max_endpoints=0)
    verdicts = make_detector(thresholds).process(req(5.0, "/.env"))
    assert [v.rule for v in verdicts] == ["R3", "R1", "R2"]


def test_critical_only_for_r3() -> None:
    thresholds = Thresholds(r1_min_exits=1, r2_max_endpoints=0)
    verdicts = make_detector(thresholds).process(req(5.0, "/.env"))
    critical = {v.rule: v.critical for v in verdicts}
    assert critical == {"R3": True, "R1": False, "R2": False}


def test_critical_false_for_r1_and_r2_in_a_noisy_session() -> None:
    verdicts = process_all(make_detector(), noisy_probe(20))
    assert {v.rule for v in verdicts} == {"R1", "R2"}
    assert all(v.critical is False for v in verdicts)


def test_every_verdict_says_probing() -> None:
    verdicts = process_all(make_detector(), noisy_probe(20) + [req(30.0, "/.git/config")])
    assert len(verdicts) == 3
    assert all(v.verdict == "probing" for v in verdicts)


def test_request_count_includes_trigger_request() -> None:
    detector = make_detector()
    human = [req(float(n), "/search", query=f"q=item{n}") for n in range(3)]
    assert process_all(detector, human) == []
    verdicts = detector.process(req(9.0, "/.env"))
    assert len(verdicts) == 1
    assert verdicts[0].request_count == 4


def test_request_count_ignores_other_sessions() -> None:
    detector = make_detector()
    others = [req(float(n), "/", ip=IP_OTHER) for n in range(7)]
    mine = [req(10.0, "/"), req(11.0, "/cart")]
    assert process_all(detector, others + mine) == []
    verdicts = detector.process(req(12.0, "/.env"))
    assert verdicts[0].request_count == 3


def test_request_count_counts_assets_and_listed_routes() -> None:
    detector = make_detector()
    browse = [req(0.0, "/"), req(0.1, "/static/a.js"), req(0.2, "/static/b.css")]
    browse += [req(1.0, "/products/7"), req(2.0, "/cart")]
    assert process_all(detector, browse) == []
    assert detector.process(req(3.0, "/.env"))[0].request_count == 6


def test_verdict_carries_trigger_ts_and_session_identity() -> None:
    verdicts = make_detector().process(req(1234.5, "/.env", ua=UA_OTHER))
    assert len(verdicts) == 1
    verdict = verdicts[0]
    assert verdict.ts == 1234.5
    assert verdict.ip == IP
    assert verdict.user_agent == UA_OTHER
    assert verdict.session_id == f"{IP}|{UA_OTHER}"


def test_verdict_to_dict_has_contract_keys() -> None:
    payload = make_detector().process(req(1.0, "/.env"))[0].to_dict()
    expected = {"session_id", "ip", "user_agent", "rule", "reason", "critical", "ts"}
    expected |= {"request_count", "verdict", "extra"}
    assert set(payload) == expected


def test_same_ip_different_user_agent_are_separate_sessions() -> None:
    detector = make_detector()
    a = [req(float(n), f"/a-{n}", ua=UA) for n in range(3)]
    b = [req(float(n) + 0.5, f"/b-{n}", ua=UA_OTHER) for n in range(3)]
    interleaved = [r for pair in zip(a, b, strict=True) for r in pair]
    assert process_all(detector, interleaved) == []


def test_same_user_agent_different_ip_are_separate_sessions() -> None:
    detector = make_detector()
    a = [req(float(n), f"/a-{n}", ip=IP) for n in range(4)]
    b = [req(float(n) + 0.5, f"/b-{n}", ip=IP_OTHER) for n in range(4)]
    interleaved = [r for pair in zip(a, b, strict=True) for r in pair]
    assert process_all(detector, interleaved) == []


def test_only_the_probing_session_gets_a_verdict() -> None:
    detector = make_detector()
    human = [req(float(n), "/search", query=f"q={n}", ua=UA_OTHER) for n in range(30)]
    probe = noisy_probe(5, start=0.25)
    mixed = sorted(human + probe, key=lambda r: r.ts)
    verdicts = process_all(detector, mixed)
    assert [(v.rule, v.session_id) for v in verdicts] == [("R1", f"{IP}|{UA}")]


def test_two_probing_sessions_each_get_their_own_verdicts() -> None:
    detector = make_detector()
    one = noisy_probe(5, ip=IP)
    two = noisy_probe(5, ip=IP_OTHER, start=0.1)
    mixed = sorted(one + two, key=lambda r: r.ts)
    verdicts = process_all(detector, mixed)
    assert sorted(v.session_id for v in verdicts) == sorted([f"{IP}|{UA}", f"{IP_OTHER}|{UA}"])
    assert all(v.rule == "R1" for v in verdicts)


def test_r3_in_one_session_does_not_suppress_r3_in_another() -> None:
    detector = make_detector()
    first = detector.process(req(1.0, "/.env", ip=IP))
    second = detector.process(req(2.0, "/.env", ip=IP_OTHER))
    assert [v.rule for v in first] == ["R3"]
    assert [v.rule for v in second] == ["R3"]


def test_out_of_order_timestamps_do_not_crash() -> None:
    detector = make_detector()
    requests = [req(100.0, "/x-1"), req(50.0, "/x-2"), req(75.0, "/"), req(10.0, "/.env")]
    verdicts = process_all(detector, requests)
    assert [v.rule for v in verdicts] == ["R3"]
    assert verdicts[0].request_count == 4


def test_replay_matches_process_over_a_list() -> None:
    requests = noisy_probe(15) + [req(20.0, "/.env"), req(21.0, "/", ip=IP_OTHER)]
    expected = process_all(make_detector(), requests)
    assert replay(requests, make_detector()) == expected
    assert [v.rule for v in expected] == ["R1", "R2", "R3"]


def test_replay_of_empty_input_is_empty() -> None:
    assert replay([], make_detector()) == []


def test_replay_accepts_any_iterable() -> None:
    def generate() -> Iterator[Request]:
        yield from noisy_probe(5)

    verdicts = replay(generate(), make_detector())
    assert [(v.rule, v.request_count) for v in verdicts] == [("R1", 5)]


def test_replay_uses_the_given_detector_state() -> None:
    detector = make_detector()
    process_all(detector, noisy_probe(4))
    verdicts = replay([req(10.0, "/probe-extra")], detector)
    assert [(v.rule, v.request_count) for v in verdicts] == [("R1", 5)]


def test_replay_of_human_traffic_is_empty() -> None:
    requests = [req(float(n), p) for n, p in enumerate(["/", "/search", "/products/3", "/cart"])]
    assert replay(requests * 10, make_detector()) == []


def test_idle_session_is_expired_and_counts_restart() -> None:
    detector = make_detector(Thresholds(idle_timeout=100.0))
    process_all(detector, [req(float(n), "/") for n in range(3)])
    verdicts = detector.process(req(500.0, "/.env"))
    assert [(v.rule, v.request_count) for v in verdicts] == [("R3", 1)]
    assert len(detector.sessions) == 1
