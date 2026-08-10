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
import { createTaskV4, initTaskStoreV2 } from '../dist/core/task-store.js'

const cli = join(process.cwd(), 'dist/cli.js')
const actor = 'codex:session:context-command'
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-cli-context-'))
  temporaryDirectories.push(directory)
  return directory
}

function write(cwd, path, content) {
  const absolute = join(cwd, path)
  mkdirSync(join(absolute, '..'), { recursive: true })
  writeFileSync(absolute, content)
}

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LATCH_ACTOR: actor },
  })
}

function plan() {
  return {
    goal: '验证 Context command',
    workspace_scope: { paths: ['src/'] },
    scope: ['src/core/context-pack.ts'],
    acceptance: ['context command tests pass'],
    approach: ['使用 schema 4 fixture'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['request -> context'],
    out_of_scope: ['orientation persistence'],
    verification_plan: [],
    open_questions: [],
  }
}

function knowledgeDocument() {
  return `---
id: module
summary: 模块知识
covers:
  - src/map.txt
status: current
last_fingerprint: null
last_fingerprint_algo: sha256-v1
provenance:
  last_verified_task_id: null
  last_verified_at: null
  optional_commit_sha: null
---

# Module
当前说明。
`
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('context pack CLI combines task, freshness, siblings, and requested sources without writes', () => {
  const cwd = temporaryDirectory()
  write(cwd, 'src/map.txt', 'map one\nmap two\nmap three')
  write(cwd, 'src/excerpt.txt', 'skip\nexcerpt')
  write(cwd, 'src/expand.txt', 'expanded')
  write(cwd, 'docs/module.md', knowledgeDocument())
  const store = initTaskStoreV2(cwd)
  const target = createTaskV4(store, {
    title: 'Context target',
    plan: plan(),
    profile: 'standard',
    groupId: 'Wave:Context',
  }, actor).task
  createTaskV4(store, {
    title: 'Context sibling',
    plan: plan(),
    profile: 'standard',
    groupId: 'Wave:Context',
  }, actor)
  write(cwd, 'request.json', `${JSON.stringify({
    task_id: target.id,
    knowledge_paths: ['docs/module.md'],
    sources: [
      { kind: 'map', path: 'src/map.txt', start_line: 1, end_line: 2 },
      { kind: 'excerpt', path: 'src/excerpt.txt', start_line: 2 },
      { kind: 'expand', path: 'src/expand.txt', reason: '补充实现证据' },
    ],
  }, null, 2)}\n`)

  const tracked = [
    join(cwd, '.latch', 'tasks', target.id, 'task.json'),
    join(cwd, '.latch', 'tasks', target.id, 'events.jsonl'),
    join(cwd, '.latch', 'state.json'),
  ]
  const before = tracked.map((path) => readFileSync(path, 'utf8'))
  const result = run(cwd, ['context', 'pack', '--input-file', 'request.json'])
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.meta.task_id, target.id)
  assert.deepEqual(
    output.sections.map((section) => section.kind),
    ['task', 'knowledge', 'map', 'sibling', 'excerpt', 'expand'],
  )
  assert.deepEqual(
    tracked.map((path) => readFileSync(path, 'utf8')),
    before,
  )
})

test('context command validates view selectors without initializing storage', () => {
  const cwd = temporaryDirectory()
  const brief = run(cwd, ['context', 'missing', '--brief'])
  assert.notEqual(brief.status, 0)
  assert.match(brief.stderr, /--brief requires --json/)
  assert.equal(existsSync(join(cwd, '.latch')), false)

  const status = run(cwd, ['context', 'missing', '--status'])
  assert.notEqual(status.status, 0)
  assert.match(status.stderr, /require --json/)
  assert.equal(existsSync(join(cwd, '.latch')), false)

  const review = run(cwd, ['context', 'missing', '--review'])
  assert.notEqual(review.status, 0)
  assert.match(review.stderr, /require --json/)
  assert.equal(existsSync(join(cwd, '.latch')), false)

  for (const selector of ['--brief', '--status', '--since-revision']) {
    const combined = run(cwd, [
      'context', 'missing', '--json', '--review', selector,
      ...(selector === '--since-revision' ? ['0'] : []),
    ])
    assert.notEqual(combined.status, 0)
    assert.match(combined.stderr, /mutually exclusive/)
    assert.equal(existsSync(join(cwd, '.latch')), false)
  }

  const help = run(cwd, ['context', '--help'])
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /--review/)
  assert.match(help.stdout, /--history <timeline\|events\|both>/)
  assert.equal(existsSync(join(cwd, '.latch')), false)
})
