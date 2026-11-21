#!/usr/bin/env bash
# Local stack without Docker: demo site :8081, Caddy :8080 (JSON log in run/access.log),
# dashboard :8090 and the engine following the log. PIDs, start times and output go to run/.
#   scripts/stack_local.sh [start [service ...]]   services: site caddy dashboard engine
#   scripts/stack_local.sh stop | status
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/run"
ALL=(site caddy dashboard engine)
STARTED=()
SETTLE_TICKS=15 # a service without a port is ready once it stays up this many 0.1 s checks

port_of() {
  case "$1" in
    site) echo 8081 ;;
    caddy) echo 8080 ;;
    dashboard) echo 8090 ;;
    *) echo "" ;;
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

wait_ready() {
  local name=$1 port ticks=0
  port="$(port_of "$name")"
  for _ in $(seq 1 100); do
    is_running "$name" || return 1
    ticks=$((ticks + 1))
    if [[ -n "$port" ]]; then
      port_open "$port" && return 0
    elif ((ticks >= SETTLE_TICKS)); then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

# The engine has no port to probe, so its routes and rules are loaded once up front: a bad config
# fails here with the traceback in run/engine.log instead of after a reported start.
preflight() {
  [[ "$1" == engine ]] || return 0
  "$PY" -m engine replay /dev/null >"$RUN/engine.log" 2>&1
}

run_service() {
  trap '' HUP
  case "$1" in
    site) exec "$PY" -m demo --port 8081 ;;
    caddy) exec caddy run --config deploy/Caddyfile.local --adapter caddyfile ;;
    dashboard) exec "$PY" -m dashboard --port 8090 --db "$RUN/verdicts.db" ;;
    engine) exec "$PY" -m engine follow "$RUN/access.log" --webhook http://127.0.0.1:8090/webhook ;;
  esac
}

start_one() {
  local name=$1 port pid
  if pid="$(pid_of "$name")"; then
    echo "$name: already running (pid $pid)"
    return 0
  fi
  port="$(port_of "$name")"
  if [[ -n "$port" ]] && port_open "$port"; then
    echo "$name: port $port is already in use" >&2
    return 1
  fi
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
  echo "$name: started (pid $pid)${port:+ on :$port}"
}

stop_one() {
  local name=$1 pid
  if pid="$(pid_of "$name")"; then
    kill "$pid"
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
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
  for name in "${services[@]}"; do
    if ! start_one "$name"; then
      stop_started
      exit 1
    fi
  done
  echo "proxy http://127.0.0.1:8080  dashboard http://127.0.0.1:8090  log $RUN/access.log"
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
  *) echo "usage: $0 [start [site|caddy|dashboard|engine ...]] | stop | status" >&2; exit 2 ;;
esac
