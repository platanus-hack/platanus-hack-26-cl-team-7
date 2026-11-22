"""eval.swarm: each scripted group gets the links it must get, and no other."""

from __future__ import annotations

import runpy

import pytest

from eval import swarm
from eval.swarm import Row, measure, table
from eval.swarm_groups import GROUPS, crawler_fleet, swarm_shared

ROWS = {script.__name__: measure(script, expected) for script, expected in GROUPS}
CONTROLS = ("swarm_isolated", "crawler_fleet", "shared_address", "solo_scanner", "humans")


@pytest.mark.parametrize("name", sorted(ROWS))
def test_each_group_gets_the_links_it_must_get(name: str) -> None:
    row = ROWS[name]
    assert row.ok, row
    assert row.linked == row.mirror_swarm - row.mirror_plain


@pytest.mark.parametrize("name", CONTROLS)
def test_a_control_group_ends_exactly_as_the_rules_alone_leave_it(name: str) -> None:
    row = ROWS[name]
    assert (row.linked, row.real_after_link) == (0, 0)
    assert row.mirror_swarm == row.mirror_plain


def test_a_swarm_with_shared_notes_ends_on_one_track() -> None:
    row = ROWS["swarm_shared"]
    assert (row.identities, row.mirror_plain, row.mirror_swarm, row.tracks) == (6, 0, 6, 1)
    assert row.real_after_link == 4, "each later worker sends one page before it uses the notes"


def test_an_address_that_rotates_its_user_agent_ends_on_one_track() -> None:
    row = ROWS["rotating_agent"]
    assert (row.mirror_plain, row.mirror_swarm, row.tracks) == (0, 6, 1)


def test_a_swarm_that_drops_markers_is_missed_and_the_table_says_so() -> None:
    row = ROWS["swarm_stripping"]
    assert (row.identities, row.mirror_swarm, row.linked) == (6, 0, 0)


def test_the_humans_group_holds_markers_and_is_big_enough() -> None:
    assert ROWS["humans"].identities == 200


def test_a_wrong_expectation_fails_the_row_and_the_command(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert not measure(crawler_fleet, 1).ok
    monkeypatch.setattr(swarm, "GROUPS", ((swarm_shared, 6), (crawler_fleet, 1)))
    assert swarm.main() == 1
    out = capsys.readouterr().out
    assert "| crawler_fleet | 8 | 0 | 0 | 0 | 1 | 0 | 0 | NO |" in out


def test_the_command_prints_one_row_per_group_and_passes(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert swarm.main() == 0
    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 2 + len(GROUPS)
    assert lines[2] == "| swarm_shared | 6 | 0 | 6 | 6 | 6 | 1 | 4 | yes |"


def test_a_row_that_loses_a_rule_verdict_is_not_ok() -> None:
    lost = Row(
        "x", 3, mirror_plain=2, mirror_swarm=1, linked=0, expected=0, tracks=1, real_after_link=0
    )
    assert not lost.ok
    assert table([lost]).endswith("| NO |")


@pytest.mark.filterwarnings("ignore:.*found in sys.modules:RuntimeWarning")
def test_running_the_module_exits_with_the_commands_code(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as done:
        runpy.run_module("eval.swarm", run_name="__main__")
    assert done.value.code == 0
    assert "| swarm_shared |" in capsys.readouterr().out
