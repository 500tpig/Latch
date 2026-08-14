#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${ROOT}/skills/latch"
TARGET="${HOME}/.agents/skills/latch"
LEGACY_TARGET="${HOME}/.codex/skills/latch"

if [[ ! -L "${TARGET}" ]]; then
  echo "Not a symbolic link: ${TARGET}" >&2
  exit 1
fi
if [[ "$(cd "$(dirname "${TARGET}")" && realpath "${TARGET}")" != "$(realpath "${SOURCE}")" ]]; then
  echo "Wrong link target: ${TARGET}" >&2
  exit 1
fi

if [[ -L "${LEGACY_TARGET}" && "$(readlink "${LEGACY_TARGET}")" == "${SOURCE}" ]]; then
  echo "Legacy Latch link is still installed: ${LEGACY_TARGET}" >&2
  exit 1
fi

echo "Latch skill link is valid."
