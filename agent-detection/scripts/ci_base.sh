#!/usr/bin/env bash
# Print the diff base that `make floor` and `make test` compare against in CI.
#
# usage: scripts/ci_base.sh EVENT_NAME BASE_REF BEFORE
#   EVENT_NAME  github.event_name (pull_request, push, ...)
#   BASE_REF    github.base_ref (the pull request target; empty on push)
#   BEFORE      github.event.before (the branch tip before a push; empty or all zeros if none)
#
# A pull request, or a push to a branch that is not yet on the default branch, compares with
# origin/<target>, so the whole branch is checked. A push to the default branch itself has
# HEAD == origin/main, which would give an empty diff, so it compares with the commit before
# the push (or HEAD's parent when that commit is unknown, for example after a force push).
# Exit 2 when no base can be found: CI must not check an empty or narrower diff.
set -euo pipefail

event="${1:-}"
base_ref="${2:-}"
before="${3:-}"
target="origin/${base_ref:-main}"

is_commit() { git rev-parse --verify --quiet "$1^{commit}" >/dev/null 2>&1; }

if ! is_commit "$target"; then
  echo "ci_base: $target not found; fetch it (actions/checkout fetch-depth: 0)" >&2
  exit 2
fi
if [ "$event" = "pull_request" ] || ! git merge-base --is-ancestor HEAD "$target"; then
  echo "$target"
  exit 0
fi
head="$(git rev-parse HEAD)"
if [ -n "$before" ] && [ "$before" != "0000000000000000000000000000000000000000" ] \
  && is_commit "$before" && [ "$(git rev-parse "$before^{commit}")" != "$head" ]; then
  git rev-parse "$before^{commit}"
  exit 0
fi
if is_commit HEAD~1; then
  git rev-parse HEAD~1
  exit 0
fi
echo "ci_base: HEAD is on $target and has no earlier commit to compare with" >&2
exit 2
