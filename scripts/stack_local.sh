#!/usr/bin/env bash
# Local stack without Docker: demo site :8081, Caddy :8080 (JSON log in run/access.log),
# dashboard :8090 and the engine following the log. PIDs and output go to run/.
#   scripts/stack_local.sh [start [service ...]]   services: site caddy dashboard engine
#   scripts/stack_local.sh stop | status
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/run"
ALL=(site caddy dashboard engine)

port_of() {
  case "$1" in
    site) echo 8081 ;;
    caddy) echo 8080 ;;
    dashboard) echo 8090 ;;
    *) echo "" ;;
  esac
}

is_running() {
  [[ -f "$RUN/$1.pid" ]] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null
}

port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

wait_ready() {
  local name=$1 port
  port="$(port_of "$name")"
  for _ in $(seq 1 100); do
    is_running "$name" || return 1
    if [[ -z "$port" ]] || port_open "$port"; then
      return 0
    fi
    sleep 0.1
  done
  return 1
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
  local name=$1 port
  if is_running "$name"; then
    echo "$name: already running (pid $(cat "$RUN/$name.pid"))"
    return 0
  fi
  port="$(port_of "$name")"
  if [[ -n "$port" ]] && port_open "$port"; then
    echo "$name: port $port is already in use" >&2
    return 1
  fi
  (run_service "$name") </dev/null >"$RUN/$name.log" 2>&1 &
  echo $! >"$RUN/$name.pid"
  disown $!
  if ! wait_ready "$name"; then
    echo "$name: failed to start; last lines of run/$name.log:" >&2
    tail -n 20 "$RUN/$name.log" >&2
    return 1
  fi
  echo "$name: started (pid $(cat "$RUN/$name.pid"))${port:+ on :$port}"
}

stop_one() {
  local name=$1 pid
  [[ -f "$RUN/$name.pid" ]] || return 0
  pid="$(cat "$RUN/$name.pid")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
    echo "$name: stopped (pid $pid)"
  fi
  rm -f "$RUN/$name.pid"
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
      stop
      exit 1
    fi
  done
  echo "proxy http://127.0.0.1:8080  dashboard http://127.0.0.1:8090  log $RUN/access.log"
}

stop() {
  local i
  for ((i = ${#ALL[@]} - 1; i >= 0; i--)); do
    stop_one "${ALL[i]}"
  done
}

status() {
  local name
  for name in "${ALL[@]}"; do
    if is_running "$name"; then
      echo "$name: running (pid $(cat "$RUN/$name.pid"))"
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
