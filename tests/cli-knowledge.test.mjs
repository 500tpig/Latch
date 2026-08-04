import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createTaskV5, initTaskStoreV2 } from '../dist/core/task-store.js'

const cli = join(process.cwd(), 'dist/cli.js')
const actor = 'codex:session:knowledge'
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-cli-knowledge-'))
  temporaryDirectories.push(directory)
  return directory
}

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LATCH_ACTOR: actor },
  })
}

function write(cwd, path, content) {
  const absolute = join(cwd, path)
  mkdirSync(join(absolute, '..'), { recursive: true })
  writeFileSync(absolute, content)
}

function frontmatter() {
  return `---
id: module
summary: 模块知识
covers:
  - src/a.ts
status: current
last_fingerprint: null
last_fingerprint_algo: sha256-v1
provenance:
  last_verified_task_id: null
  last_verified_at: null
  optional_commit_sha: null
---

# Module
`
}

function plan() {
  return {
    goal: '验证知识 freshness',
    workspace_scope: { paths: ['src/'] },
    scope: ['src/core/knowledge.ts'],
    acceptance: ['knowledge tests pass'],
    approach: ['使用 schema 5 fixture'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['submit -> knowledge check'],
    out_of_scope: ['baseline writeback'],
    verification_plan: [],
    open_questions: [],
  }
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('knowledge CLI checks paths without initializing storage and follows task artifacts', () => {
  const cwd = temporaryDirectory()
  write(cwd, 'src/a.ts', 'alpha\n')
  write(cwd, 'docs/module.md', frontmatter())
  const before = readFileSync(join(cwd, 'docs/module.md'), 'utf8')

  const direct = run(cwd, [
    'knowledge', 'check', '--path', 'docs/module.md', '--json',
  ])
  assert.equal(direct.status, 0, direct.stderr)
  assert.equal(JSON.parse(direct.stdout).knowledge.freshness, 'baseline_missing')
  assert.equal(existsSync(join(cwd, '.latch')), false)
  assert.equal(readFileSync(join(cwd, 'docs/module.md'), 'utf8'), before)

  const store = initTaskStoreV2(cwd)
  const task = createTaskV5(store, {
    title: 'Knowledge task',
    plan: plan(),
    profile: 'standard',
    workBasis: {
      kind: 'implementation_authorization',
      source: 'user_request',
      reason: '检查知识 artifact',
      scope: { summary: '检查知识 artifact' },
    },
    artifacts: [{ kind: 'knowledge', path: 'docs/module.md' }],
  }, actor).task
  write(cwd, 'impact.json', JSON.stringify({
    kind: 'updated',
    summary: '更新模块知识',
    artifact_refs: [{ kind: 'knowledge', path: 'docs/module.md' }],
  }))
  const submitted = run(cwd, [
    'submit', task.id, '--expect-revision', '1',
    '--changes', '更新知识',
    '--knowledge-impact-file', 'impact.json',
    '--no-verify', '--reason', 'plan 无 gate', '--json',
  ])
  assert.equal(submitted.status, 0, submitted.stderr)

  const taskPath = join(cwd, '.latch', 'tasks', task.id, 'task.json')
  const eventsPath = join(cwd, '.latch', 'tasks', task.id, 'events.jsonl')
  const statePath = join(cwd, '.latch', 'state.json')
  const beforeCheck = [taskPath, eventsPath, statePath].map((path) =>
    readFileSync(path, 'utf8'),
  )
  const checked = run(cwd, [
    'knowledge', 'check', '--task', task.id, '--json',
  ])
  assert.equal(checked.status, 0, checked.stderr)
  const output = JSON.parse(checked.stdout)
  assert.equal(output.task_id, task.id)
  assert.equal(output.documents[0].artifact.path, 'docs/module.md')
  assert.deepEqual(
    [taskPath, eventsPath, statePath].map((path) => readFileSync(path, 'utf8')),
    beforeCheck,
  )
})
