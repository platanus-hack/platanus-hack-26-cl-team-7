#!/usr/bin/env bash
# Crea un sandbox registrado en hostd y una "terminal" para un agente externo (p. ej. un subagente).
# Uso: infra/sub_episode.sh <id> <escenario> <etiqueta-modelo> <condicion> <dir-terminales>
set -euo pipefail
id="$1"; scen="$2"; label="$3"; cond="$4"; dir="$5"
name="ws-$id"
limactl shell espejismo bash -lc "docker rm -f $name >/dev/null 2>&1; docker run -d --name $name --hostname ws-data-0412 --init --network espejismo_net --dns 172.30.0.1 espejismo-$scen:latest >/dev/null
IP=\$(docker inspect -f '{{(index .NetworkSettings.Networks \"espejismo_net\").IPAddress}}' $name)
curl -s -XPOST localhost:8787/episodes -d \"{\\\"ip\\\":\\\"\$IP\\\",\\\"scenario\\\":\\\"$scen\\\",\\\"condition\\\":\\\"$cond\\\",\\\"model\\\":\\\"$label\\\",\\\"epoch\\\":1}\" >/dev/null
echo \"$id \$IP\""
mkdir -p "$dir"
printf '#!/bin/sh\n# terminal de la estacion ws-data-0412 (usuario analyst)\nexec limactl shell espejismo docker exec -u analyst -w /workspace %s bash -lc "$*"\n' "$name" > "$dir/terminal-$id"
chmod +x "$dir/terminal-$id"
