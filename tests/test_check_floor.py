import subprocess
import sys
from pathlib import Path

import pytest

from scripts.check_floor import AddedLine, Violation, added_lines, find_violations, main

REPO = Path(__file__).resolve().parents[1]
NOQA = "# " + "noqa"
TYPE_IGNORE = "# type" + ": ignore"
NO_COVER = "# pragma" + ": no cover"
MARK = "pytest" + ".mark."
NOT_IMPL = "raise " + "NotImplemented" + "Error"
XF = "x" + "fail"
SKIP_CALL = "pytest" + ".skip"


def file_diff(path: str, lines: list[str], start: int = 1) -> str:
    header = [
        f"diff --git a/{path} b/{path}",
        "index 1111111..2222222 100644",
        f"--- a/{path}",
        f"+++ b/{path}",
    ]
    added = sum(1 for line in lines if not line.startswith("-"))
    removed = sum(1 for line in lines if not line.startswith("+"))
    hunk = f"@@ -{start},{removed} +{start},{added} @@"
    return "\n".join([*header, hunk, *lines]) + "\n"


def new_file_diff(path: str, lines: list[str]) -> str:
    header = [
        f"diff --git a/{path} b/{path}",
        "new file mode 100644",
        "index 0000000..3333333",
        "--- /dev/null",
        f"+++ b/{path}",
        f"@@ -0,0 +1,{len(lines)} @@",
    ]
    return "\n".join([*header, *(f"+{line}" for line in lines)]) + "\n"


def added_one(text: str, path: str = "engine/mod.py") -> list[Violation]:
    return find_violations(file_diff(path, [" ctx = 0", f"+{text}"]))


def rules(diff: str) -> list[str]:
    return [v.rule for v in find_violations(diff)]


FORBIDDEN = [
    (f"x = 1  {NOQA}", "noqa"),
    (f"x = 1  {NOQA}: E501", "noqa"),
    (f"x = 1  #{NOQA[2:]}", "noqa"),
    (f"x = 1  # {NOQA[2:].upper()}", "noqa"),
    (f"y: int = f()  {TYPE_IGNORE}", "type-ignore"),
    (f"y: int = f()  {TYPE_IGNORE}[assignment]", "type-ignore"),
    (f"y: int = f()  #type:{TYPE_IGNORE.split(': ')[1]}", "type-ignore"),
    (f"if debug:  {NO_COVER}", "no-cover"),
    (f"if debug:  #pragma:no {NO_COVER.split('no ')[1]}", "no-cover"),
    (f"@{MARK}skip(reason='later')", "skip"),
    (f"@{MARK}skip", "skip"),
    (f"@{MARK}skipif(sys.platform == 'win32', reason='x')", "skip"),
    (f"    {SKIP_CALL}('not ready')", "skip"),
    (f"@{MARK}{XF}(reason='flaky')", XF),
    (f"@{MARK}{XF}", XF),
    (f"    pytest.{XF}('known bug')", XF),
    (f"    {NOT_IMPL}", "not-implemented"),
    (f"    {NOT_IMPL}('todo')", "not-implemented"),
    (f"    {NOT_IMPL}()", "not-implemented"),
]


@pytest.mark.parametrize(("text", "rule"), FORBIDDEN)
def test_forbidden_added_line_is_rejected(text: str, rule: str) -> None:
    found = added_one(text)
    assert [v.rule for v in found] == [rule]
    assert found[0].path == "engine/mod.py"
    assert found[0].lineno == 2
    assert found[0].text == text


ALLOWED = [
    f"{XF}_strict = True",
    "def skip_header(lines: list[str]) -> list[str]:",
    "skipped = 0",
    "return NotImplemented",
    "except NotImplementedError:",
    "ignore_case = True",
    "coverage = report.cover()",
    "pragma_value = 3",
    "noqa_count = 0",
    "@pytest.mark.parametrize('x', [1, 2])",
    "def test_something() -> None:",
]


@pytest.mark.parametrize("text", ALLOWED)
def test_ordinary_added_line_is_accepted(text: str) -> None:
    assert added_one(text) == []


@pytest.mark.parametrize(("text", "rule"), FORBIDDEN[::4])
def test_removed_forbidden_line_is_ignored(text: str, rule: str) -> None:
    diff = file_diff("engine/mod.py", [" ctx = 0", f"-{text}", "+clean = 1"])
    assert find_violations(diff) == []


@pytest.mark.parametrize(("text", "rule"), FORBIDDEN[::4])
def test_context_forbidden_line_is_ignored(text: str, rule: str) -> None:
    diff = file_diff("engine/mod.py", [f" {text}", "+clean = 1"])
    assert find_violations(diff) == []


def test_deleted_file_is_ignored() -> None:
    diff = "\n".join(
        [
            "diff --git a/engine/old.py b/engine/old.py",
            "deleted file mode 100644",
            "index 4444444..0000000",
            "--- a/engine/old.py",
            "+++ /dev/null",
            "@@ -1,2 +0,0 @@",
            f"-x = 1  {NOQA}",
            f"-    {NOT_IMPL}",
        ]
    )
    assert find_violations(diff + "\n") == []


def test_added_lines_tracks_new_file_line_numbers() -> None:
    diff = "\n".join(
        [
            "diff --git a/engine/a.py b/engine/a.py",
            "index 1111111..2222222 100644",
            "--- a/engine/a.py",
            "+++ b/engine/a.py",
            "@@ -10,3 +12,4 @@ def f():",
            " ctx1",
            f"-old = 0  {NOQA}",
            "+new = 1",
            " ctx2",
            f"+bad = 2  {NOQA}",
        ]
    )
    assert added_lines(diff + "\n") == [
        AddedLine(path="engine/a.py", lineno=13, text="new = 1"),
        AddedLine(path="engine/a.py", lineno=15, text=f"bad = 2  {NOQA}"),
    ]
    assert find_violations(diff + "\n") == [
        Violation(path="engine/a.py", lineno=15, rule="noqa", text=f"bad = 2  {NOQA}")
    ]


def test_multiple_hunks_restart_line_numbers() -> None:
    diff = "\n".join(
        [
            "diff --git a/engine/a.py b/engine/a.py",
            "--- a/engine/a.py",
            "+++ b/engine/a.py",
            "@@ -1,1 +1,2 @@",
            " a = 1",
            "+b = 2",
            "@@ -40,1 +41,2 @@",
            " c = 3",
            f"+d = 4  {TYPE_IGNORE}",
        ]
    )
    assert [(a.lineno, a.text) for a in added_lines(diff + "\n")] == [
        (2, "b = 2"),
        (42, f"d = 4  {TYPE_IGNORE}"),
    ]


def test_hunk_header_without_counts_is_parsed() -> None:
    diff = "\n".join(["--- a/engine/a.py", "+++ b/engine/a.py", "@@ -5 +7 @@", f"+z = 1  {NOQA}"])
    assert [(v.path, v.lineno) for v in find_violations(diff + "\n")] == [("engine/a.py", 7)]


def test_file_headers_are_not_added_lines() -> None:
    diff = new_file_diff("tests/test_new.py", ["def test_a() -> None:", "    assert True"])
    assert added_lines(diff) == [
        AddedLine(path="tests/test_new.py", lineno=1, text="def test_a() -> None:"),
        AddedLine(path="tests/test_new.py", lineno=2, text="    assert True"),
    ]


def test_new_file_violations_are_reported_per_file() -> None:
    diff = new_file_diff("engine/one.py", ["a = 1", f"b = 2  {NOQA}"]) + new_file_diff(
        "tests/test_two.py", [f"@{MARK}{XF}", "def test_x() -> None:", f"    {NOT_IMPL}"]
    )
    found = [(v.path, v.lineno, v.rule) for v in find_violations(diff)]
    assert found == [
        ("engine/one.py", 2, "noqa"),
        ("tests/test_two.py", 1, XF),
        ("tests/test_two.py", 3, "not-implemented"),
    ]


def test_only_python_files_are_checked() -> None:
    diff = (
        new_file_diff("CONSTRAINTS.md", [f"No `{NOQA}` comments.", f"No `{NOT_IMPL}`."])
        + new_file_diff("pyproject.toml", [f"note = '{TYPE_IGNORE}'"])
        + new_file_diff("engine/x.py", [f"v = 1  {NOQA}"])
    )
    assert [v.path for v in find_violations(diff)] == ["engine/x.py"]


def test_no_newline_marker_is_ignored() -> None:
    diff = file_diff("engine/a.py", ["-a = 1", "+a = 2"]) + "\\ No newline at end of file\n"
    assert find_violations(diff) == []
    assert [a.text for a in added_lines(diff)] == ["a = 2"]


def test_empty_diff_has_no_violations() -> None:
    assert added_lines("") == []
    assert find_violations("") == []


def test_line_with_two_markers_is_reported_once_per_rule() -> None:
    text = f"x = f()  {TYPE_IGNORE}  {NOQA}"
    assert sorted(v.rule for v in added_one(text)) == ["noqa", "type-ignore"]


def test_main_with_diff_file_fails_on_violation(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    patch = tmp_path / "change.diff"
    patch.write_text(new_file_diff("engine/bad.py", ["a = 1", f"b = 2  {NOQA}"]))
    assert main(["--diff", str(patch)]) == 1
    captured = capsys.readouterr()
    output = captured.out + captured.err
    assert "engine/bad.py:2" in output
    assert "noqa" in output


def test_main_with_clean_diff_file_passes(tmp_path: Path) -> None:
    patch = tmp_path / "change.diff"
    patch.write_text(
        file_diff("engine/ok.py", [f"-a = 1  {NOQA}", "+a = 1"])
        + new_file_diff("README.md", [f"Avoid {NOQA}."])
    )
    assert main(["--diff", str(patch)]) == 0


def test_script_reads_diff_from_stdin() -> None:
    script = REPO / "scripts" / "check_floor.py"
    diff = new_file_diff("tests/test_z.py", [f"@{MARK}skip", "def test_z() -> None:"])
    result = subprocess.run(
        [sys.executable, str(script), "--diff", "-"],
        input=diff,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert "tests/test_z.py:1" in result.stdout + result.stderr


def test_script_accepts_clean_stdin() -> None:
    script = REPO / "scripts" / "check_floor.py"
    result = subprocess.run(
        [sys.executable, str(script), "--diff", "-"],
        input=new_file_diff("engine/fine.py", ["value = 1"]),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0


def test_this_test_file_passes_its_own_floor() -> None:
    source = Path(__file__).read_text().splitlines()
    assert find_violations(new_file_diff("tests/test_check_floor.py", source)) == []
