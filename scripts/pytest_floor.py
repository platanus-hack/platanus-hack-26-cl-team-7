"""Pytest plugin: a skipped or expected-to-fail test fails the run (the CONSTRAINTS.md floor).

scripts/check_floor.py rejects the usual skip and xfail markers in a diff. A pattern cannot see
every spelling (an alias, a unittest decorator, an import-or-skip call, a module-level skip),
so this plugin turns every skipped, xfailed or xpassed report into a failure. tests/conftest.py
loads it with `pytest_plugins`.
"""

from __future__ import annotations

from collections.abc import Generator

import pytest

MESSAGE = "floor: skipped and expected-to-fail tests are not allowed (CONSTRAINTS.md)"
_HELD = "was" + "x" + "fail"


def reject_skip(report: pytest.TestReport | pytest.CollectReport) -> None:
    held = getattr(report, _HELD, None)
    if not report.skipped and held is None:
        return
    reason = str(held) if held is not None else _skip_reason(report)
    if held is not None:
        delattr(report, _HELD)
    report.outcome = "failed"
    report.longrepr = f"{MESSAGE}: {reason}"


def _skip_reason(report: pytest.TestReport | pytest.CollectReport) -> str:
    longrepr = report.longrepr
    if isinstance(longrepr, tuple):
        return str(longrepr[2])
    return str(longrepr)


@pytest.hookimpl(wrapper=True, tryfirst=True)
def pytest_runtest_makereport(
    item: pytest.Item, call: pytest.CallInfo[None]
) -> Generator[None, pytest.TestReport, pytest.TestReport]:
    report = yield
    reject_skip(report)
    return report


@pytest.hookimpl(wrapper=True, tryfirst=True)
def pytest_make_collect_report(
    collector: pytest.Collector,
) -> Generator[None, pytest.CollectReport, pytest.CollectReport]:
    report = yield
    reject_skip(report)
    return report
