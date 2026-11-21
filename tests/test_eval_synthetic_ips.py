"""Synthetic IP blocks keep generated sets apart; one split never merges sessions across files."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from test_eval_base_rate import PATTERNS
from test_eval_baseline import replay_args, write_data

from eval.__main__ import main
from eval.dataset import DatasetError, load_dataset, load_split
from eval.synthetic import synthetic_humans, write_pair


def ids(seed: int, count: int = 200, **kwargs: int) -> set[str]:
    return {s[0].session_id for s in synthetic_humans(PATTERNS, count, seed, **kwargs)}


def test_runs_with_other_seeds_share_no_session() -> None:
    assert ids(1).isdisjoint(ids(2))


def test_block_comes_from_the_seed_unless_given() -> None:
    assert all(sid.startswith("10.7.") for sid in ids(7, count=20))
    assert all(sid.startswith("10.42.") for sid in ids(7, count=20, ip_block=42))


def test_block_out_of_range_is_refused() -> None:
    with pytest.raises(ValueError, match="ip_block"):
        synthetic_humans(PATTERNS, 1, seed=1, ip_block=256)


def test_runs_above_one_block_stay_distinct() -> None:
    assert len(ids(3, count=70_000)) == 70_000


def test_tune_and_test_synth_sets_load_as_disjoint_splits(tmp_path: Path) -> None:
    for split, seed in (("tune", 1), ("test", 2)):
        write_pair(tmp_path / split, "synth", synthetic_humans(PATTERNS, 200, seed), "generated")
    splits = load_dataset(tmp_path)
    assert len(splits["tune"].labels) == len(splits["test"].labels) == 200


def test_one_session_in_two_files_of_a_split_is_refused(tmp_path: Path) -> None:
    for name in ("a", "b"):
        sessions = synthetic_humans(PATTERNS, 20, seed=1)
        write_pair(tmp_path, name, sessions, "generated")
    with pytest.raises(DatasetError, match="also appears in a.jsonl"):
        load_split(tmp_path)


def test_cli_synth_takes_an_ip_block(tmp_path: Path) -> None:
    paths = write_data(tmp_path)
    out = tmp_path / "synth"
    args = ["synth", "--routes", str(paths["routes"]), "--out", str(out), "--ip-block", "99"]
    assert main([*args, "--count", "3"]) == 0
    meta = json.loads((out / "synthetic_humans.labels.json").read_text())
    assert all(sid.startswith("10.99.") for sid in meta["sessions"])


def test_cli_base_rate_reports_the_actual_ratio_and_tail(
    tmp_path: Path, rules_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    paths = write_data(tmp_path)
    args = ["base-rate", *replay_args(paths, rules_path), "--humans", "50", "--ratio", "40"]
    assert main([*args, "--tail-share", "0.1"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["ratio"] == 40
    assert result["actual_ratio"] == 50.0
    assert result["human_tail_sessions"] == 5
    assert result["human_tail_share"] == 0.1
    assert main([*args[:-2], "--ratio", "60"]) == 2
