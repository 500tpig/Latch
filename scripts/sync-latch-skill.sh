#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_TEMPLATE="${ROOT}/docs/templates/LATCH_SKILL.md"
DOCS=(
  "HANDBOOK.md"
  "SCENARIOS.md"
  "AI_INSTALL.md"
  "ARTIFACTS.md"
  "DESIGN.md"
)
TARGETS=(
  "${HOME}/.codex/skills/latch"
  "${HOME}/.agents/skills/latch"
)

if [[ ! -f "${SKILL_TEMPLATE}" ]]; then
  echo "Missing skill template: ${SKILL_TEMPLATE}" >&2
  exit 1
fi

for doc in "${DOCS[@]}"; do
  if [[ ! -f "${ROOT}/docs/${doc}" ]]; then
    echo "Missing doc: docs/${doc}" >&2
    exit 1
  fi
done

for target in "${TARGETS[@]}"; do
  mkdir -p "${target}/docs"
  cp "${SKILL_TEMPLATE}" "${target}/SKILL.md"
  for doc in "${DOCS[@]}"; do
    cp "${ROOT}/docs/${doc}" "${target}/docs/${doc}"
  done
  echo "Synced ${target}"
done
