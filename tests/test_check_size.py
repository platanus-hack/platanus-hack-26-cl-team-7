import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

from scripts.check_size import (
    ConfigError,
    SizeConfig,
    SizeException,
    SizeViolation,
    find_violations,
    load_config,
    main,
)

REPO = Path(__file__).resolve().parents[1]
TODAY = date(2026, 11, 21)
TODAY_ARG = ["--today", "2026-11-21"]
BASE = """[tool.check_size]
source_limit = 200
test_limit = 300
roots = ["engine", "scripts", "tests"]
"""


def write_lines(path: Path, count: int, trailing_newline: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = "\n".join(f"x_{i} = {i}" for i in range(count))
    path.write_text(body + ("\n" if trailing_newline and count else ""))


def write_pyproject(root: Path, exceptions: str = "exceptions = []") -> Path:
    path = root / "pyproject.toml"
    path.write_text(BASE + exceptions + "\n")
    return path


def config_for(root: Path, exceptions: str = "exceptions = []") -> SizeConfig:
    return load_config(write_pyproject(root, exceptions), TODAY)


def violations(root: Path, exceptions: str = "exceptions = []") -> list[SizeViolation]:
    return find_violations(root, config_for(root, exceptions))


def run_main(root: Path) -> int:
    return main(["--root", str(root), *TODAY_ARG])


def one_exception(**fields: str | int) -> str:
    inner = ", ".join(
        f'{key} = "{value}"' if isinstance(value, str) else f"{key} = {value}"
        for key, value in fields.items()
    )
    return f"exceptions = [{{ {inner} }}]"


def test_load_config_reads_limits_and_roots(tmp_path: Path) -> None:
    config = config_for(tmp_path)
    assert config.source_limit == 200
    assert config.test_limit == 300
    assert tuple(config.roots) == ("engine", "scripts", "tests")
    assert tuple(config.exceptions) == ()


def test_repository_pyproject_is_valid() -> None:
    config = load_config(REPO / "pyproject.toml", TODAY)
    assert config.source_limit == 200
    assert config.test_limit == 300
    assert "engine" in config.roots
    assert "tests" in config.roots


def test_source_file_of_200_lines_passes(tmp_path: Path) -> None:
    write_lines(tmp_path / "engine" / "ok.py", 200)
    assert violations(tmp_path) == []
    assert run_main(tmp_path) == 0


def test_source_file_of_201_lines_fails(tmp_path: Path) -> None:
    write_lines(tmp_path / "engine" / "big.py", 201)
    assert violations(tmp_path) == [SizeViolation(path="engine/big.py", lines=201, limit=200)]
    assert run_main(tmp_path) == 1


def test_test_file_of_300_lines_passes(tmp_path: Path) -> None:
    write_lines(tmp_path / "tests" / "test_ok.py", 300)
    assert violations(tmp_path) == []
    assert run_main(tmp_path) == 0


def test_test_file_of_301_lines_fails(tmp_path: Path) -> None:
    write_lines(tmp_path / "tests" / "test_big.py", 301)
    assert violations(tmp_path) == [SizeViolation(path="tests/test_big.py", lines=301, limit=300)]
    assert run_main(tmp_path) == 1


def test_source_file_between_limits_fails_outside_tests(tmp_path: Path) -> None:
    write_lines(tmp_path / "scripts" / "tool.py", 250)
    write_lines(tmp_path / "tests" / "test_fine.py", 250)
    assert violations(tmp_path) == [SizeViolation(path="scripts/tool.py", lines=250, limit=200)]


def test_nested_source_file_is_checked(tmp_path: Path) -> None:
    write_lines(tmp_path / "engine" / "rules" / "deep.py", 201)
    assert [v.path for v in violations(tmp_path)] == ["engine/rules/deep.py"]


def test_blank_and_comment_lines_count(tmp_path: Path) -> None:
    path = tmp_path / "engine" / "sparse.py"
    path.parent.mkdir(parents=True)
    path.write_text("x = 1\n" + "\n" * 100 + "# note\n" * 100)
    assert violations(tmp_path) == [SizeViolation(path="engine/sparse.py", lines=201, limit=200)]


def test_missing_trailing_newline_still_counts_last_line(tmp_path: Path) -> None:
    write_lines(tmp_path / "engine" / "tail.py", 201, trailing_newline=False)
    assert [v.lines for v in violations(tmp_path)] == [201]


def test_only_python_files_are_counted(tmp_path: Path) -> None:
    write_lines(tmp_path / "engine" / "page.html", 900)
    write_lines(tmp_path / "engine" / "data.yaml", 900)
    assert violations(tmp_path) == []


def test_files_outside_roots_are_ignored(tmp_path: Path) -> None:
    write_lines(tmp_path / "elsewhere" / "huge.py", 900)
    write_lines(tmp_path / "huge_top_level.py", 900)
    assert violations(tmp_path) == []


def test_missing_root_directory_is_skipped(tmp_path: Path) -> None:
    write_lines(tmp_path / "engine" / "ok.py", 10)
    assert violations(tmp_path) == []
    assert run_main(tmp_path) == 0


def test_violations_are_sorted_by_path(tmp_path: Path) -> None:
    write_lines(tmp_path / "scripts" / "z.py", 201)
    write_lines(tmp_path / "engine" / "b.py", 201)
    write_lines(tmp_path / "engine" / "a.py", 201)
    paths = [v.path for v in violations(tmp_path)]
    assert paths == ["engine/a.py", "engine/b.py", "scripts/z.py"]


def test_main_reports_offending_path(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    write_pyproject(tmp_path)
    write_lines(tmp_path / "engine" / "big.py", 201)
    assert run_main(tmp_path) == 1
    captured = capsys.readouterr()
    output = captured.out + captured.err
    assert "engine/big.py" in output
    assert "201" in output
    assert "200" in output


def test_valid_exception_raises_limit_for_that_path(tmp_path: Path) -> None:
    write_lines(tmp_path / "engine" / "big.py", 250)
    write_lines(tmp_path / "engine" / "other.py", 250)
    exc = one_exception(path="engine/big.py", limit=260, owner="david", until="2026-12-31")
    assert violations(tmp_path, exc) == [
        SizeViolation(path="engine/other.py", lines=250, limit=200)
    ]


def test_exception_limit_is_itself_enforced(tmp_path: Path) -> None:
    write_lines(tmp_path / "engine" / "big.py", 261)
    exc = one_exception(path="engine/big.py", limit=260, owner="david", until="2026-12-31")
    assert violations(tmp_path, exc) == [SizeViolation(path="engine/big.py", lines=261, limit=260)]


def test_exception_is_parsed_into_typed_record(tmp_path: Path) -> None:
    exc = one_exception(path="engine/big.py", limit=260, owner="david", until="2026-12-31")
    config = config_for(tmp_path, exc)
    assert tuple(config.exceptions) == (
        SizeException(path="engine/big.py", limit=260, owner="david", until=date(2026, 12, 31)),
    )


def test_exception_ending_today_is_still_valid(tmp_path: Path) -> None:
    write_lines(tmp_path / "engine" / "big.py", 250)
    exc = one_exception(path="engine/big.py", limit=260, owner="david", until="2026-11-21")
    assert violations(tmp_path, exc) == []
    assert run_main(tmp_path) == 0


def test_exception_toml_date_literal_is_accepted(tmp_path: Path) -> None:
    exc = 'exceptions = [{ path = "engine/big.py", limit = 260, owner = "d", until = 2026-12-31 }]'
    config = config_for(tmp_path, exc)
    assert [e.until for e in config.exceptions] == [date(2026, 12, 31)]


@pytest.mark.parametrize(
    "fields",
    [
        {"path": "engine/big.py", "limit": 260, "until": "2026-12-31"},
        {"path": "engine/big.py", "limit": 260, "owner": "", "until": "2026-12-31"},
        {"path": "engine/big.py", "limit": 260, "owner": "   ", "until": "2026-12-31"},
    ],
    ids=["owner-missing", "owner-empty", "owner-blank"],
)
def test_exception_without_owner_is_rejected(tmp_path: Path, fields: dict[str, str | int]) -> None:
    with pytest.raises(ConfigError):
        config_for(tmp_path, one_exception(**fields))


@pytest.mark.parametrize(
    "fields",
    [
        {"path": "engine/big.py", "limit": 260, "owner": "david"},
        {"path": "engine/big.py", "limit": 260, "owner": "david", "until": ""},
        {"path": "engine/big.py", "limit": 260, "owner": "david", "until": "soon"},
        {"path": "engine/big.py", "limit": 260, "owner": "david", "until": "2026-13-40"},
    ],
    ids=["until-missing", "until-empty", "until-not-a-date", "until-impossible-date"],
)
def test_exception_without_valid_until_is_rejected(
    tmp_path: Path, fields: dict[str, str | int]
) -> None:
    with pytest.raises(ConfigError):
        config_for(tmp_path, one_exception(**fields))


@pytest.mark.parametrize("until", ["2026-11-20", "2025-01-01"])
def test_expired_exception_is_rejected(tmp_path: Path, until: str) -> None:
    exc = one_exception(path="engine/big.py", limit=260, owner="david", until=until)
    with pytest.raises(ConfigError):
        config_for(tmp_path, exc)


@pytest.mark.parametrize(
    "fields",
    [
        {"limit": 260, "owner": "david", "until": "2026-12-31"},
        {"path": "engine/big.py", "owner": "david", "until": "2026-12-31"},
        {"path": "engine/big.py", "limit": "260", "owner": "david", "until": "2026-12-31"},
    ],
    ids=["path-missing", "limit-missing", "limit-not-int"],
)
def test_exception_without_path_or_limit_is_rejected(
    tmp_path: Path, fields: dict[str, str | int]
) -> None:
    with pytest.raises(ConfigError):
        config_for(tmp_path, one_exception(**fields))


@pytest.mark.parametrize(
    "limits",
    ["source_limit = 201\ntest_limit = 300", "source_limit = 200\ntest_limit = 301"],
    ids=["source-weakened", "test-weakened"],
)
def test_weakened_base_limits_are_rejected(tmp_path: Path, limits: str) -> None:
    path = tmp_path / "pyproject.toml"
    path.write_text(f'[tool.check_size]\n{limits}\nroots = ["engine"]\nexceptions = []\n')
    with pytest.raises(ConfigError):
        load_config(path, TODAY)


def test_missing_check_size_table_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "pyproject.toml"
    path.write_text('[project]\nname = "x"\n')
    with pytest.raises(ConfigError):
        load_config(path, TODAY)


def test_main_exits_2_on_invalid_exception(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    write_pyproject(
        tmp_path, one_exception(path="engine/big.py", limit=260, owner="david", until="2026-11-20")
    )
    write_lines(tmp_path / "engine" / "ok.py", 10)
    assert run_main(tmp_path) == 2
    captured = capsys.readouterr()
    assert "engine/big.py" in captured.out + captured.err


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    script = REPO / "scripts" / "check_size.py"
    command = [sys.executable, str(script), *args]
    return subprocess.run(command, capture_output=True, text=True, check=False)


def test_script_runs_standalone_and_blocks_201_lines(tmp_path: Path) -> None:
    write_pyproject(tmp_path)
    write_lines(tmp_path / "engine" / "big.py", 201)
    result = run_script("--root", str(tmp_path), *TODAY_ARG)
    assert result.returncode == 1
    assert "engine/big.py" in result.stdout + result.stderr


def test_script_passes_clean_tree_with_default_today(tmp_path: Path) -> None:
    write_pyproject(tmp_path)
    write_lines(tmp_path / "engine" / "ok.py", 200)
    assert run_script("--root", str(tmp_path)).returncode == 0
