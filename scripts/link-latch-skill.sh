#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${ROOT}/skills/latch"
TARGET="${HOME}/.agents/skills/latch"
LEGACY_TARGET="${HOME}/.codex/skills/latch"

mkdir -p "$(dirname "${TARGET}")"
if [[ -e "${TARGET}" && ! -L "${TARGET}" ]]; then
  echo "Refusing to replace non-symlink path: ${TARGET}" >&2
  exit 1
fi
if [[ -L "${TARGET}" ]]; then
  rm "${TARGET}"
fi
ln -s "${SOURCE}" "${TARGET}"
echo "Linked ${TARGET} -> ${SOURCE}"

if [[ -L "${LEGACY_TARGET}" && "$(readlink "${LEGACY_TARGET}")" == "${SOURCE}" ]]; then
  rm "${LEGACY_TARGET}"
  echo "Removed legacy Latch link: ${LEGACY_TARGET}"
elif [[ -e "${LEGACY_TARGET}" || -L "${LEGACY_TARGET}" ]]; then
  echo "Preserved unmanaged legacy path: ${LEGACY_TARGET}"
fi
