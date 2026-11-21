"""Block Python files that exceed the line limits in [tool.check_size] of pyproject.toml."""

from __future__ import annotations

import argparse
import sys
import tomllib
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

MAX_SOURCE_LIMIT = 200
MAX_TEST_LIMIT = 300


class ConfigError(Exception):
    """The [tool.check_size] table is missing, weakened or malformed."""


@dataclass(frozen=True)
class SizeException:
    path: str
    limit: int
    owner: str
    until: date


@dataclass(frozen=True)
class SizeConfig:
    source_limit: int
    test_limit: int
    roots: tuple[str, ...]
    exceptions: tuple[SizeException, ...]


@dataclass(frozen=True)
class SizeViolation:
    path: str
    lines: int
    limit: int


def _int_field(table: dict[str, Any], key: str, where: str) -> int:
    value = table.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ConfigError(f"{where}: '{key}' must be an integer")
    return value


def _parse_until(raw: object, where: str) -> date:
    if isinstance(raw, date):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        raise ConfigError(f"{where}: 'until' must be an ISO date (YYYY-MM-DD)")
    try:
        return date.fromisoformat(raw.strip())
    except ValueError as error:
        raise ConfigError(f"{where}: 'until' is not a valid date: {raw!r}") from error


def _parse_exception(raw: object, today: date) -> SizeException:
    if not isinstance(raw, dict):
        raise ConfigError("exception entries must be tables")
    path = raw.get("path")
    if not isinstance(path, str) or not path.strip():
        raise ConfigError("exception without a 'path'")
    where = f"exception for {path}"
    limit = _int_field(raw, "limit", where)
    owner = raw.get("owner")
    if not isinstance(owner, str) or not owner.strip():
        raise ConfigError(f"{where}: 'owner' is required")
    until = _parse_until(raw.get("until"), where)
    if until < today:
        raise ConfigError(f"{where}: expired on {until.isoformat()}")
    return SizeException(path=path.strip(), limit=limit, owner=owner.strip(), until=until)


def _read_table(pyproject: Path) -> dict[str, Any]:
    try:
        data = tomllib.loads(pyproject.read_text())
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise ConfigError(f"cannot read {pyproject}: {error}") from error
    table = data.get("tool", {}).get("check_size")
    if not isinstance(table, dict):
        raise ConfigError(f"{pyproject}: missing [tool.check_size] table")
    return table


def load_config(pyproject: Path, today: date) -> SizeConfig:
    table = _read_table(pyproject)
    source_limit = _int_field(table, "source_limit", "[tool.check_size]")
    test_limit = _int_field(table, "test_limit", "[tool.check_size]")
    if source_limit > MAX_SOURCE_LIMIT:
        raise ConfigError(f"source_limit {source_limit} is above {MAX_SOURCE_LIMIT}")
    if test_limit > MAX_TEST_LIMIT:
        raise ConfigError(f"test_limit {test_limit} is above {MAX_TEST_LIMIT}")
    roots = table.get("roots", [])
    if not isinstance(roots, list) or not all(isinstance(root, str) for root in roots):
        raise ConfigError("[tool.check_size]: 'roots' must be a list of strings")
    exceptions = table.get("exceptions", [])
    if not isinstance(exceptions, list):
        raise ConfigError("[tool.check_size]: 'exceptions' must be a list")
    return SizeConfig(
        source_limit=source_limit,
        test_limit=test_limit,
        roots=tuple(roots),
        exceptions=tuple(_parse_exception(raw, today) for raw in exceptions),
    )


def _is_test_file(relative: str) -> bool:
    return relative.startswith("tests/")


def _limit_for(relative: str, config: SizeConfig) -> int:
    for exception in config.exceptions:
        if exception.path == relative:
            return exception.limit
    return config.test_limit if _is_test_file(relative) else config.source_limit


def _python_files(root: Path, config: SizeConfig) -> set[Path]:
    files: set[Path] = set()
    for name in config.roots:
        base = root / name
        if base.is_dir():
            files.update(path for path in base.rglob("*.py") if path.is_file())
    return files


def find_violations(root: Path, config: SizeConfig) -> list[SizeViolation]:
    found: list[SizeViolation] = []
    for path in _python_files(root, config):
        relative = path.relative_to(root).as_posix()
        lines = len(path.read_text(errors="replace").splitlines())
        limit = _limit_for(relative, config)
        if lines > limit:
            found.append(SizeViolation(path=relative, lines=lines, limit=limit))
    return sorted(found, key=lambda violation: violation.path)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="repository root")
    parser.add_argument("--today", type=date.fromisoformat, default=None, help="YYYY-MM-DD")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    root: Path = args.root
    today: date = args.today or date.today()
    try:
        config = load_config(root / "pyproject.toml", today)
    except ConfigError as error:
        print(f"check_size: invalid config: {error}", file=sys.stderr)
        return 2
    violations = find_violations(root, config)
    for violation in violations:
        print(f"{violation.path}: {violation.lines} lines (limit {violation.limit})")
    if violations:
        print(f"check_size: {len(violations)} file(s) over the limit", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
