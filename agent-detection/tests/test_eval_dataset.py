"""Labeled data loading: eval.dataset.

Interface the implementer must meet (eval/dataset.py):
    class DatasetError(ValueError)
    @dataclass Split: requests: list[Request] (sorted by ts), labels: dict[str, Label]
    load_split(directory: Path) -> Split
        Reads every <name>.jsonl with its <name>.labels.json in one split directory. Caddy lines are
        parsed with engine.logreader.parse_line; non-access lines are ignored. Raises DatasetError
        when a .jsonl has no labels file, a label is not human/probing/probing_ai, or a request's
        session ("ip|ua") has no label (the message names the session).
    load_dataset(data_dir: Path) -> dict[str, Split]
        Loads data_dir/"tune" and data_dir/"test". Raises DatasetError (message names the session)
        when one session_id is labeled in both splits.
"""

from __future__ import annotations

import json
from dataclasses import fields
from pathlib import Path

import pytest
from helpers import caddy_line, caddy_runtime_line

from engine.models import Label, Request
from eval.dataset import DatasetError, Split, load_dataset, load_split
from eval.synthetic import synthetic_humans
from eval.synthetic import write_pair as write_synthetic_pair

HUMAN_UA = "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0"
SCANNER_UA = "Fuzz Faster U Fool v2.1.0"
HUMAN_IP = "203.0.113.10"
SCANNER_IP = "198.51.100.20"
HUMAN = f"{HUMAN_IP}|{HUMAN_UA}"
SCANNER = f"{SCANNER_IP}|{SCANNER_UA}"


def line(ts: float, ip: str, ua: str, uri: str, status: int = 200) -> str:
    return caddy_line(ts=ts, uri=uri, status=status, user_agent=ua, client_ip=ip, remote_ip=ip)


def write_pair(
    directory: Path,
    name: str,
    lines: list[str],
    sessions: dict[str, str] | None,
) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{name}.jsonl").write_text("".join(f"{item}\n" for item in lines))
    if sessions is None:
        return
    labels = {"source": name, "synthetic": True, "notes": "test fixture", "sessions": sessions}
    (directory / f"{name}.labels.json").write_text(json.dumps(labels))


def human_lines() -> list[str]:
    return [
        line(100.0, HUMAN_IP, HUMAN_UA, "/"),
        line(104.5, HUMAN_IP, HUMAN_UA, "/products/7?ref=home"),
    ]


def scanner_lines() -> list[str]:
    return [
        line(101.0, SCANNER_IP, SCANNER_UA, "/.env", 404),
        line(101.2, SCANNER_IP, SCANNER_UA, "/admin", 404),
        line(101.4, SCANNER_IP, SCANNER_UA, "/backup.sql", 404),
    ]


def test_load_split_reads_pair(tmp_path: Path) -> None:
    write_pair(tmp_path, "volunteers", human_lines(), {HUMAN: "human"})
    split = load_split(tmp_path)
    assert isinstance(split, Split)
    assert split.labels == {HUMAN: "human"}
    assert [r.path for r in split.requests] == ["/", "/products/7"]
    assert split.requests[1].query == "ref=home"
    assert {r.session_id for r in split.requests} == {HUMAN}


def test_load_split_merges_several_pairs(tmp_path: Path) -> None:
    write_pair(tmp_path, "volunteers", human_lines(), {HUMAN: "human"})
    write_pair(tmp_path, "ffuf", scanner_lines(), {SCANNER: "probing"})
    split = load_split(tmp_path)
    assert split.labels == {HUMAN: "human", SCANNER: "probing"}
    assert len(split.requests) == 5


def test_load_split_orders_requests_by_ts_across_files(tmp_path: Path) -> None:
    write_pair(tmp_path, "a_scanner", scanner_lines(), {SCANNER: "probing"})
    write_pair(tmp_path, "b_humans", human_lines(), {HUMAN: "human"})
    split = load_split(tmp_path)
    stamps = [r.ts for r in split.requests]
    assert stamps == sorted(stamps)
    assert stamps == [100.0, 101.0, 101.2, 101.4, 104.5]


def test_load_split_accepts_all_three_labels(tmp_path: Path) -> None:
    agent_ip, agent_ua = "192.0.2.30", "python-httpx/0.27"
    agent = f"{agent_ip}|{agent_ua}"
    lines = [*human_lines(), *scanner_lines(), line(102.0, agent_ip, agent_ua, "/robots.txt")]
    sessions: dict[str, str] = {HUMAN: "human", SCANNER: "probing", agent: "probing_ai"}
    write_pair(tmp_path, "mixed", lines, sessions)
    expected: dict[str, Label] = {HUMAN: "human", SCANNER: "probing", agent: "probing_ai"}
    assert load_split(tmp_path).labels == expected


def test_load_split_ignores_non_access_lines(tmp_path: Path) -> None:
    lines = [caddy_runtime_line("serving initial configuration"), *human_lines(), "not json"]
    write_pair(tmp_path, "volunteers", lines, {HUMAN: "human"})
    assert len(load_split(tmp_path).requests) == 2


def test_load_split_ignores_files_that_are_not_pairs_of_jsonl(tmp_path: Path) -> None:
    write_pair(tmp_path, "volunteers", human_lines(), {HUMAN: "human"})
    (tmp_path / "README.txt").write_text("notes about this split\n")
    assert len(load_split(tmp_path).requests) == 2


def test_missing_labels_file_is_rejected(tmp_path: Path) -> None:
    write_pair(tmp_path, "volunteers", human_lines(), None)
    with pytest.raises(DatasetError, match="volunteers"):
        load_split(tmp_path)


def test_request_with_unlabeled_session_is_rejected(tmp_path: Path) -> None:
    write_pair(tmp_path, "mixed", [*human_lines(), *scanner_lines()], {HUMAN: "human"})
    with pytest.raises(DatasetError) as caught:
        load_split(tmp_path)
    assert SCANNER in str(caught.value)


def test_label_from_another_file_does_not_cover_a_session(tmp_path: Path) -> None:
    write_pair(tmp_path, "a_humans", human_lines(), {HUMAN: "human", SCANNER: "probing"})
    write_pair(tmp_path, "b_scanner", scanner_lines(), {})
    with pytest.raises(DatasetError, match="b_scanner|" + SCANNER_IP):
        load_split(tmp_path)


def test_unknown_label_value_is_rejected(tmp_path: Path) -> None:
    write_pair(tmp_path, "ffuf", scanner_lines(), {SCANNER: "bot"})
    with pytest.raises(DatasetError):
        load_split(tmp_path)


def test_dataset_error_is_a_value_error() -> None:
    assert issubclass(DatasetError, ValueError)


def test_load_dataset_returns_both_splits(tmp_path: Path) -> None:
    write_pair(tmp_path / "tune", "volunteers", human_lines(), {HUMAN: "human"})
    write_pair(tmp_path / "test", "ffuf", scanner_lines(), {SCANNER: "probing"})
    splits = load_dataset(tmp_path)
    assert set(splits) == {"tune", "test"}
    assert splits["tune"].labels == {HUMAN: "human"}
    assert splits["test"].labels == {SCANNER: "probing"}


def test_session_in_both_tune_and_test_is_rejected(tmp_path: Path) -> None:
    write_pair(tmp_path / "tune", "volunteers", human_lines(), {HUMAN: "human"})
    later_human = [line(900.0, HUMAN_IP, HUMAN_UA, "/cart")]
    write_pair(tmp_path / "test", "volunteers2", later_human, {HUMAN: "human"})
    with pytest.raises(DatasetError) as caught:
        load_dataset(tmp_path)
    assert HUMAN in str(caught.value)


def test_same_ip_with_other_user_agent_is_a_different_session(tmp_path: Path) -> None:
    other_ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Safari/604.1"
    write_pair(tmp_path / "tune", "volunteers", human_lines(), {HUMAN: "human"})
    phone = [line(900.0, HUMAN_IP, other_ua, "/cart")]
    write_pair(tmp_path / "test", "phone", phone, {f"{HUMAN_IP}|{other_ua}": "human"})
    splits = load_dataset(tmp_path)
    assert len(splits["test"].requests) == 1


def test_synthetic_pair_round_trips_through_load_split(tmp_path: Path) -> None:
    patterns: list[dict[str, object]] = [
        {"pattern": "/"},
        {"pattern": "/search"},
        {"pattern": "/products/{id}"},
        {"pattern": "/static/**", "asset": True},
    ]
    sessions = synthetic_humans(patterns, 12, seed=4)
    write_synthetic_pair(tmp_path, "synthetic_humans", sessions, "generated")
    split = load_split(tmp_path)
    logged = sorted((r for s in sessions for r in s), key=lambda r: r.ts)
    # The log line keeps the status; the parsed Request drops it, because no rule reads it.
    expected = [Request(**{f.name: getattr(r, f.name) for f in fields(Request)}) for r in logged]
    assert split.requests == expected
    assert set(split.labels.values()) == {"human"}
    assert len(split.labels) == 12
    assert split.synthetic == {"synthetic_humans": True}
    assert set(split.sources.values()) == {"synthetic_humans"}
    meta = json.loads((tmp_path / "synthetic_humans.labels.json").read_text())
    assert meta["synthetic"] is True


def test_split_records_source_of_each_session(tmp_path: Path) -> None:
    write_pair(tmp_path, "volunteers", human_lines(), {HUMAN: "human"})
    write_pair(tmp_path, "ffuf", scanner_lines(), {SCANNER: "probing"})
    split = load_split(tmp_path)
    assert split.sources == {HUMAN: "volunteers", SCANNER: "ffuf"}
    assert split.synthetic == {"volunteers": True, "ffuf": True}


def test_invalid_labels_json_is_rejected(tmp_path: Path) -> None:
    write_pair(tmp_path, "volunteers", human_lines(), None)
    (tmp_path / "volunteers.labels.json").write_text("{not json")
    with pytest.raises(DatasetError, match="volunteers"):
        load_split(tmp_path)


def test_labels_without_sessions_object_are_rejected(tmp_path: Path) -> None:
    write_pair(tmp_path, "volunteers", human_lines(), None)
    (tmp_path / "volunteers.labels.json").write_text('{"source": "x"}')
    with pytest.raises(DatasetError, match="sessions"):
        load_split(tmp_path)


def test_one_session_with_two_labels_is_rejected(tmp_path: Path) -> None:
    write_pair(tmp_path, "a", human_lines(), {HUMAN: "human"})
    write_pair(tmp_path, "b", [line(200.0, HUMAN_IP, HUMAN_UA, "/cart")], {HUMAN: "probing"})
    with pytest.raises(DatasetError, match=HUMAN_IP):
        load_split(tmp_path)
