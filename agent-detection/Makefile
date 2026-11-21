# Quality gates. Every row of CONSTRAINTS.md maps to one target here. A failed target blocks.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

BASE ?= $(shell git rev-parse --verify --quiet origin/main >/dev/null 2>&1 && echo origin/main || echo main)
HAS_BASE = git rev-parse --verify --quiet '$(BASE)^{commit}' >/dev/null 2>&1
# CI sets REQUIRE_BASE=1: there a missing base fails floor and test instead of narrowing them.
REQUIRE_BASE ?=
GIT_DIFF = git diff --no-color --no-ext-diff --relative
TYPED_PACKAGES = engine eval dashboard scripts demo

.PHONY: check size require-base floor lint types secrets test eval eval-ci lock baseline deps demo-up

check: size floor lint types secrets test

size:
	uv run python scripts/check_size.py

require-base:
	@if [ -n "$(REQUIRE_BASE)" ] && ! $(HAS_BASE); then \
	  echo "$@: base '$(BASE)' not found and REQUIRE_BASE is set; refusing to check a narrower diff" >&2; \
	  exit 2; \
	fi

floor: require-base
	@{ \
	  if $(HAS_BASE); then $(GIT_DIFF) '$(BASE)...HEAD' -- .; \
	  else echo "floor: warning: base '$(BASE)' not found; checking only changes against HEAD" >&2; fi; \
	  if git rev-parse --verify --quiet HEAD >/dev/null; then $(GIT_DIFF) HEAD -- .; fi; \
	  git ls-files --others --exclude-standard -z -- '*.py' \
	    | xargs -0 -r -n1 $(GIT_DIFF) --no-index /dev/null || true; \
	} | uv run python scripts/check_floor.py --diff -

lint:
	uv run ruff check .

types:
	uv run mypy $(TYPED_PACKAGES)

secrets:
	gitleaks dir . --redact --no-banner

test: require-base
	uv run pytest --cov --cov-branch --cov-report=xml:coverage.xml --cov-report=term
	@if $(HAS_BASE); then \
	  uv run diff-cover coverage.xml --compare-branch='$(BASE)' --include-untracked --fail-under=80; \
	else echo "test: base '$(BASE)' not found; skipping changed-line coverage (diff-cover)"; fi

eval:
	uv run python -m eval run --split test --report eval/report.json

eval-ci: eval
	uv run python -m eval verify-lock
	uv run python -m eval check-baseline

lock:
	uv run python -m eval lock

# Records eval/baseline.json (precision, recall, split, sessions, testset.lock digest) from the
# locked test split. Run after `make lock`, once the change to the rules is approved.
baseline:
	uv run python -m eval baseline

deps:
	osv-scanner scan source -r .

demo-up:
	bash scripts/stack_local.sh
