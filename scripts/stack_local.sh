#!/usr/bin/env bash
# Local mirror-lane stack without Docker. Everything lives in run/ (gitignored):
#   sentinel  Sentinel API and dashboard on 127.0.0.1:8787 (pnpm --filter @sentinel/server start)
#   real      real shop on run/real.sock, data in run/real.db and run/real-files
#   twin      twin shop on run/twin.sock, masked data in run/twin.db, egress only via the relay
#   sync      real-side sync service on run/sync.sock (public rows, copy on flag)
#   router    lane endpoint run/lane.sock, tap run/tap.sock, callback relay 127.0.0.1:8097
#   caddy     public edge on :8080 (deploy/Caddyfile.local, JSON log in run/access.log)
# Before the first start, demo.seed writes run/real.db and demo.mask writes run/twin.db and
# run/canaries.json; each runs until it succeeds once (run/seed.done, run/mask.done). The ingest token for
# Sentinel and the router is generated once into run/sentinel.token (mode 0600, never committed).
# PIDs, start times and output go to run/.
#   scripts/stack_local.sh [start [service ...]]   services: sentinel real twin sync router caddy
#   scripts/stack_local.sh stop | status
# STACK_EDGE_PORT, SENTINEL_PORT and STACK_RELAY_PORT move the three TCP ports (tests use them).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/run"
ALL=(sentinel real twin sync router caddy)
STARTED=()
READY_TICKS=100 # readiness checks, 0.1 s apart
STOP_TICKS=50   # checks for a clean exit after SIGTERM, 0.1 s apart, before SIGKILL
export STACK_EDGE_PORT="${STACK_EDGE_PORT:-8080}"
export SENTINEL_PORT="${SENTINEL_PORT:-8787}"
STACK_RELAY_PORT="${STACK_RELAY_PORT:-8097}"
TOKEN_FILE="$RUN/sentinel.token"
# Exit 0 when something accepts connections on the Unix socket in argv[1].
SOCKET_PROBE='import socket, sys
s = socket.socket(socket.AF_UNIX)
s.settimeout(1)
s.connect(sys.argv[1])'

# What a service listens on once it is ready: "sock:<file in run/>" or "port:<tcp port>".
endpoints_of() {
  case "$1" in
    sentinel) echo "port:$SENTINEL_PORT" ;;
    real) echo "sock:real.sock" ;;
    twin) echo "sock:twin.sock" ;;
    sync) echo "sock:sync.sock" ;;
    router) echo "sock:lane.sock sock:tap.sock port:$STACK_RELAY_PORT" ;;
    caddy) echo "port:$STACK_EDGE_PORT" ;;
  esac
}

started_at() {
  ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'
}

# Prints the service's pid. A pid file only counts while that pid still has the start time recorded
# when this script launched it; otherwise the pid may belong to another program now (reuse after a
# crash or reboot), so the stale files are deleted and the service counts as stopped.
pid_of() {
  local name=$1 pid started
  [[ -f "$RUN/$name.pid" ]] || return 1
  pid="$(cat "$RUN/$name.pid")"
  started="$(started_at "$pid")"
  if [[ -n "$started" && "$started" == "$(cat "$RUN/$name.started" 2>/dev/null)" ]]; then
    echo "$pid"
    return 0
  fi
  rm -f "$RUN/$name.pid" "$RUN/$name.started"
  return 1
}

is_running() {
  pid_of "$1" >/dev/null
}

port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# Relative to the repository root (start runs there): macOS caps AF_UNIX paths near 104 bytes.
socket_live() {
  "$PY" -c "$SOCKET_PROBE" "run/$1" 2>/dev/null
}

# A stale socket file (its server died) is not "in use": the service removes it when it binds.
endpoint_up() {
  case "$1" in
    sock:*) socket_live "${1#sock:}" ;;
    port:*) port_open "${1#port:}" ;;
  esac
}

describe() {
  case "$1" in
    sock:*) echo "socket run/${1#sock:}" ;;
    port:*) echo "port ${1#port:}" ;;
  esac
}

all_up() {
  local endpoint
  for endpoint in $(endpoints_of "$1"); do
    endpoint_up "$endpoint" || return 1
  done
}

wait_ready() {
  local name=$1
  for _ in $(seq 1 "$READY_TICKS"); do
    is_running "$name" || return 1
    all_up "$name" && return 0
    sleep 0.1
  done
  return 1
}

# The router runs the engine Detector inline, so its routes and rules are loaded once up front: a
# bad config fails here with the traceback in run/router.log instead of after a reported start.
preflight() {
  [[ "$1" == router ]] || return 0
  "$PY" -m engine replay /dev/null >"$RUN/router.log" 2>&1
}

run_service() {
  trap '' HUP
  case "$1" in
    sentinel)
      SENTINEL_INGEST_TOKEN="$(cat "$TOKEN_FILE")" SENTINEL_DB="$RUN/sentinel.db" \
        exec pnpm --filter @sentinel/server start ;;
    real) exec "$PY" -m demo --socket run/real.sock --db run/real.db --files run/real-files ;;
    twin)
      exec "$PY" -m demo --socket run/twin.sock --db run/twin.db --files run/twin-files \
        --egress-proxy "http://127.0.0.1:$STACK_RELAY_PORT" ;;
    sync) exec "$PY" -m demo.sync --socket run/sync.sock --real run/real.db --twin run/twin.db ;;
    router)
      SENTINEL_INGEST_TOKEN="$(cat "$TOKEN_FILE")" exec "$PY" -m mirror \
        --lane run/lane.sock --tap run/tap.sock --relay "127.0.0.1:$STACK_RELAY_PORT" \
        --real run/real.sock --twin run/twin.sock --sync run/sync.sock \
        --sentinel "http://127.0.0.1:$SENTINEL_PORT" --state run/mirror-keys.jsonl \
        --spool run/mirror-spool.jsonl --canaries run/canaries.json ;;
    caddy) exec caddy run --config deploy/Caddyfile.local --adapter caddyfile ;;
  esac
}

# One-time data jobs, real side only: seed the real shop, then mask a copy for the twin.
run_job() {
  local name=$1
  shift
  echo "$name: running once"
  if ! "$PY" -m "$@" </dev/null >"$RUN/$name.log" 2>&1; then
    echo "$name: failed; last lines of run/$name.log:" >&2
    tail -n 20 "$RUN/$name.log" >&2
    return 1
  fi
}

ensure_token() {
  [[ -s "$TOKEN_FILE" ]] && return 0
  (umask 077 && "$PY" -c 'import secrets; print(secrets.token_hex(32))' >"$TOKEN_FILE")
}

# The shops, sync and the router (canaries) need the data; Sentinel and Caddy do not.
needs_data() {
  local name
  for name in "$@"; do
    case "$name" in real | twin | sync | router) return 0 ;; esac
  done
  return 1
}

# A job counts as done once its marker file exists, so a job that died halfway runs again from a
# clean slate; a new seed also redoes the mask.
prepare_data() {
  mkdir -p "$RUN/real-files" "$RUN/twin-files"
  if [[ ! -f "$RUN/seed.done" ]]; then
    rm -f "$RUN/real.db" "$RUN/real.db-wal" "$RUN/real.db-shm" "$RUN/mask.done"
    run_job seed demo.seed --db run/real.db || return 1
    touch "$RUN/seed.done"
  fi
  if [[ ! -f "$RUN/mask.done" ]]; then
    rm -f "$RUN/twin.db" "$RUN/twin.db-wal" "$RUN/twin.db-shm" "$RUN/canaries.json"
    run_job mask demo.mask --from run/real.db --to run/twin.db --allow config/mask.yaml \
      --canaries run/canaries.json || return 1
    touch "$RUN/mask.done"
  fi
}

start_one() {
  local name=$1 endpoint pid
  if pid="$(pid_of "$name")"; then
    echo "$name: already running (pid $pid)"
    return 0
  fi
  for endpoint in $(endpoints_of "$name"); do
    if endpoint_up "$endpoint"; then
      echo "$name: $(describe "$endpoint") is already in use" >&2
      return 1
    fi
  done
  if ! preflight "$name"; then
    echo "$name: config check failed; last lines of run/$name.log:" >&2
    tail -n 20 "$RUN/$name.log" >&2
    return 1
  fi
  (run_service "$name") </dev/null >"$RUN/$name.log" 2>&1 &
  pid=$!
  echo "$pid" >"$RUN/$name.pid"
  started_at "$pid" >"$RUN/$name.started"
  disown "$pid"
  STARTED+=("$name")
  if ! wait_ready "$name"; then
    echo "$name: failed to start; last lines of run/$name.log:" >&2
    tail -n 20 "$RUN/$name.log" >&2
    return 1
  fi
  echo "$name: started (pid $pid)"
}

# pnpm runs Sentinel as a child process, so a stop signals the whole process tree.
tree_of() {
  local child
  echo "$1"
  for child in $(pgrep -P "$1" 2>/dev/null || true); do
    tree_of "$child"
  done
}

stop_one() {
  local name=$1 pid tree alive p
  if pid="$(pid_of "$name")"; then
    tree="$(tree_of "$pid")"
    kill $tree 2>/dev/null || true
    for _ in $(seq 1 "$STOP_TICKS"); do
      alive=""
      for p in $tree; do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done
      [[ -n "$alive" ]] || break
      sleep 0.1
    done
    [[ -z "$alive" ]] || kill -9 $alive 2>/dev/null || true
    echo "$name: stopped (pid $pid)"
  fi
  rm -f "$RUN/$name.pid" "$RUN/$name.started"
}

start() {
  local services=("$@")
  [[ ${#services[@]} -gt 0 ]] || services=("${ALL[@]}")
  mkdir -p "$RUN"
  touch "$RUN/access.log"
  cd "$ROOT"
  PY="$(uv run --frozen python -c 'import sys; print(sys.executable)')"
  ensure_token
  if needs_data "${services[@]}"; then
    prepare_data || exit 1
  fi
  for name in "${services[@]}"; do
    if ! start_one "$name"; then
      stop_started
      exit 1
    fi
  done
  echo "edge http://127.0.0.1:$STACK_EDGE_PORT  sentinel http://127.0.0.1:$SENTINEL_PORT" \
    " log $RUN/access.log"
}

# After a failed start, stop only what this call launched, newest first; services that were
# already running before the call stay up.
stop_started() {
  local i
  for ((i = ${#STARTED[@]} - 1; i >= 0; i--)); do
    stop_one "${STARTED[i]}"
  done
}

stop() {
  local i
  for ((i = ${#ALL[@]} - 1; i >= 0; i--)); do
    stop_one "${ALL[i]}"
  done
}

status() {
  local name pid
  for name in "${ALL[@]}"; do
    if pid="$(pid_of "$name")"; then
      echo "$name: running (pid $pid)"
    else
      echo "$name: stopped"
    fi
  done
}

case "${1:-start}" in
  start) shift || true; start "$@" ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 [start [sentinel|real|twin|sync|router|caddy ...]] | stop | status" >&2; exit 2 ;;
esac
