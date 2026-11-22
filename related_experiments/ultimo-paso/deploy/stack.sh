#!/usr/bin/env bash
# Bring up (or tear down) the Último Paso demo stack inside the Lima VM:
#   - one shared ext_proc engine (admin on :9003) with canaries + research loop
#   - mock-bank on :9001, fronted by Envoy on :8080
#   - Langflow (its own compose on :7860), fronted by Envoy on :8081
#
# Usage:  deploy/stack.sh up | down
set -euo pipefail
export PATH=$PATH:/usr/local/go/bin
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EXTPROC_PORT=9002
ADMIN_PORT=9003
STATE=/tmp/mb-state.jsonl

render_envoy() { # listen upstream admin outfile
  sed -e "s/__LISTEN__/$1/" -e "s/__UPSTREAM_PORT__/$2/" \
      -e "s/__EXTPROC_PORT__/$EXTPROC_PORT/" -e "s/__ADMIN_PORT__/$3/" \
      deploy/envoy.tmpl.yaml > "$4"
}

run_envoy() { # name config base_id
  docker rm -f "$1" >/dev/null 2>&1 || true
  docker run -d --name "$1" --network host -v "$2:/etc/envoy/envoy.yaml:ro" \
    envoyproxy/envoy:v1.36.2 -c /etc/envoy/envoy.yaml --base-id "${3:-0}" --log-level error >/dev/null
}

down() {
  docker rm -f up-envoy-mb up-envoy-lf >/dev/null 2>&1 || true
  pkill -f '/tmp/up-engine' 2>/dev/null || true
  pkill -f '/tmp/mock-bank' 2>/dev/null || true
  echo "stack down (langflow compose left running; use its compose to stop)"
}

up() {
  go build -o /tmp/up-engine ./cmd/engine
  go build -o /tmp/mock-bank ./targets/mock-bank
  down
  /tmp/mock-bank -listen 127.0.0.1:9001 -state "$STATE" >/tmp/mb.log 2>&1 &
  /tmp/up-engine -mode=extproc -listen 127.0.0.1:$EXTPROC_PORT -admin 127.0.0.1:$ADMIN_PORT \
    -events /tmp/up-events.jsonl -research \
    -canary aws=AKIA4ZQ7HN3XPLMB2KTE -canary awssecret=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 \
    >/tmp/up-engine.log 2>&1 &
  sleep 1
  render_envoy 8080 9001 9901 /tmp/envoy-mb.yaml
  render_envoy 8081 7860 9902 /tmp/envoy-lf.yaml
  run_envoy up-envoy-mb /tmp/envoy-mb.yaml 0
  run_envoy up-envoy-lf /tmp/envoy-lf.yaml 1
  for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:8080/ && break || sleep 0.3; done
  echo "stack up:"
  echo "  mock-bank   direct :9001   protected :8080"
  echo "  langflow    direct :7860   protected :8081   (start via targets/vulhub/langflow compose)"
  echo "  engine admin :9003  (/rules /alerts /reset)  events /tmp/up-events.jsonl"
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down"; exit 1 ;;
esac
