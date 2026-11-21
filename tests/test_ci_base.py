"""scripts/ci_base.sh: the diff base CI hands to `make floor` and `make test`.

Each test builds a scratch repository with git plumbing (no working tree commits).
"""

import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ci_base.sh"
ZERO = "0" * 40
IDENTITY = {
    "GIT_AUTHOR_NAME": "ci",
    "GIT_AUTHOR_EMAIL": "ci@example.invalid",
    "GIT_COMMITTER_NAME": "ci",
    "GIT_COMMITTER_EMAIL": "ci@example.invalid",
}


class Repo:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")} | IDENTITY
        self.git("init", "-q")
        self.tree = self.git("mktree", stdin="")

    def git(self, *args: str, stdin: str | None = None) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=self.root,
            env=self.env,
            input=stdin,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()

    def commit(self, message: str, *parents: str) -> str:
        flags = [arg for parent in parents for arg in ("-p", parent)]
        return self.git("commit-tree", self.tree, *flags, "-m", message)

    def point(self, head: str, main: str | None) -> None:
        self.git("update-ref", "--no-deref", "HEAD", head)
        if main is not None:
            self.git("update-ref", "refs/remotes/origin/main", main)

    def base(self, event: str, base_ref: str = "", before: str = "") -> tuple[int, str, str]:
        result = subprocess.run(
            ["bash", str(SCRIPT), event, base_ref, before],
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        return result.returncode, result.stdout.strip(), result.stderr


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    return Repo(tmp_path)


def test_push_to_main_compares_with_the_commit_before_the_push(repo: Repo) -> None:
    first = repo.commit("one")
    second = repo.commit("two", first)
    third = repo.commit("three", second)
    repo.point(third, main=third)
    assert repo.base("push", before=first) == (0, first, "")


@pytest.mark.parametrize("before", ["", ZERO, "1234567890abcdef1234567890abcdef12345678"])
def test_push_to_main_without_a_usable_before_uses_the_parent(repo: Repo, before: str) -> None:
    first = repo.commit("one")
    second = repo.commit("two", first)
    repo.point(second, main=second)
    assert repo.base("push", before=before) == (0, first, "")


def test_push_where_before_equals_head_uses_the_parent(repo: Repo) -> None:
    first = repo.commit("one")
    second = repo.commit("two", first)
    repo.point(second, main=second)
    assert repo.base("push", before=second) == (0, first, "")


def test_push_to_a_feature_branch_checks_the_whole_branch(repo: Repo) -> None:
    first = repo.commit("one")
    feature = repo.commit("feature", repo.commit("feature base", first))
    repo.point(feature, main=first)
    assert repo.base("push", before=ZERO) == (0, "origin/main", "")


def test_pull_request_compares_with_its_target(repo: Repo) -> None:
    first = repo.commit("one")
    repo.git("update-ref", "refs/remotes/origin/release", first)
    repo.point(repo.commit("change", first), main=first)
    assert repo.base("pull_request", base_ref="release") == (0, "origin/release", "")


def test_missing_target_fails(repo: Repo) -> None:
    repo.point(repo.commit("one"), main=None)
    code, out, err = repo.base("push")
    assert (code, out) == (2, "")
    assert "origin/main not found" in err


def test_root_commit_on_main_has_nothing_to_compare_with(repo: Repo) -> None:
    first = repo.commit("one")
    repo.point(first, main=first)
    code, out, err = repo.base("push", before=ZERO)
    assert (code, out) == (2, "")
    assert "no earlier commit" in err
