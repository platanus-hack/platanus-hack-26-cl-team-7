# Constraints

The quality bar for this repository. Each row names the command that gives the result.
**A failed row blocks the change.** Nobody reads a warning in an unattended run, so there is no
warn-only mode. `make check` runs every "Each edit" and "Task end" row except Accuracy.

| Rule | Limit | Command | Runs at |
| --- | --- | --- | --- |
| File size | 200 lines for each source file, 300 for each test file. Blank lines and comments count. | `make size` (`uv run python scripts/check_size.py`) | Each edit |
| Floor | No added line that breaks the floor (below). | `make floor` (`scripts/check_floor.py` on the diff) | Each edit |
| Lint | Zero errors. | `make lint` (`uv run ruff check .`) | Each edit |
| Types | Zero errors (`strict = true`). | `make types` (`uv run mypy engine eval dashboard scripts demo mirror`) | Each edit |
| Secrets | Zero findings. | `make secrets` (`gitleaks dir . --redact`) | Each edit |
| Tests | All pass. Changed lines 80% covered. | `make test` (`uv run pytest --cov`, then `diff-cover --fail-under=80`) | Task end |
| Accuracy | Precision and recall do not fall more than 0.5 points below `eval/baseline.json`. The test set matches `eval/testset.lock`. The baseline was recorded on the test split and the current lock. | `make eval-ci` (`uv run python -m eval run`, `verify-lock`, `check-baseline`) | Task end and CI |
| Dependencies | No high or critical flaw. | `make deps` (`osv-scanner scan source -r .`) | CI |

`make check` = `size floor lint types secrets test`. CI (`.github/workflows/agent-detection.yml` at the repository root) runs
`make check`, `make eval-ci`, `gitleaks git` over the history and `make deps` on every push and
pull request.

Notes on the commands:

- A test file is any `*.py` file under `tests/`. Every other `*.py` file under the roots in
  `[tool.check_size].roots` is a source file. Lines are physical lines.
- `tests/test_check_size.py` proves that the size rule fails on a source file of 201 lines.
- `make floor` and `make test` compare against `BASE` (default `origin/main`, then `main`;
  override with `make floor BASE=<ref>`). The floor diff is `BASE...HEAD`, plus uncommitted
  changes against `HEAD`, plus untracked Python files. If `BASE` does not exist, `make floor`
  prints a warning and checks only the changes against `HEAD`, and `make test` prints that it
  skips the changed-line coverage step. With `REQUIRE_BASE=1` a missing `BASE` fails both
  instead (`make require-base`). CI sets `REQUIRE_BASE=1`.
- CI picks `BASE` with `scripts/ci_base.sh`: the pull request target, `origin/main` for a push
  to another branch, and the commit before the push (`github.event.before`, else `HEAD~1`) for
  a push to `main` itself, where `origin/main...HEAD` would be empty.
- Coverage uses `source_pkgs`, so `coverage.xml` names each file by its repo path and
  `diff-cover` never reads one package's `__init__.py` or `__main__.py` for another's.
- `make baseline` (`python -m eval baseline`) records `eval/baseline.json` from the locked
  test split, with the split, the session count and the sha256 of `eval/testset.lock`.
  `check-baseline` fails on a baseline without these fields, from another split or from
  another lock. Run `make lock`, then `make baseline`, once a change to the rules is approved.
- `osv-scanner` fails on any known flaw, which is stricter than the row asks.

## The floor

These rules hold in the same change as the code that failed a check:

- No new suppression comments: `# noqa`, `# type: ignore`, `# pragma: no cover`,
  `# pragma: no branch`, and the file-level forms `# ruff: noqa`, `# flake8: noqa`,
  `# mypy: ...` and `# pyright: ...`.
- No empty stubs: no `pass`-only bodies, no `raise NotImplementedError`.
- No skipped or expected-to-fail tests: no `pytest.mark.skip`, `skipif`, `pytest.skip(`,
  `pytest.mark.xfail`, `pytest.xfail(`, under any alias of `mark`, and no `importorskip`,
  `unittest.skip`, `skipIf`, `skipUnless`, `expectedFailure` or `collect_ignore`.
- No weaker limits: no higher size limits, no looser lint, type, coverage or accuracy thresholds,
  no deleted or emptied tests, no removed assertions.

`scripts/check_floor.py` rejects added Python lines with the markers above. The pytest plugin
`scripts/pytest_floor.py` (loaded by `tests/conftest.py`) fails every test that is skipped,
xfailed or xpassed at run time, whatever the spelling. `scripts/check_size.py` rejects
`source_limit` above 200 and `test_limit` above 300. The other floor rules are checked in review.

## Exceptions

An exception covers a real case where the size limit splits code badly. It is the only way to
pass a limit, and it needs an **owner** and an **end date**. Record it in `pyproject.toml`:

```toml
[tool.check_size]
exceptions = [
  { path = "engine/big.py", limit = 260, owner = "david", until = "2026-12-31" },
]
```

- `path` is relative to the repository root. `limit` replaces the normal limit for that file only.
- `owner` is the person who removes the exception. It must not be blank.
- `until` is an ISO date. On the day after `until`, `make size` fails with exit code 2 until the
  file is split or the exception is renewed in review.
- There are no exceptions to the floor.

## Lint exceptions

A lint exception is a `[tool.ruff.lint.per-file-ignores]` entry in `pyproject.toml` for named
files only, never a glob and never a global `ignore`. Each one is a row here with an owner, a
reason and a review date. `tests/test_gate_config.py` fails when the files in `pyproject.toml`
and in the row differ. On the review date the owner renews or removes the exception in review.

| Rule | Files | Owner | Reason | Review date |
| --- | --- | --- | --- | --- |
| `S311` | `eval/synthetic.py`, `eval/tail.py`, `eval/base_rate.py`, `eval/convert/csic.py` | team-7 | Seeded, non-cryptographic `random.Random` makes the synthetic data reproducible; it never makes secrets. | 2027-05-21 |
| `S608` | `demo/auth.py` | team-7 | The demo shop's planted SQL injection login flaw (the deception twin's bait) builds its SQL from text on purpose. It runs on a read-only, authorizer-guarded connection (`demo/db.py`). | 2027-05-21 |
