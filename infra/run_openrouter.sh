#!/usr/bin/env bash
# Corre S1 contra varias familias de OpenRouter (en la VM, con hostd y witness arriba).
# Uso: infra/run_openrouter.sh <rung P0..P3> <attacker true|false> <epochs> [modelos...]
set -euo pipefail
source "$(dirname "$0")/env.sh"
: "${OPENROUTER_API_KEY:?falta OPENROUTER_API_KEY en .env}"
RUNG="${1:-P0}"; ATK="${2:-false}"; EPOCHS="${3:-3}"; shift 3 || true
MODELS=("$@")
[ ${#MODELS[@]} -eq 0 ] && MODELS=(
  openai/gpt-6.1-terra
  deepseek/deepseek-v4.1-flash-1017
  moonshotai/kimi-k3.1-pro
  mistralai/mistral-large-4-0
  z-ai/glm-5.3-prime
)
SUFFIX=""; [ "$ATK" = true ] && SUFFIX="-atk" || true
TAG="$(date +%Y%m%dT%H%M%S)-${RUNG}${SUFFIX}"
mkdir -p "runs/inspect/$TAG"
for m in "${MODELS[@]}"; do
  "$UV_PROJECT_ENVIRONMENT/bin/inspect" eval harness/espejismo_task.py@s1 \
    -T rung="$RUNG" -T attacker="$ATK" --model "openrouter/$m" --epochs "$EPOCHS" \
    --max-samples 3 --log-dir "runs/inspect/$TAG" --display none \
    > "runs/inspect/$TAG/$(echo "$m" | tr / _).log" 2>&1 &
done
wait
echo "listo: runs/inspect/$TAG"
