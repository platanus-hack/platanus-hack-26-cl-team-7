#!/usr/bin/env bash
# Aprovisiona la VM (se ejecuta como root dentro de la VM).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 bpfcc-tools python3-bpfcc bpftrace \
  "linux-headers-$(uname -r)" nftables jq curl ca-certificates python3-venv
systemctl enable --now docker
LIMA_USER="$(getent passwd 1000 | cut -d: -f1 || true)"
[ -n "${LIMA_USER}" ] && usermod -aG docker "${LIMA_USER}" || true
# uv para el entorno de Python del harness
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
fi
echo "--- versiones"
uname -r; docker --version; docker compose version; python3 --version; bpftrace --version
stat -fc %T /sys/fs/cgroup   # debe decir cgroup2fs
ls -la /sys/kernel/btf/vmlinux
