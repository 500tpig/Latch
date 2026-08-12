import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const cli = join(process.cwd(), 'dist/cli.js')
const temporaryDirectories = []

export function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-v2-cli-'))
  temporaryDirectories.push(directory)
  return directory
}
export function run(cwd, args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    input: options.input,
    env: {
      ...process.env,
      LATCH_ACTOR: options.actor ?? 'codex:session:test-session',
    },
  })
}

export function plan(overrides = {}) {
  return {
    goal: '实现 v2 CLI',
    workspace_scope: { paths: ['src/'] },
    scope: ['src/cli.ts'],
    acceptance: ['CLI tests pass'],
    approach: ['使用 node:util.parseArgs'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['init -> checkpoint -> save'],
    out_of_scope: ['approve'],
    verification_plan: [
      { name: 'tests', command: ['pnpm', 'test'], kind: 'gate' },
    ],
    open_questions: [],
    ...overrides,
  }
}

export function writePlan(cwd, value = plan(), name = 'plan.json') {
  const path = join(cwd, name)
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  return name
}

export function init(cwd) {
  const result = run(cwd, ['init'])
  assert.equal(result.status, 0, result.stderr)
}

export function checkpoint(cwd, title = 'CLI task', overrides = {}) {
  const planFile = writePlan(cwd, plan(overrides))
  const result = run(cwd, [
    'checkpoint',
    title,
    '--plan-file',
    planFile,
    '--json',
  ])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

export function taskIds(cwd) {
  return readdirSync(join(cwd, '.latch', 'tasks'))
}

export function taskPath(cwd, id) {
  return join(cwd, '.latch', 'tasks', id, 'task.json')
}

export function readTask(cwd, id) {
  return JSON.parse(readFileSync(taskPath(cwd, id), 'utf8'))
}

export function cleanupTemporaryDirectories() {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
}
