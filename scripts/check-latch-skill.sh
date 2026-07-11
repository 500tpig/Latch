#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${ROOT}/skills/latch"
TARGETS=("${HOME}/.codex/skills/latch" "${HOME}/.agents/skills/latch")

for target in "${TARGETS[@]}"; do
  if [[ ! -L "${target}" ]]; then
    echo "Not a symbolic link: ${target}" >&2
    exit 1
  fi
  if [[ "$(cd "$(dirname "${target}")" && realpath "${target}")" != "$(realpath "${SOURCE}")" ]]; then
    echo "Wrong link target: ${target}" >&2
    exit 1
  fi
done

echo "Latch skill links are valid."
