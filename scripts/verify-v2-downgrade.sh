#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="623d459f76dd50c500b6818955b0c3887f10689e"
ACTOR="codex:session:v2-r2-smoke"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/latch-v2-r2.XXXXXX")"
trap 'rm -rf "${TEMP_ROOT}"' EXIT

OLD_SOURCE="${TEMP_ROOT}/latch-0.1.0"
OPEN_REPO="${TEMP_ROOT}/open-repo"
ARCHIVED_REPO="${TEMP_ROOT}/archived-repo"
CURRENT_CLI="${ROOT}/dist/cli.js"
OLD_CLI="${OLD_SOURCE}/dist/cli.js"

mkdir -p "${OLD_SOURCE}" "${OPEN_REPO}" "${ARCHIVED_REPO}"
git -C "${ROOT}" archive "${BASELINE}" | tar -x -C "${OLD_SOURCE}"

node -e '
  const packageJson = require(process.argv[1])
  if (packageJson.version !== "0.1.0") throw new Error(`Unexpected version: ${packageJson.version}`)
' "${OLD_SOURCE}/package.json"

pnpm --dir "${OLD_SOURCE}" install --offline --frozen-lockfile >/dev/null
pnpm --dir "${OLD_SOURCE}" build >/dev/null
pnpm --dir "${ROOT}" build >/dev/null

run_current() {
  local cwd="$1"
  shift
  (cd "${cwd}" && env LATCH_ACTOR="${ACTOR}" node "${CURRENT_CLI}" "$@")
}

run_old() {
  local cwd="$1"
  shift
  (cd "${cwd}" && env LATCH_ACTOR="${ACTOR}" node "${OLD_CLI}" "$@")
}

json_field() {
  local field="$1"
  node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8'))['${field}']"
}

write_plan() {
  local path="$1"
  local goal="$2"
  node -e '
    const fs = require("node:fs")
    const [path, goal] = process.argv.slice(1)
    const plan = {
      goal,
      scope: ["temporary repository"],
      acceptance: ["v2 CLI can read and write the downgraded task"],
      approach: ["exercise the real CLI"],
      api_assumptions: [],
      permission_assumptions: [],
      data_assumptions: [],
      user_flow: ["create -> downgrade -> v2 read/write"],
      out_of_scope: ["global installation"],
      verification_plan: [],
      open_questions: [],
    }
    fs.writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`)
  ' "${path}" "${goal}"
}

assert_downgraded() {
  local task_path="$1"
  local events_path="$2"
  node -e '
    const fs = require("node:fs")
    const [taskPath, eventsPath] = process.argv.slice(1)
    const task = JSON.parse(fs.readFileSync(taskPath, "utf8"))
    if (task.schema_version !== 2) throw new Error("Task was not downgraded to schema 2")
    for (const field of ["primary_writer", "profile", "work_basis", "group_id", "provenance"])
      if (field in task) throw new Error(`Unexpected v3 field: ${field}`)
    const events = fs.readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    events.forEach((event, index) => {
      if (event.revision !== index + 1) throw new Error("Event revisions are not continuous")
    })
  ' "${task_path}" "${events_path}"
}

git -C "${OPEN_REPO}" init -q
write_plan "${OPEN_REPO}/plan.json" "Open R2 smoke"
write_plan "${OPEN_REPO}/updated-plan.json" "Open R2 smoke updated by v2"
run_current "${OPEN_REPO}" init --json >/dev/null
OPEN_ID="$(run_current "${OPEN_REPO}" checkpoint "open R2 smoke" --plan-file plan.json --json | json_field task_id)"
run_current "${OPEN_REPO}" approve "${OPEN_ID}" --expect-revision 1 --reason "exercise v3-only authorization" --json >/dev/null

OPEN_TASK_DIR="${OPEN_REPO}/.latch/tasks/${OPEN_ID}"
OPEN_TASK_SHA="$(shasum -a 256 "${OPEN_TASK_DIR}/task.json" | awk '{print $1}')"
OPEN_EVENTS_SHA="$(shasum -a 256 "${OPEN_TASK_DIR}/events.jsonl" | awk '{print $1}')"
OPEN_DOWNGRADE="$(run_current "${OPEN_REPO}" downgrade-v2 --task "${OPEN_ID}" --expect-revision 2 --confirm-data-loss --json)"
OPEN_BACKUP="${OPEN_REPO}/$(printf '%s' "${OPEN_DOWNGRADE}" | json_field backup_path)"

assert_downgraded "${OPEN_TASK_DIR}/task.json" "${OPEN_TASK_DIR}/events.jsonl"
[[ "$(shasum -a 256 "${OPEN_BACKUP}/task.json" | awk '{print $1}')" == "${OPEN_TASK_SHA}" ]]
[[ "$(shasum -a 256 "${OPEN_BACKUP}/events.jsonl" | awk '{print $1}')" == "${OPEN_EVENTS_SHA}" ]]
run_old "${OPEN_REPO}" context "${OPEN_ID}" --json >/dev/null
run_old "${OPEN_REPO}" save "${OPEN_ID}" --expect-revision 2 --plan-file updated-plan.json --json >/dev/null
node -e '
  const task = require(process.argv[1])
  if (task.schema_version !== 2 || task.revision !== 3 || task.plan.goal !== "Open R2 smoke updated by v2")
    throw new Error("Frozen v2 CLI did not persist the plan update")
' "${OPEN_TASK_DIR}/task.json"

git -C "${ARCHIVED_REPO}" init -q
write_plan "${ARCHIVED_REPO}/plan.json" "Archived R2 smoke"
run_current "${ARCHIVED_REPO}" init --json >/dev/null
ARCHIVED_ID="$(run_current "${ARCHIVED_REPO}" checkpoint "archived R2 smoke" --plan-file plan.json --json | json_field task_id)"
run_current "${ARCHIVED_REPO}" abandon "${ARCHIVED_ID}" --expect-revision 1 --reason "prepare archived R2 smoke" --json >/dev/null
ARCHIVED_TASK="$(find "${ARCHIVED_REPO}/.latch/archive" -path "*/${ARCHIVED_ID}/task.json" -not -path "*/v3-backup/*" -print -quit)"
ARCHIVED_DIR="$(dirname "${ARCHIVED_TASK}")"
ARCHIVED_TASK_SHA="$(shasum -a 256 "${ARCHIVED_DIR}/task.json" | awk '{print $1}')"
ARCHIVED_EVENTS_SHA="$(shasum -a 256 "${ARCHIVED_DIR}/events.jsonl" | awk '{print $1}')"
ARCHIVED_DOWNGRADE="$(run_current "${ARCHIVED_REPO}" downgrade-v2 --task "${ARCHIVED_ID}" --expect-revision 2 --confirm-data-loss --json)"
ARCHIVED_BACKUP="${ARCHIVED_REPO}/$(printf '%s' "${ARCHIVED_DOWNGRADE}" | json_field backup_path)"

assert_downgraded "${ARCHIVED_DIR}/task.json" "${ARCHIVED_DIR}/events.jsonl"
[[ "$(shasum -a 256 "${ARCHIVED_BACKUP}/task.json" | awk '{print $1}')" == "${ARCHIVED_TASK_SHA}" ]]
[[ "$(shasum -a 256 "${ARCHIVED_BACKUP}/events.jsonl" | awk '{print $1}')" == "${ARCHIVED_EVENTS_SHA}" ]]

echo "Frozen v2 CLI R2 smoke passed."
