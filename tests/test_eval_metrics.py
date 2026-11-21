"""Level-2 scoring: eval.metrics.score(labels, verdicts) -> JSON-ready report dict.

Interface the implementer must meet (eval/metrics.py):
    score(labels: Mapping[str, Label], verdicts: Iterable[Verdict]) -> dict[str, Any]
Report layout:
    "confusion": {"tp": int, "fp": int, "fn": int, "tn": int}   (one count per labeled session)
    each of "precision", "recall", "human_false_alarm_rate", "critical_flag_precision",
    "median_requests_before_verdict", "probing_ai_recall":
        {"value": float | None, "sessions": int}
A session is flagged when it has at least one verdict. "probing" and "probing_ai" are both positive.
"sessions" is the denominator: flagged sessions (precision), positive sessions (recall), human
sessions (false-alarm rate), sessions with a critical verdict (critical precision), detected
positive sessions (median), probing_ai sessions (probing_ai_recall). A zero denominator gives
value None (JSON null), never an exception. The median uses each detected positive session's
first verdict (smallest request_count); humans never enter it.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from engine.models import Label, RuleId, Verdict
from eval.metrics import score

METRIC_KEYS = (
    "precision",
    "recall",
    "human_false_alarm_rate",
    "critical_flag_precision",
    "median_requests_before_verdict",
    "probing_ai_recall",
)


def verdict(session: str, count: int, *, rule: RuleId = "R1", critical: bool = False) -> Verdict:
    ip, _, ua = session.partition("|")
    return Verdict(
        session_id=session,
        ip=ip,
        user_agent=ua,
        rule=rule,
        reason="test",
        critical=critical,
        ts=1000.0 + count,
        request_count=count,
    )


def sid(name: str) -> str:
    return f"198.51.100.9|agent-{name}"


def mixed_labels() -> dict[str, Label]:
    labels: dict[str, Label] = {}
    for name in ("h1", "h2", "h3"):
        labels[sid(name)] = "human"
    for name in ("p1", "p2", "p3"):
        labels[sid(name)] = "probing"
    for name in ("a1", "a2"):
        labels[sid(name)] = "probing_ai"
    return labels


def mixed_verdicts() -> list[Verdict]:
    return [
        verdict(sid("p1"), 7, rule="R1"),
        verdict(sid("p1"), 12, rule="R2"),
        verdict(sid("p2"), 1, rule="R3", critical=True),
        verdict(sid("a1"), 20, rule="R2"),
        verdict(sid("h1"), 30, rule="R2"),
    ]


def metric(report: dict[str, Any], key: str) -> tuple[Any, int]:
    entry = report[key]
    return entry["value"], entry["sessions"]


def test_confusion_counts_sessions_not_verdicts() -> None:
    report = score(mixed_labels(), mixed_verdicts())
    assert report["confusion"] == {"tp": 3, "fp": 1, "fn": 2, "tn": 2}


def test_precision_counts_flagged_sessions() -> None:
    value, sessions = metric(score(mixed_labels(), mixed_verdicts()), "precision")
    assert value == pytest.approx(0.75)
    assert sessions == 4


def test_recall_counts_probing_and_probing_ai_sessions() -> None:
    value, sessions = metric(score(mixed_labels(), mixed_verdicts()), "recall")
    assert value == pytest.approx(0.6)
    assert sessions == 5


def test_human_false_alarm_rate() -> None:
    value, sessions = metric(score(mixed_labels(), mixed_verdicts()), "human_false_alarm_rate")
    assert value == pytest.approx(1 / 3)
    assert sessions == 3


def test_critical_flag_precision_all_real_probing() -> None:
    value, sessions = metric(score(mixed_labels(), mixed_verdicts()), "critical_flag_precision")
    assert value == pytest.approx(1.0)
    assert sessions == 1


def test_critical_flag_on_human_lowers_critical_precision() -> None:
    verdicts = [
        *mixed_verdicts(),
        verdict(sid("h2"), 3, rule="R3", critical=True),
    ]
    value, sessions = metric(score(mixed_labels(), verdicts), "critical_flag_precision")
    assert value == pytest.approx(0.5)
    assert sessions == 2


def test_critical_precision_ignores_non_critical_verdicts() -> None:
    verdicts = [verdict(sid("h1"), 4, rule="R2"), verdict(sid("p1"), 2, rule="R3", critical=True)]
    value, sessions = metric(score(mixed_labels(), verdicts), "critical_flag_precision")
    assert value == pytest.approx(1.0)
    assert sessions == 1


def test_median_uses_first_verdict_of_detected_probing_sessions_only() -> None:
    value, sessions = metric(
        score(mixed_labels(), mixed_verdicts()), "median_requests_before_verdict"
    )
    assert value == pytest.approx(7.0)
    assert sessions == 3


def test_median_takes_smallest_request_count_whatever_the_order() -> None:
    labels: dict[str, Label] = {sid("p1"): "probing"}
    verdicts = [verdict(sid("p1"), 40, rule="R2"), verdict(sid("p1"), 9, rule="R1")]
    value, sessions = metric(score(labels, verdicts), "median_requests_before_verdict")
    assert value == pytest.approx(9.0)
    assert sessions == 1


def test_median_of_even_count_is_mean_of_middle_pair() -> None:
    labels: dict[str, Label] = {sid("p1"): "probing", sid("p2"): "probing_ai"}
    verdicts = [verdict(sid("p1"), 4), verdict(sid("p2"), 10)]
    value, sessions = metric(score(labels, verdicts), "median_requests_before_verdict")
    assert value == pytest.approx(7.0)
    assert sessions == 2


def test_probing_ai_counts_as_probing_for_precision() -> None:
    labels: dict[str, Label] = {sid("a1"): "probing_ai", sid("h1"): "human"}
    report = score(labels, [verdict(sid("a1"), 5)])
    assert metric(report, "precision") == (pytest.approx(1.0), 1)
    assert metric(report, "recall") == (pytest.approx(1.0), 1)
    assert report["confusion"] == {"tp": 1, "fp": 0, "fn": 0, "tn": 1}


def test_probing_ai_recall_reported_separately() -> None:
    value, sessions = metric(score(mixed_labels(), mixed_verdicts()), "probing_ai_recall")
    assert value == pytest.approx(0.5)
    assert sessions == 2


def test_probing_ai_recall_null_when_no_ai_sessions() -> None:
    labels: dict[str, Label] = {sid("p1"): "probing", sid("h1"): "human"}
    value, sessions = metric(score(labels, [verdict(sid("p1"), 3)]), "probing_ai_recall")
    assert value is None
    assert sessions == 0


def test_no_verdicts_gives_null_precision_and_zero_recall() -> None:
    report = score(mixed_labels(), [])
    assert report["confusion"] == {"tp": 0, "fp": 0, "fn": 5, "tn": 3}
    assert metric(report, "precision") == (None, 0)
    assert metric(report, "recall") == (pytest.approx(0.0), 5)
    assert metric(report, "human_false_alarm_rate") == (pytest.approx(0.0), 3)
    assert metric(report, "critical_flag_precision") == (None, 0)
    assert metric(report, "median_requests_before_verdict") == (None, 0)
    assert metric(report, "probing_ai_recall") == (pytest.approx(0.0), 2)


def test_only_humans_gives_null_recall() -> None:
    labels: dict[str, Label] = {sid("h1"): "human", sid("h2"): "human"}
    report = score(labels, [])
    assert metric(report, "recall") == (None, 0)
    assert metric(report, "human_false_alarm_rate") == (pytest.approx(0.0), 2)


def test_only_probing_gives_null_false_alarm_rate() -> None:
    labels: dict[str, Label] = {sid("p1"): "probing"}
    report = score(labels, [verdict(sid("p1"), 2)])
    assert metric(report, "human_false_alarm_rate") == (None, 0)
    assert metric(report, "precision") == (pytest.approx(1.0), 1)


def test_empty_input_reports_every_metric_as_null() -> None:
    report = score({}, [])
    assert report["confusion"] == {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
    for key in METRIC_KEYS:
        assert metric(report, key) == (None, 0), key


def test_report_serializes_null_as_json_null() -> None:
    report = score({}, [])
    decoded = json.loads(json.dumps(report))
    assert decoded["precision"] == {"value": None, "sessions": 0}
    assert '"value": null' in json.dumps(report)


def test_full_report_round_trips_through_json() -> None:
    report = score(mixed_labels(), mixed_verdicts())
    decoded = json.loads(json.dumps(report))
    assert decoded["confusion"] == report["confusion"]
    for key in METRIC_KEYS:
        assert decoded[key]["sessions"] == report[key]["sessions"]


def test_all_flagged_sessions_correct_gives_perfect_scores() -> None:
    labels: dict[str, Label] = {sid("p1"): "probing", sid("p2"): "probing", sid("h1"): "human"}
    report = score(labels, [verdict(sid("p1"), 3), verdict(sid("p2"), 6)])
    assert metric(report, "precision") == (pytest.approx(1.0), 2)
    assert metric(report, "recall") == (pytest.approx(1.0), 2)
    assert metric(report, "human_false_alarm_rate") == (pytest.approx(0.0), 1)
    assert metric(report, "median_requests_before_verdict") == (pytest.approx(4.5), 2)


def test_verdicts_for_unlabeled_sessions_are_ignored() -> None:
    report = score(mixed_labels(), [*mixed_verdicts(), verdict("192.0.2.1|unknown", 2)])
    assert report["confusion"] == {"tp": 3, "fp": 1, "fn": 2, "tn": 2}
