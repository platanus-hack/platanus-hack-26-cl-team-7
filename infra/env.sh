# Variables comunes dentro de la VM: source infra/env.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export UV_PROJECT_ENVIRONMENT="$HOME/.venvs/espejismo"
export PY="$UV_PROJECT_ENVIRONMENT/bin/python"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a
cd "$ROOT"
