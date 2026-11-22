from pathlib import Path

import pytest

from scripts.evidence_demo import BUNDLE_PATH, detector_trials, recorded_trials, render_bundle


def test_bundle_matches_checked_in_file() -> None:
    assert render_bundle() == render_bundle() == BUNDLE_PATH.read_text(encoding="utf-8")


def test_detector_flags_only_the_fifth_unlisted_request() -> None:
    benign, unlisted = detector_trials()
    assert str(benign["profile"]) == "benign"
    assert str(unlisted["profile"]) == "unlisted"
    benign_events = benign["observations"]
    unlisted_events = unlisted["observations"]
    assert isinstance(benign_events, list)
    assert isinstance(unlisted_events, list)
    assert [e["listed"] for e in benign_events] == [True] * 5
    assert [e["listed"] for e in unlisted_events if e["kind"] == "route"] == [False] * 5
    assert [(e["rule"], e["ordinal"]) for e in unlisted_events if e["kind"] == "verdict"] == [
        ("R1", 5),
    ]


def test_rejects_an_artifact_for_another_target(tmp_path: Path) -> None:
    path = tmp_path / "other.json"
    path.write_text('{"target":"other"}', encoding="utf-8")
    with pytest.raises(ValueError, match="mock-bank"):
        recorded_trials(path)
