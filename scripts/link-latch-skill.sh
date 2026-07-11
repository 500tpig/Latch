#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${ROOT}/skills/latch"
TARGETS=("${HOME}/.codex/skills/latch" "${HOME}/.agents/skills/latch")

for target in "${TARGETS[@]}"; do
  mkdir -p "$(dirname "${target}")"
  if [[ -e "${target}" && ! -L "${target}" ]]; then
    echo "Refusing to replace non-symlink path: ${target}" >&2
    exit 1
  fi
  if [[ -L "${target}" ]]; then
    rm "${target}"
  fi
  ln -s "${SOURCE}" "${target}"
  echo "Linked ${target} -> ${SOURCE}"
done
