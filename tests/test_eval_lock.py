"""Test-set hash lock: eval.lock.

Interface the implementer must meet (eval/lock.py):
    write_lock(test_dir: Path, lock_path: Path) -> None
        Writes one "<sha256 hex>  <path relative to test_dir, posix>" line per file under test_dir
        (recursive), sorted by path, each line ending in "\\n" (sha256sum -c compatible).
    verify_lock(test_dir: Path, lock_path: Path) -> list[str]
        Returns problems, [] when the files match the lock exactly. A changed, added, removed or
        renamed file is a problem whose text names the relative path. A missing lock file is a
        problem, not an exception.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from eval.__main__ import main
from eval.lock import verify_lock, write_lock


@pytest.fixture
def test_dir(tmp_path: Path) -> Path:
    root = tmp_path / "data" / "test"
    (root / "scanners").mkdir(parents=True)
    (root / "volunteers.jsonl").write_bytes(b'{"ts": 1}\n{"ts": 2}\n')
    (root / "volunteers.labels.json").write_bytes(b'{"sessions": {}}\n')
    (root / "scanners" / "ffuf.jsonl").write_bytes(b'{"ts": 3}\n')
    return root


@pytest.fixture
def lock_path(tmp_path: Path) -> Path:
    return tmp_path / "testset.lock"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_lock_then_verify_passes(test_dir: Path, lock_path: Path) -> None:
    write_lock(test_dir, lock_path)
    assert verify_lock(test_dir, lock_path) == []


def test_lock_format_is_sorted_sha256_lines(test_dir: Path, lock_path: Path) -> None:
    write_lock(test_dir, lock_path)
    names = ["scanners/ffuf.jsonl", "volunteers.jsonl", "volunteers.labels.json"]
    expected = "".join(f"{digest(test_dir / name)}  {name}\n" for name in names)
    assert lock_path.read_text() == expected


def test_lock_is_deterministic(test_dir: Path, lock_path: Path, tmp_path: Path) -> None:
    write_lock(test_dir, lock_path)
    again = tmp_path / "again.lock"
    write_lock(test_dir, again)
    assert lock_path.read_bytes() == again.read_bytes()


def test_one_changed_byte_fails(test_dir: Path, lock_path: Path) -> None:
    write_lock(test_dir, lock_path)
    target = test_dir / "volunteers.jsonl"
    data = bytearray(target.read_bytes())
    data[3] ^= 0x01
    target.write_bytes(bytes(data))
    problems = verify_lock(test_dir, lock_path)
    assert problems != []
    assert any("volunteers.jsonl" in item for item in problems)


def test_change_in_nested_file_fails(test_dir: Path, lock_path: Path) -> None:
    write_lock(test_dir, lock_path)
    (test_dir / "scanners" / "ffuf.jsonl").write_bytes(b'{"ts": 4}\n')
    problems = verify_lock(test_dir, lock_path)
    assert any("scanners/ffuf.jsonl" in item for item in problems)


def test_appended_line_fails(test_dir: Path, lock_path: Path) -> None:
    write_lock(test_dir, lock_path)
    with (test_dir / "volunteers.jsonl").open("ab") as handle:
        handle.write(b'{"ts": 9}\n')
    assert verify_lock(test_dir, lock_path) != []


def test_added_file_fails(test_dir: Path, lock_path: Path) -> None:
    write_lock(test_dir, lock_path)
    (test_dir / "extra.jsonl").write_bytes(b"")
    problems = verify_lock(test_dir, lock_path)
    assert any("extra.jsonl" in item for item in problems)


def test_removed_file_fails(test_dir: Path, lock_path: Path) -> None:
    write_lock(test_dir, lock_path)
    (test_dir / "volunteers.labels.json").unlink()
    problems = verify_lock(test_dir, lock_path)
    assert any("volunteers.labels.json" in item for item in problems)


def test_renamed_file_fails(test_dir: Path, lock_path: Path) -> None:
    write_lock(test_dir, lock_path)
    (test_dir / "volunteers.jsonl").rename(test_dir / "humans.jsonl")
    problems = verify_lock(test_dir, lock_path)
    assert any("humans.jsonl" in item for item in problems)
    assert any("volunteers.jsonl" in item for item in problems)


def test_missing_lock_file_is_a_problem(test_dir: Path, lock_path: Path) -> None:
    assert verify_lock(test_dir, lock_path) != []


def test_edited_lock_file_fails(test_dir: Path, lock_path: Path) -> None:
    write_lock(test_dir, lock_path)
    lines = lock_path.read_text().splitlines(keepends=True)
    lock_path.write_text("".join(lines[1:]))
    assert verify_lock(test_dir, lock_path) != []


def test_relock_after_change_passes_again(test_dir: Path, lock_path: Path) -> None:
    write_lock(test_dir, lock_path)
    (test_dir / "volunteers.jsonl").write_bytes(b'{"ts": 5}\n')
    assert verify_lock(test_dir, lock_path) != []
    write_lock(test_dir, lock_path)
    assert verify_lock(test_dir, lock_path) == []


def test_malformed_lock_line_is_a_problem(test_dir: Path, lock_path: Path) -> None:
    write_lock(test_dir, lock_path)
    with lock_path.open("a") as handle:
        handle.write("not a hash line\n")
    assert any("malformed" in item for item in verify_lock(test_dir, lock_path))


def test_cli_lock_and_verify_lock(
    test_dir: Path, lock_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    paths = ["--test-dir", str(test_dir), "--lock", str(lock_path)]
    assert main(["lock", *paths]) == 0
    assert main(["verify-lock", *paths]) == 0
    (test_dir / "volunteers.jsonl").write_bytes(b"changed\n")
    assert main(["verify-lock", *paths]) == 1
    assert "volunteers.jsonl" in capsys.readouterr().err


def test_cli_verify_lock_without_lock_file_fails(test_dir: Path, lock_path: Path) -> None:
    assert main(["verify-lock", "--test-dir", str(test_dir), "--lock", str(lock_path)]) == 1
