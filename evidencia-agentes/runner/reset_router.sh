#!/usr/bin/env bash
# Reset ONLY the mirror router between runs: wipe the key table (otherwise the bare-IP key
# 127.0.0.1, bound on an R3 critical, would divert every later run, including benign ones) and
# restart it with a fresh detector. Ports come from the environment (set by run_eval.py).
set -euo pipefail
DET="${1:?detection dir}"
cd "$DET"
pkill -9 -f "python.*-m mirror" 2>/dev/null || true
sleep 0.4
rm -f run/lane.sock run/tap.sock run/mirror-keys.jsonl run/mirror-spool.jsonl \
      run/router.pid run/router.started
bash scripts/stack_local.sh start router >/tmp/evid-reset.log 2>&1
