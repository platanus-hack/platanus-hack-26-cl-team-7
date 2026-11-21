"""The pytest floor plugin: skipped, xfailed and xpassed tests fail the run.

Tokens are split so that this file never matches the check_floor rules.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.check_floor import find_violations
from scripts.pytest_floor import MESSAGE, reject_skip

REPO = Path(__file__).resolve().parents[1]
SK = "sk" + "ip"
XF = "x" + "fail"
HELD = "was" + XF

BYPASSES = f"""\
import unittest

import pytest as pt
from pytest import mark


@mark.{SK}(reason="alias")
def test_alias() -> None:
    assert False


def test_import_or() -> None:
    pt.importor{SK}("module_that_does_not_exist_anywhere")


@mark.{XF}(reason="known")
def test_expected() -> None:
    assert False


@mark.{XF}(reason="passes anyway")
def test_unexpected_pass() -> None:
    assert True


class Old(unittest.TestCase):
    @unittest.{SK}("later")
    def test_old(self) -> None:
        self.fail("never runs")


def test_fine() -> None:
    assert True
"""


def run_pytest(tmp_path: Path, *plugin: str) -> subprocess.CompletedProcess[str]:
    (tmp_path / "test_bypass.py").write_text(BYPASSES)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("COV", "PYTEST"))}
    env["PYTHONPATH"] = str(REPO)
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", *plugin, "-rA"],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )


def test_without_the_plugin_these_spellings_stay_green(tmp_path: Path) -> None:
    result = run_pytest(tmp_path)
    assert result.returncode == 0, result.stdout


def test_plugin_fails_every_skip_and_xfail_spelling(tmp_path: Path) -> None:
    result = run_pytest(tmp_path, "-p", "scripts.pytest_floor")
    assert result.returncode == 1, result.stdout
    assert result.stdout.count(MESSAGE) >= 5
    summary = result.stdout.strip().splitlines()[-1]
    # A skip marker is evaluated in setup, so that test reports as an error, not a failure.
    assert "4 failed, 1 passed, 1 error" in summary
    assert SK not in summary
    assert XF not in summary
    assert "xpass" not in summary


def test_plugin_is_loaded_for_this_suite(request: pytest.FixtureRequest) -> None:
    assert request.config.pluginmanager.has_plugin("scripts.pytest_floor")


def report(outcome: str, longrepr: object = None) -> pytest.TestReport:
    return pytest.TestReport(
        "tests/test_x.py::test_x", ("tests/test_x.py", 1, "test_x"), {}, outcome, longrepr, "call"
    )


def test_skipped_report_becomes_failed_with_reason() -> None:
    item = report(f"{SK}ped", ("tests/test_x.py", 3, f"{SK}ped: later"))
    reject_skip(item)
    assert item.outcome == "failed"
    assert item.longrepr == f"{MESSAGE}: {SK}ped: later"


def test_xfailed_and_xpassed_reports_become_failed() -> None:
    for outcome in (f"{SK}ped", "passed"):
        item = report(outcome)
        setattr(item, HELD, "reason: known bug")
        reject_skip(item)
        assert item.outcome == "failed"
        assert not hasattr(item, HELD)
        assert item.longrepr == f"{MESSAGE}: reason: known bug"


def test_passed_and_failed_reports_are_unchanged() -> None:
    for outcome in ("passed", "failed"):
        item = report(outcome, "kept")
        reject_skip(item)
        assert (item.outcome, item.longrepr) == (outcome, "kept")


def test_skipped_collect_report_becomes_failed() -> None:
    item = pytest.CollectReport("tests/test_x.py", f"{SK}ped", "module gone", [])
    reject_skip(item)
    assert item.outcome == "failed"
    assert item.longrepr == f"{MESSAGE}: module gone"


def test_plugin_source_passes_the_floor() -> None:
    source = (REPO / "scripts" / "pytest_floor.py").read_text().splitlines()
    diff = "\n".join(
        ["--- /dev/null", "+++ b/scripts/pytest_floor.py", f"@@ -0,0 +1,{len(source)} @@"]
        + [f"+{line}" for line in source]
    )
    assert find_violations(diff + "\n") == []
