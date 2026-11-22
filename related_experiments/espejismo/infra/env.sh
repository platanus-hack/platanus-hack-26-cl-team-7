# Variables comunes dentro de la VM: source infra/env.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export UV_PROJECT_ENVIRONMENT="$HOME/.venvs/espejismo"
export PY="$UV_PROJECT_ENVIRONMENT/bin/python"
for f in "$ROOT/.env" "$ROOT/../.env"; do [ -f "$f" ] && set -a && . "$f" && set +a; done
cd "$ROOT"
