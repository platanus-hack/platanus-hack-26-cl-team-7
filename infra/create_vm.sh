#!/usr/bin/env bash
# Crea la VM Lima "espejismo": Ubuntu 24.04 arm64 con vz.
# Solo se monta la carpeta del proyecto (escritura); el resto del home del Mac no entra a la VM.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
limactl create --tty=false --name=espejismo \
  --vm-type=vz --cpus=4 --memory=8 --disk=40 \
  --mount-only="${ROOT}:w" \
  --containerd=none \
  template:ubuntu-24.04
limactl start espejismo
limactl shell espejismo sudo bash "${ROOT}/infra/provision.sh"
