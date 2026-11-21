#!/usr/bin/env bash
# Construye las imágenes de los sandboxes (en la VM). Requiere que hostd haya creado la CA.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cp "$ROOT/controller/ca/ca.pem" "$ROOT/sandbox/ca.pem"
docker build -q -t espejismo-base:latest "$ROOT/sandbox"
for s in "$ROOT"/scenarios/*/; do
  name="$(basename "$s")"
  [ -f "$s/Dockerfile" ] && docker build -q -t "espejismo-$name:latest" "$s"
done
docker images | grep espejismo
