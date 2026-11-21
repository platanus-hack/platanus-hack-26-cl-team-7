"""Gate configuration: coverage file names, recorded lint exceptions, required diff base."""

import os
import re
import subprocess
import sys
import tomllib
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
PACKAGES = ("engine", "eval", "dashboard", "scripts", "demo")


def clean_env() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if not k.startswith(("COV", "PYTEST"))}


def coverage_filenames(tmp_path: Path) -> list[str]:
    script = tmp_path / "touch.py"
    script.write_text("".join(f"import {name}\n" for name in PACKAGES))
    data, report = tmp_path / ".coverage", tmp_path / "coverage.xml"
    base = [sys.executable, "-m", "coverage"]
    rc = ["--rcfile", str(REPO / "pyproject.toml"), f"--data-file={data}"]
    env = {**clean_env(), "PYTHONPATH": str(REPO)}
    for args in (["run", *rc, str(script)], ["xml", *rc, "-o", str(report)]):
        subprocess.run([*base, *args], cwd=REPO, env=env, check=True, capture_output=True)
    return [node.attrib["filename"] for node in ET.parse(report).iter("class")]


def test_coverage_xml_names_every_file_once_relative_to_the_repo(tmp_path: Path) -> None:
    names = coverage_filenames(tmp_path)
    assert len(names) == len(set(names))
    for name in ("engine/__init__.py", "dashboard/__main__.py", "engine/__main__.py"):
        assert name in names
    assert all(name.split("/", 1)[0] in PACKAGES for name in names)


def pyproject() -> dict[str, Any]:
    return tomllib.loads((REPO / "pyproject.toml").read_text())


def test_s311_is_ignored_only_where_constraints_records_it() -> None:
    lint = pyproject()["tool"]["ruff"]["lint"]
    ignored = sorted(path for path, codes in lint["per-file-ignores"].items() if "S311" in codes)
    assert ignored, "expected the recorded S311 exception"
    assert all(path.startswith("eval/") and "*" not in path for path in ignored)
    assert "S311" not in lint.get("ignore", [])
    constraints = (REPO / "CONSTRAINTS.md").read_text()
    row = next(line for line in constraints.splitlines() if line.startswith("| `S311`"))
    assert "team-7" in row
    assert "2027-05-21" in row
    assert sorted(re.findall(r"`(eval/[\w/]+\.py)`", row)) == ignored


def make(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["make", "-s", "-C", str(REPO), *args],
        env=clean_env(),
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )


def test_missing_base_fails_when_required() -> None:
    result = make("require-base", "BASE=refs/heads/no-such-base-ref", "REQUIRE_BASE=1")
    assert result.returncode != 0
    assert "no-such-base-ref" in result.stderr
    assert "REQUIRE_BASE" in result.stderr


def test_missing_base_is_allowed_locally() -> None:
    assert make("require-base", "BASE=refs/heads/no-such-base-ref").returncode == 0


def test_existing_base_passes_when_required() -> None:
    assert make("require-base", "BASE=HEAD", "REQUIRE_BASE=1").returncode == 0


def test_floor_and_test_targets_check_the_base_first() -> None:
    makefile = (REPO / "Makefile").read_text()
    for target in ("floor", "test"):
        assert re.search(rf"^{target}:.*\brequire-base\b", makefile, re.MULTILINE), target


def test_ci_requires_a_base_and_picks_it_per_event() -> None:
    workflow = (REPO / ".github" / "workflows" / "ci.yml").read_text()
    assert 'REQUIRE_BASE: "1"' in workflow
    assert "scripts/ci_base.sh" in workflow
    assert "github.event.before" in workflow
