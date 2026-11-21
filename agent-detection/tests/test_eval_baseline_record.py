"""Baseline provenance: `python -m eval baseline` and the split / lock checks in check-baseline."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from test_eval_baseline import replay_args, write_data

from eval.__main__ import main
from eval.baseline import baseline_record, check_provenance, lock_digest
from eval.lock import write_lock


def report(split: str = "test", precision: float | None = 1.0) -> dict[str, Any]:
    return {
        "split": split,
        "sessions": 2,
        "thresholds": {"r1_min_exits": 5},
        "precision": {"value": precision, "sessions": 1},
        "recall": {"value": 1.0, "sessions": 1},
    }


def locked(tmp_path: Path, text: str = "a" * 64 + "  x.jsonl\n") -> Path:
    lock = tmp_path / "testset.lock"
    lock.write_text(text)
    return lock


def test_record_carries_split_sessions_and_lock_digest(tmp_path: Path) -> None:
    lock = locked(tmp_path)
    record = baseline_record(report(), lock)
    assert record["precision"] == 1.0
    assert record["recall"] == 1.0
    assert record["split"] == "test"
    assert record["sessions"] == 2
    assert record["testset_lock_sha256"] == lock_digest(lock)
    assert record["thresholds"] == {"r1_min_exits": 5}
    assert check_provenance(record, report(), lock) == []


def test_record_refuses_a_null_metric(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="precision"):
        baseline_record(report(precision=None), locked(tmp_path))


def test_record_refuses_a_missing_lock(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="lock file missing"):
        baseline_record(report(), tmp_path / "absent.lock")


def test_baseline_without_provenance_is_refused(tmp_path: Path) -> None:
    problems = check_provenance({"precision": 1.0, "recall": 1.0}, report(), locked(tmp_path))
    assert len(problems) == 1
    assert "python -m eval baseline" in problems[0]


def test_baseline_from_another_split_is_refused(tmp_path: Path) -> None:
    lock = locked(tmp_path)
    record = baseline_record(report(split="tune"), lock)
    problems = check_provenance(record, report(split="test"), lock)
    assert problems == ["baseline was taken on split 'tune', this run scores split 'test'"]


def test_baseline_from_another_test_set_is_refused(tmp_path: Path) -> None:
    lock = locked(tmp_path)
    record = baseline_record(report(), lock)
    lock.write_text("b" * 64 + "  y.jsonl\n")
    assert len(check_provenance(record, report(), lock)) == 1
    lock.unlink()
    assert "digest differs" in check_provenance(record, report(), lock)[0]


def test_cli_check_baseline_refuses_a_hand_written_baseline(
    tmp_path: Path, rules_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    paths = write_data(tmp_path)
    baseline, lock = tmp_path / "baseline.json", tmp_path / "testset.lock"
    write_lock(paths["data"] / "test", lock)
    baseline.write_text(json.dumps({"precision": 1.0, "recall": 1.0}))
    files = ["--baseline", str(baseline), "--lock", str(lock)]
    assert main(["check-baseline", *replay_args(paths, rules_path), *files]) == 1
    assert "python -m eval baseline" in capsys.readouterr().err


def test_cli_baseline_refuses_a_test_split_that_breaks_the_lock(
    tmp_path: Path, rules_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    paths = write_data(tmp_path)
    baseline, lock = tmp_path / "baseline.json", tmp_path / "testset.lock"
    write_lock(paths["data"] / "test", lock)
    (paths["data"] / "test" / "extra.txt").write_text("not locked\n")
    files = ["--baseline", str(baseline), "--lock", str(lock)]
    assert main(["baseline", *replay_args(paths, rules_path), *files]) == 1
    assert "file not in lock: extra.txt" in capsys.readouterr().err
    assert not baseline.exists()
