"""Shared fixtures. Puts the repo root on sys.path so the packages import without install."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


@pytest.fixture
def repo_root() -> Path:
    return REPO_ROOT


@pytest.fixture
def rules_path() -> Path:
    return REPO_ROOT / "config" / "rules.yaml"


@pytest.fixture
def log_path(tmp_path: Path) -> Path:
    path = tmp_path / "access.log"
    path.touch()
    return path
