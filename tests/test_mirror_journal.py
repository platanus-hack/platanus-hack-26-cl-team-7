"""mirror.journal: append-only JSONL with atomic appends, rewrites and renames."""

from __future__ import annotations

import json
import stat
import threading
from pathlib import Path

import pytest

from mirror.journal import Journal


def test_append_then_read_keeps_order_and_creates_owner_only_file(tmp_path: Path) -> None:
    journal = Journal(tmp_path / "run" / "log.jsonl")
    journal.append([{"n": 1}, {"n": 2}])
    journal.append([])
    journal.append([{"n": 3}])
    journal.close()
    assert journal.read() == [{"n": 1}, {"n": 2}, {"n": 3}]
    assert stat.S_IMODE(journal.path.stat().st_mode) == 0o600


def test_read_of_missing_file_is_empty(tmp_path: Path) -> None:
    assert Journal(tmp_path / "absent.jsonl").read() == []


def test_read_skips_torn_and_foreign_lines(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    path = tmp_path / "log.jsonl"
    path.write_text('{"n": 1}\n[1, 2]\nnot json\n\n{"n": 2}\n{"n": 3, "cut', encoding="utf-8")
    assert Journal(path).read() == [{"n": 1}, {"n": 2}]
    assert "skipped 3 unreadable line(s)" in caplog.text


def test_append_after_a_torn_line_starts_a_new_line(tmp_path: Path) -> None:
    path = tmp_path / "log.jsonl"
    path.write_bytes(b'{"n": 1}\n{"n": 2, "cut')
    journal = Journal(path)
    journal.append([{"n": 3}])
    journal.close()
    assert journal.read() == [{"n": 1}, {"n": 3}]


def test_append_to_a_clean_file_adds_no_blank_line(tmp_path: Path) -> None:
    path = tmp_path / "log.jsonl"
    path.write_bytes(b'{"n": 1}\n')
    journal = Journal(path)
    journal.append([{"n": 2}])
    journal.close()
    assert path.read_bytes() == b'{"n": 1}\n{"n":2}\n'


def test_rewrite_replaces_the_file_and_appends_continue_on_the_new_one(tmp_path: Path) -> None:
    journal = Journal(tmp_path / "log.jsonl")
    journal.append([{"n": 1}, {"n": 2}])
    journal.rewrite([{"n": 9}])
    journal.append([{"n": 10}])
    journal.close()
    assert journal.read() == [{"n": 9}, {"n": 10}]
    assert not (tmp_path / "log.jsonl.tmp").exists()


def test_move_to_renames_and_later_appends_start_a_new_file(tmp_path: Path) -> None:
    journal = Journal(tmp_path / "log.jsonl")
    assert journal.move_to(tmp_path / "moved.jsonl") is False
    journal.append([{"n": 1}])
    assert journal.move_to(tmp_path / "moved.jsonl") is True
    assert not journal.exists()
    journal.append([{"n": 2}])
    journal.close()
    assert Journal(tmp_path / "moved.jsonl").read() == [{"n": 1}]
    assert journal.read() == [{"n": 2}]


def test_remove_deletes_the_file_and_tolerates_absence(tmp_path: Path) -> None:
    journal = Journal(tmp_path / "log.jsonl")
    journal.append([{"n": 1}])
    journal.remove()
    journal.remove()
    assert not journal.exists()


def test_concurrent_appends_never_interleave(tmp_path: Path) -> None:
    journal = Journal(tmp_path / "log.jsonl")
    threads, per_thread = 8, 200
    payload = "x" * 300

    def writer(worker: int) -> None:
        for n in range(per_thread):
            journal.append([{"w": worker, "n": n, "pad": payload}])

    pool = [threading.Thread(target=writer, args=(w,)) for w in range(threads)]
    for thread in pool:
        thread.start()
    for thread in pool:
        thread.join()
    journal.close()
    lines = journal.path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == threads * per_thread
    records = [json.loads(line) for line in lines]
    for worker in range(threads):
        assert [r["n"] for r in records if r["w"] == worker] == list(range(per_thread))
