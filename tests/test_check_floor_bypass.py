"""Floor bypasses: file-level suppressions and skip/xfail spellings beyond the literal markers.

Tokens are split so that this file never matches the rules it tests.
"""

from pathlib import Path

import pytest

from scripts.check_floor import Violation, find_violations

NOQA = "no" + "qa"
SK = "sk" + "ip"
XF = "x" + "fail"


def added_one(text: str, path: str = "engine/mod.py") -> list[Violation]:
    diff = "\n".join([f"--- a/{path}", f"+++ b/{path}", "@@ -1,1 +1,2 @@", " ctx = 0", f"+{text}"])
    return find_violations(diff + "\n")


FORBIDDEN = [
    (f"# ruff: {NOQA}", "noqa"),
    (f"# ruff: {NOQA}: E501", "noqa"),
    (f"#ruff:{NOQA}", "noqa"),
    (f"# flake8: {NOQA}", "noqa"),
    ("# my" + "py: ignore-errors", "checker-config"),
    ("# my" + "py: disable-error-code=arg-type", "checker-config"),
    ("# pyr" + "ight: ignore", "checker-config"),
    ("x = f()  # pyr" + "ight: ignore[reportGeneralTypeIssues]", "checker-config"),
    ("if debug:  # pragma: no bra" + "nch", "no-cover"),
    (f"@mark.{SK}", "skip"),
    (f"@mark.{SK}if(True, reason='x')", "skip"),
    (f"@pt.mark.{SK}(reason='later')", "skip"),
    (f"    pytest.importor{SK}('missing_module')", "skip"),
    (f"yaml = importor{SK}('yaml')", "skip"),
    (f"@unittest.{SK}('later')", "skip"),
    (f"@{SK}If(True, 'x')", "skip"),
    (f"@{SK}Unless(False, 'x')", "skip"),
    (f"@mark.{XF}", "xfail"),
    (f"@pt.mark.{XF}(strict=False)", "xfail"),
    ("@unittest.expected" + "Failure", "xfail"),
    ("collect_" + "ignore = ['test_old.py']", "collect-ignore"),
    ("collect_" + "ignore_glob = ['*_old.py']", "collect-ignore"),
]


@pytest.mark.parametrize(("text", "rule"), FORBIDDEN)
def test_bypass_spelling_is_rejected(text: str, rule: str) -> None:
    found = added_one(text)
    assert [v.rule for v in found] == [rule]
    assert (found[0].lineno, found[0].text) == (2, text)


ALLOWED = [
    "# ruff format keeps this line",
    "mypy_strict = True",
    "# see the mypy docs for strict mode",
    "pyright_path = 'node_modules'",
    "branch = True",
    "def skipped_lines(report: str) -> int:",
    f"{SK}_count = 0",
    "def collect_items() -> list[str]:",
    "expected = failures()",
    f"was{XF} = report.outcome",
]


@pytest.mark.parametrize("text", ALLOWED)
def test_ordinary_line_is_accepted(text: str) -> None:
    assert added_one(text) == []


def test_this_test_file_passes_its_own_floor() -> None:
    source = Path(__file__).read_text().splitlines()
    diff = "\n".join(
        ["--- /dev/null", "+++ b/tests/x.py", f"@@ -0,0 +1,{len(source)} @@"]
        + [f"+{line}" for line in source]
    )
    assert find_violations(diff + "\n") == []
