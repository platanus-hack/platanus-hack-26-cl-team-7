"""Hash lock for the test split: one sha256sum-style line per file."""

from __future__ import annotations

import hashlib
from pathlib import Path


def file_hashes(test_dir: Path) -> dict[str, str]:
    return {
        path.relative_to(test_dir).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(test_dir.rglob("*"))
        if path.is_file()
    }


def write_lock(test_dir: Path, lock_path: Path) -> None:
    hashes = file_hashes(test_dir)
    lines = [f"{hashes[name]}  {name}\n" for name in sorted(hashes)]
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text("".join(lines), encoding="utf-8")


def verify_lock(test_dir: Path, lock_path: Path) -> list[str]:
    if not lock_path.is_file():
        return [f"lock file missing: {lock_path}"]
    expected, problems = _read_lock(lock_path)
    actual = file_hashes(test_dir)
    for name in sorted(expected.keys() | actual.keys()):
        if name not in actual:
            problems.append(f"missing file: {name}")
        elif name not in expected:
            problems.append(f"file not in lock: {name}")
        elif expected[name] != actual[name]:
            problems.append(f"changed file: {name}")
    return problems


def _read_lock(lock_path: Path) -> tuple[dict[str, str], list[str]]:
    entries: dict[str, str] = {}
    problems: list[str] = []
    for number, line in enumerate(lock_path.read_text(encoding="utf-8").splitlines(), 1):
        digest, sep, name = line.partition("  ")
        if not sep or len(digest) != 64 or not name:
            problems.append(f"malformed lock line {number}: {line!r}")
            continue
        entries[name] = digest
    return entries, problems
