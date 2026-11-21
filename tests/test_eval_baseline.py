"""Accuracy gate: eval.baseline.check_baseline.

Interface the implementer must meet (eval/baseline.py):
    TOLERANCE = 0.005
    check_baseline(current: Mapping[str, float | None], baseline: Mapping[str, float],
                   tolerance: float = TOLERANCE) -> list[str]
        Compares "precision" and "recall" only. Returns one problem per metric that is more than
        `tolerance` below its baseline, or that is missing / None in `current` (the text names the
        metric). [] means the gate passes. Other baseline keys are not gated.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from helpers import DEFAULT_IP, caddy_line

from eval.__main__ import main
from eval.baseline import TOLERANCE, check_baseline, current_values, load_baseline
from eval.dataset import load_split

BASE = {"precision": 0.95, "recall": 0.9}


def test_tolerance_is_half_a_point() -> None:
    assert pytest.approx(0.005) == TOLERANCE


def test_unchanged_metrics_pass() -> None:
    assert check_baseline(dict(BASE), BASE) == []


def test_precision_drop_of_0_006_fails() -> None:
    problems = check_baseline({"precision": 0.944, "recall": 0.9}, BASE)
    assert len(problems) == 1
    assert "precision" in problems[0]


def test_recall_drop_of_0_006_fails() -> None:
    problems = check_baseline({"precision": 0.95, "recall": 0.894}, BASE)
    assert len(problems) == 1
    assert "recall" in problems[0]


def test_both_dropping_report_two_problems() -> None:
    problems = check_baseline({"precision": 0.9, "recall": 0.8}, BASE)
    assert len(problems) == 2
    joined = " ".join(problems)
    assert "precision" in joined
    assert "recall" in joined


def test_precision_drop_of_0_004_passes() -> None:
    assert check_baseline({"precision": 0.946, "recall": 0.9}, BASE) == []


def test_recall_drop_of_0_004_passes() -> None:
    assert check_baseline({"precision": 0.95, "recall": 0.896}, BASE) == []


def test_improvements_pass() -> None:
    assert check_baseline({"precision": 1.0, "recall": 0.99}, BASE) == []


def test_one_improves_one_drops_still_fails() -> None:
    problems = check_baseline({"precision": 0.99, "recall": 0.85}, BASE)
    assert len(problems) == 1
    assert "recall" in problems[0]


def test_drop_from_perfect_baseline() -> None:
    perfect = {"precision": 1.0, "recall": 1.0}
    assert check_baseline({"precision": 0.996, "recall": 1.0}, perfect) == []
    assert check_baseline({"precision": 0.994, "recall": 1.0}, perfect) != []


def test_null_current_metric_fails() -> None:
    problems = check_baseline({"precision": None, "recall": 0.9}, BASE)
    assert len(problems) == 1
    assert "precision" in problems[0]


def test_missing_current_metric_fails() -> None:
    problems = check_baseline({"precision": 0.95}, BASE)
    assert len(problems) == 1
    assert "recall" in problems[0]


def test_other_baseline_keys_are_not_gated() -> None:
    baseline = {**BASE, "human_false_alarm_rate": 0.0}
    current = {"precision": 0.95, "recall": 0.9, "human_false_alarm_rate": 0.5}
    assert check_baseline(current, baseline) == []


def test_custom_tolerance() -> None:
    assert check_baseline({"precision": 0.93, "recall": 0.9}, BASE, tolerance=0.03) == []
    assert check_baseline({"precision": 0.93, "recall": 0.9}, BASE, tolerance=0.01) != []


def test_load_baseline_keeps_numeric_keys(tmp_path: Path) -> None:
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps({"precision": 1, "recall": 0.9, "note": "v0"}))
    assert load_baseline(path) == {"precision": 1.0, "recall": 0.9}


def test_load_baseline_rejects_non_object(tmp_path: Path) -> None:
    path = tmp_path / "baseline.json"
    path.write_text("[1, 2]")
    with pytest.raises(ValueError, match="object"):
        load_baseline(path)


def test_missing_baseline_value_is_a_problem() -> None:
    problems = check_baseline({"precision": 0.95, "recall": 0.9}, {"precision": 0.95})
    assert problems == ["recall: baseline has no value"]


def test_current_values_reads_report_values() -> None:
    report = {"precision": {"value": 0.5, "sessions": 2}, "recall": {"value": None, "sessions": 0}}
    assert current_values(report) == {"precision": 0.5, "recall": None}


ROUTES_YAML = 'routes:\n  - pattern: "/"\n  - pattern: "/products/{id}"\n'
HUMAN_UA = "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0"


def write_data(root: Path) -> dict[str, Path]:
    test_dir = root / "data" / "test"
    test_dir.mkdir(parents=True)
    probe = [caddy_line(ts=10.0 + i, uri=f"/x{i}", status=404, user_agent="ffuf") for i in range(6)]
    human = [
        caddy_line(ts=11.0 + 9 * i, uri=f"/products/{i}", user_agent=HUMAN_UA) for i in range(3)
    ]
    (test_dir / "mix.jsonl").write_text("".join(f"{item}\n" for item in [*probe, *human]))
    sessions = {f"{DEFAULT_IP}|ffuf": "probing", f"{DEFAULT_IP}|{HUMAN_UA}": "human"}
    meta = {"source": "fixture", "synthetic": True, "notes": "", "sessions": sessions}
    (test_dir / "mix.labels.json").write_text(json.dumps(meta))
    (root / "routes.yaml").write_text(ROUTES_YAML)
    return {"data": root / "data", "routes": root / "routes.yaml", "report": root / "r.json"}


def replay_args(paths: dict[str, Path], rules: Path) -> list[str]:
    return ["--data", str(paths["data"]), "--routes", str(paths["routes"]), "--rules", str(rules)]


def test_cli_run_prints_table_and_writes_report(
    tmp_path: Path, rules_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    paths = write_data(tmp_path)
    assert main(["run", *replay_args(paths, rules_path), "--report", str(paths["report"])]) == 0
    out = capsys.readouterr().out
    assert "precision" in out
    assert "(1 sessions)" in out
    report = json.loads(paths["report"].read_text())
    assert report["split"] == "test"
    assert report["confusion"] == {"tp": 1, "fp": 0, "fn": 0, "tn": 1}
    assert report["thresholds"]["r1_min_exits"] == 5
    assert report["per_source"]["fixture"]["sessions"] == 2
    assert report["per_source"]["fixture"]["precision"] == {"value": 1.0, "sessions": 1}


def test_cli_check_baseline_exit_codes(tmp_path: Path, rules_path: Path) -> None:
    paths = write_data(tmp_path)
    baseline = tmp_path / "baseline.json"
    baseline.write_text(json.dumps({"precision": 1.0, "recall": 1.0}))
    args = ["check-baseline", *replay_args(paths, rules_path), "--baseline", str(baseline)]
    assert main(args) == 0
    (paths["data"] / "test" / "mix.labels.json").write_text(
        json.dumps(
            {"sessions": {f"{DEFAULT_IP}|ffuf": "human", f"{DEFAULT_IP}|{HUMAN_UA}": "human"}}
        )
    )
    assert main(args) == 1


def test_cli_reports_data_errors_with_exit_code_2(
    tmp_path: Path, rules_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    paths = write_data(tmp_path)
    (paths["data"] / "test" / "mix.labels.json").unlink()
    assert main(["run", *replay_args(paths, rules_path), "--report", str(paths["report"])]) == 2
    assert "mix.labels.json" in capsys.readouterr().err


def test_cli_run_fails_clearly_on_an_empty_split(
    tmp_path: Path, rules_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    paths = write_data(tmp_path)
    (paths["data"] / "test" / "mix.jsonl").unlink()
    assert main(["run", *replay_args(paths, rules_path), "--report", str(paths["report"])]) == 2
    assert "has no labeled sessions" in capsys.readouterr().err
    assert not paths["report"].exists()


def test_cli_synth_then_base_rate(
    tmp_path: Path, rules_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    paths = write_data(tmp_path)
    out = tmp_path / "synth"
    assert main(["synth", "--routes", str(paths["routes"]), "--out", str(out), "--count", "5"]) == 0
    assert len(load_split(out).labels) == 5
    args = ["base-rate", *replay_args(paths, rules_path), "--humans", "40", "--ratio", "40"]
    assert main(args) == 0
    result = json.loads(capsys.readouterr().out.split("\n", 1)[1])
    assert result["human_sessions"] == 40
    assert result["probe_sessions"] == 1
    assert result["detected_probe_sessions"] == 1
    assert result["human_sessions_synthetic"] is True
