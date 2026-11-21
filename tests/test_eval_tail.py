"""Heavy-tail synthetic humans (eval.tail) and the base-rate human mix that uses them."""

from __future__ import annotations

import statistics
from collections import Counter

import pytest
from test_eval_base_rate import PATTERNS, ROUTES, classify, human_request, probe_pool

from engine.config import Thresholds
from engine.detector import Detector, replay
from engine.models import Request
from eval.base_rate import TAIL_SHARE, base_rate_humans, mix_base_rate
from eval.synthetic import synthetic_humans
from eval.tail import CHROME_UA, DEVTOOLS_PATH, HABITS, IPHONE_UA, TOUCH_ICONS, tail_humans

COUNT = 600


def tail(seed: int = 5, count: int = COUNT) -> list[list[Request]]:
    return tail_humans(PATTERNS, count, seed)


def flagged(sessions: list[list[Request]], thresholds: Thresholds) -> Counter[str]:
    requests = sorted((r for s in sessions for r in s), key=lambda r: r.ts)
    return Counter(v.rule for v in replay(requests, Detector(ROUTES, thresholds)))


def test_tail_is_deterministic_and_rotates_habits() -> None:
    assert tail(count=30) == tail(count=30)
    assert tail(seed=6, count=30) != tail(count=30)
    agents = [s[0].user_agent for s in tail(count=6)]
    assert agents[0] == agents[3] == CHROME_UA
    assert agents[1] == agents[4] == IPHONE_UA
    assert len(HABITS) == 3


def test_devtools_sessions_fetch_the_devtools_file_after_every_page() -> None:
    for session in tail()[0::3]:
        pages = [r for r in session if classify(r) == "page"]
        probes = [r for r in session if r.path == DEVTOOLS_PATH]
        assert len(probes) == len(pages)
        assert all(r.status == 404 and r.user_agent == CHROME_UA for r in probes)


def test_touch_icon_sessions_ask_for_both_icons_on_the_first_page() -> None:
    for session in tail()[1::3]:
        icons = [r.path for r in session if r.path in TOUCH_ICONS]
        assert set(TOUCH_ICONS) <= set(icons)
        assert all(r.status == 404 for r in session if r.path in TOUCH_ICONS)


def test_listed_auto_fetch_path_is_not_an_exit() -> None:
    patterns = [*PATTERNS, {"pattern": DEVTOOLS_PATH, "asset": True}]
    session = tail_humans(patterns, 1, seed=5)[0]
    assert {r.status for r in session if r.path == DEVTOOLS_PATH} == {200}


def test_tab_sessions_open_pages_under_two_seconds_apart() -> None:
    gaps: list[float] = []
    for session in tail()[2::3]:
        stamps = [r.ts for r in session if classify(r) == "page"]
        gaps.extend(b - a for a, b in zip(stamps, stamps[1:], strict=False))
    assert gaps
    assert min(gaps) >= 0.3
    assert max(gaps) <= 1.5


def test_tail_sessions_stay_time_ordered_and_distinct() -> None:
    sessions = tail()
    for session in sessions:
        assert [r.ts for r in session] == sorted(r.ts for r in session)
        assert len({r.session_id for r in session}) == 1
    assert len({s[0].session_id for s in sessions}) == COUNT


def test_tail_never_shares_a_session_with_ordinary_humans_of_the_same_seed() -> None:
    ordinary = {s[0].session_id for s in synthetic_humans(PATTERNS, COUNT, 5)}
    assert ordinary.isdisjoint(s[0].session_id for s in tail())


def test_tail_humans_can_trip_r1_at_the_shipped_thresholds() -> None:
    assert flagged(tail(), Thresholds())["R1"] >= 1


def test_tail_humans_reach_r2_when_its_threshold_is_lowered() -> None:
    assert flagged(tail(), Thresholds(r2_max_endpoints=5))["R2"] >= 1


def test_base_rate_humans_mix_ordinary_and_tail_sessions() -> None:
    people = base_rate_humans(PATTERNS, 2_000, seed=3)
    assert len(people) == 2_000
    assert len({s[0].session_id for s in people}) == 2_000
    exits = [sum(classify(r) == "exit" for r in s) for s in people]
    assert max(exits) >= Thresholds().r1_min_exits
    assert statistics.mean(exits) < 0.2
    assert pytest.approx(0.01) == TAIL_SHARE


def test_base_rate_humans_without_tail_are_ordinary_humans() -> None:
    assert base_rate_humans(PATTERNS, 50, seed=3, tail_share=0.0) == synthetic_humans(
        PATTERNS, 50, 3
    )


def test_base_rate_humans_reject_a_share_outside_zero_to_one() -> None:
    with pytest.raises(ValueError, match="tail_share"):
        base_rate_humans(PATTERNS, 10, seed=1, tail_share=1.5)


def test_mix_with_fewer_humans_than_the_ratio_is_refused() -> None:
    people = [[human_request(i)] for i in range(9_999)]
    with pytest.raises(ValueError, match="at least 10000 human sessions"):
        mix_base_rate(people, probe_pool(), seed=1)
