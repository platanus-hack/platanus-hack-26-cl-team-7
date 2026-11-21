"""Reject added Python lines that lower the quality floor (suppressions, skips, stubs).

Reads a unified diff. `make floor` builds it from git: <base>...HEAD, uncommitted changes
against HEAD and untracked Python files.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

HUNK = re.compile(r"^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")

# Tokens are split so that this file never matches its own rules.
RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("noqa", re.compile(r"#\s*" + "no" + "qa", re.IGNORECASE)),
    ("type-ignore", re.compile(r"#\s*type:\s*" + "ig" + "nore")),
    ("no-cover", re.compile(r"pragma:\s*no\s*" + "co" + "ver")),
    ("skip", re.compile(r"\bpytest\.(?:mark\.sk" + r"ip(?:if)?\b|sk" + r"ip\s*\()")),
    ("xfail", re.compile(r"\bpytest\.(?:mark\.x" + r"fail\b|x" + r"fail\s*\()")),
    ("not-implemented", re.compile(r"\braise\s+NotImpl" + r"ementedError\b")),
)


@dataclass(frozen=True)
class AddedLine:
    path: str
    lineno: int
    text: str


@dataclass(frozen=True)
class Violation:
    path: str
    lineno: int
    rule: str
    text: str


@dataclass
class _Hunk:
    path: str | None
    lineno: int
    old_left: int
    new_left: int

    def active(self) -> bool:
        return self.old_left > 0 or self.new_left > 0


def _target_path(line: str) -> str | None:
    target = line[4:].split("\t", maxsplit=1)[0].strip()
    if target == "/dev/null":
        return None
    return target[2:] if target.startswith("b/") else target


def _open_hunk(line: str, path: str | None) -> _Hunk | None:
    found = HUNK.match(line)
    if found is None:
        return None
    old_count, start, new_count = found.groups()
    return _Hunk(
        path=path,
        lineno=int(start),
        old_left=1 if old_count is None else int(old_count),
        new_left=1 if new_count is None else int(new_count),
    )


def _consume(hunk: _Hunk, line: str) -> AddedLine | None:
    marker = line[:1]
    if marker == "+":
        added = AddedLine(path=hunk.path, lineno=hunk.lineno, text=line[1:]) if hunk.path else None
        hunk.lineno += 1
        hunk.new_left -= 1
        return added
    if marker == "-":
        hunk.old_left -= 1
        return None
    if marker != "\\":
        hunk.lineno += 1
        hunk.new_left -= 1
        hunk.old_left -= 1
    return None


def added_lines(diff: str) -> list[AddedLine]:
    result: list[AddedLine] = []
    path: str | None = None
    hunk: _Hunk | None = None
    for line in diff.splitlines():
        if hunk is not None and hunk.active():
            added = _consume(hunk, line)
            if added is not None:
                result.append(added)
        elif line.startswith("diff --git "):
            path = None
        elif line.startswith("+++ "):
            path = _target_path(line)
        elif line.startswith("@@"):
            hunk = _open_hunk(line, path)
    return result


def find_violations(diff: str) -> list[Violation]:
    found: list[Violation] = []
    for added in added_lines(diff):
        if not added.path.endswith(".py"):
            continue
        for rule, pattern in RULES:
            if pattern.search(added.text):
                found.append(Violation(added.path, added.lineno, rule, added.text))
    return found


def _read_diff(source: str) -> str:
    return sys.stdin.read() if source == "-" else Path(source).read_text()


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--diff", "--diff-file", dest="diff", required=True, help="unified diff file, - for stdin"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    diff = _read_diff(args.diff)
    violations = find_violations(diff)
    for violation in violations:
        print(f"{violation.path}:{violation.lineno}: {violation.rule}: {violation.text.strip()}")
    if violations:
        print(f"check_floor: {len(violations)} floor violation(s)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
