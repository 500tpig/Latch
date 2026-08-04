import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  checkpoint,
  cleanupTemporaryDirectories,
  init,
  plan,
  readTask,
  run,
  taskPath,
  temporaryDirectory,
  writePlan,
} from './cli-test-support.mjs'

test.afterEach(cleanupTemporaryDirectories)

test('save updates a plan, increments revisions, and invalidates approval and verification', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const path = taskPath(cwd, created.task_id)
  const seeded = readTask(cwd, created.task_id)
  seeded.phase = 'review'
  seeded.implementation_approval = {
    approved_plan_revision: 1,
    approved_at: new Date().toISOString(),
    source: 'user',
    reason: 'approved',
  }
  seeded.verification.gate.tests = {
    name: 'tests',
    kind: 'gate',
    command: ['pnpm', 'test'],
    status: 'pass',
    exit_code: 0,
    work_revision: 1,
    created_at: new Date().toISOString(),
  }
  seeded.submission = {
    work_revision: 1,
    changes: 'old',
    verified: 'tests',
    unverified_items: [],
    submitted_at: new Date().toISOString(),
  }
  writeFileSync(path, `${JSON.stringify(seeded, null, 2)}\n`)
  const changedPlan = writePlan(
    cwd,
    plan({ approach: ['先实现 parser，再接 store'] }),
    'changed-plan.json',
  )

  const result = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '1',
    '--plan-file',
    changedPlan,
    '--json',
  ])

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.previous_revision, 1)
  assert.equal(output.revision, 2)
  assert.equal(output.phase, 'plan')
  assert.deepEqual(output.warnings, [])
  const task = readTask(cwd, created.task_id)
  assert.equal(task.plan_revision, 2)
  assert.equal(task.phase, 'plan')
  assert.equal('implementation_approval' in task, false)
  assert.equal('submission' in task, false)
  assert.deepEqual(task.verification, { gate: {}, diagnostic: {} })
})

test('save records decision, artifact, and blocked events in one revision', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)

  const result = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '1',
    '--decision',
    '采用独立 v2 CLI',
    '--question',
    '如何保持 v1 回归？',
    '--answer',
    '使用独立入口',
    '--artifact',
    'doc:docs/example.md',
    '--block-reason',
    '等待字段',
    '--waiting-for',
    '后端确认',
    '--json',
  ])

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).revision, 2)
  const task = readTask(cwd, created.task_id)
  assert.deepEqual(task.artifacts, [{ kind: 'doc', path: 'docs/example.md' }])
  assert.equal(task.blocked.reason, '等待字段')
  const events = readFileSync(
    join(cwd, '.latch', 'tasks', created.task_id, 'events.jsonl'),
    'utf8',
  )
    .trim()
    .split('\n')
    .map(JSON.parse)
  assert.deepEqual(events.map((event) => event.type), [
    'task_created',
    'decision_recorded',
    'artifact_updated',
    'blocked',
  ])
  assert.ok(events.slice(1).every((event) => event.revision === 2))
  assert.deepEqual(events[2].added, ['doc:docs/example.md'])
})

test('save JSON exposes event write warnings without reporting a false failure', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const eventsPath = join(
    cwd,
    '.latch',
    'tasks',
    created.task_id,
    'events.jsonl',
  )
  chmodSync(eventsPath, 0o400)

  const result = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '1',
    '--decision',
    'task.json 是提交点',
    '--json',
  ])

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.revision, 2)
  assert.equal(output.warnings.length, 1)
  assert.match(output.warnings[0], /event was not recorded/)
  assert.equal(readTask(cwd, created.task_id).revision, 2)
})

test('save changes provenance as a standalone root fact', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const before = readTask(cwd, created.task_id)

  const mixed = run(cwd, [
    'save', created.task_id, '--expect-revision', '1',
    '--provenance', 'mixed', '--provenance-reason', '用户允许重叠并行', '--json',
  ])
  assert.equal(mixed.status, 0, mixed.stderr)
  let current = readTask(cwd, created.task_id)
  assert.equal(current.provenance, 'mixed')
  assert.equal(current.revision, 2)
  assert.equal(current.phase, before.phase)
  assert.equal(current.plan_revision, before.plan_revision)
  assert.equal(current.work_revision, before.work_revision)
  assert.deepEqual(current.verification, before.verification)

  const directory = join(cwd, '.latch', 'tasks', created.task_id)
  const events = readFileSync(join(directory, 'events.jsonl'), 'utf8')
    .trim().split('\n').map(JSON.parse)
  assert.equal(events.at(-1).type, 'decision_recorded')
  assert.match(events.at(-1).conclusion, /provenance clean -> mixed/)

  for (const args of [
    ['save', created.task_id, '--expect-revision', '2', '--provenance', 'mixed', '--provenance-reason', 'no-op'],
    ['save', created.task_id, '--expect-revision', '2', '--provenance', 'other', '--provenance-reason', 'invalid'],
    ['save', created.task_id, '--expect-revision', '2', '--provenance', 'clean'],
    ['save', created.task_id, '--expect-revision', '2', '--provenance-reason', 'missing value'],
    ['save', created.task_id, '--expect-revision', '2', '--provenance', 'clean', '--provenance-reason', 'combined', '--decision', 'not standalone'],
  ])
    assert.notEqual(run(cwd, args).status, 0)
  assert.equal(readTask(cwd, created.task_id).provenance, 'mixed')

  const wrongWriter = run(cwd, [
    'save', created.task_id, '--expect-revision', '2',
    '--provenance', 'clean', '--provenance-reason', 'wrong writer',
  ], { actor: 'codex:session:other' })
  assert.notEqual(wrongWriter.status, 0)
  assert.match(wrongWriter.stderr, /Writer mismatch/)

  const clean = run(cwd, [
    'save', created.task_id, '--expect-revision', '2',
    '--provenance', 'clean', '--provenance-reason', '隔离已经恢复', '--json',
  ])
  assert.equal(clean.status, 0, clean.stderr)
  current = readTask(cwd, created.task_id)
  assert.equal(current.provenance, 'clean')
  assert.equal(current.revision, 3)
})

test('save can remove artifacts and explicitly unblock', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const first = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '1',
    '--artifact',
    'doc:docs/example.md',
    '--block-reason',
    '等待字段',
    '--waiting-for',
    '后端',
    '--json',
  ])
  assert.equal(first.status, 0, first.stderr)

  const second = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '2',
    '--remove-artifact',
    'doc:docs/example.md',
    '--unblock',
    '--json',
  ])

  assert.equal(second.status, 0, second.stderr)
  const task = readTask(cwd, created.task_id)
  assert.deepEqual(task.artifacts, [])
  assert.equal('blocked' in task, false)
  assert.equal(task.revision, 3)
})

test('artifact add and remove support multiple values with save-compatible semantics', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const added = run(cwd, [
    'artifact', 'add', created.task_id,
    '--expect-revision', '1',
    'doc:docs/a.md',
    'skill:skills/example.md',
    'doc:docs/a.md',
    '--json',
  ])
  assert.equal(added.status, 0, added.stderr)
  assert.equal(JSON.parse(added.stdout).revision, 2)
  assert.deepEqual(readTask(cwd, created.task_id).artifacts, [
    { kind: 'doc', path: 'docs/a.md' },
    { kind: 'skill', path: 'skills/example.md' },
  ])

  const removed = run(cwd, [
    'artifact', 'remove', created.task_id,
    '--expect-revision', '2',
    'doc:docs/a.md',
    'doc:docs/missing.md',
    '--json',
  ])
  assert.equal(removed.status, 0, removed.stderr)
  assert.equal(JSON.parse(removed.stdout).revision, 3)
  assert.deepEqual(readTask(cwd, created.task_id).artifacts, [
    { kind: 'skill', path: 'skills/example.md' },
  ])

  const events = readFileSync(
    join(cwd, '.latch', 'tasks', created.task_id, 'events.jsonl'),
    'utf8',
  ).trim().split('\n').map(JSON.parse)
  assert.deepEqual(events.slice(-2).map((event) => event.type), [
    'artifact_updated',
    'artifact_updated',
  ])
  assert.deepEqual(events.at(-2).added, [
    'doc:docs/a.md',
    'skill:skills/example.md',
  ])
  assert.deepEqual(events.at(-1).removed, ['doc:docs/a.md'])

  const noOp = run(cwd, [
    'artifact', 'remove', created.task_id,
    '--expect-revision', '3',
    'doc:docs/missing.md',
  ])
  assert.notEqual(noOp.status, 0)
  assert.match(noOp.stderr, /did not contain any effective change/)
  assert.equal(readTask(cwd, created.task_id).revision, 3)
})

test('save rejects stale revision and no-op without modifying task or events', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const directory = join(cwd, '.latch', 'tasks', created.task_id)
  const before = {
    task: readFileSync(join(directory, 'task.json'), 'utf8'),
    events: readFileSync(join(directory, 'events.jsonl'), 'utf8'),
  }

  const stale = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '2',
    '--decision',
    'stale',
  ])
  assert.notEqual(stale.status, 0)
  assert.match(stale.stderr, /expected revision 2, current revision 1/)

  const noOp = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '1',
    '--remove-artifact',
    'doc:missing.md',
  ])
  assert.notEqual(noOp.status, 0)
  assert.match(noOp.stderr, /did not contain any effective change/)

  assert.deepEqual(
    {
      task: readFileSync(join(directory, 'task.json'), 'utf8'),
      events: readFileSync(join(directory, 'events.jsonl'), 'utf8'),
    },
    before,
  )
})

test('save validates blocked arguments before writing', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const before = readFileSync(taskPath(cwd, created.task_id), 'utf8')

  for (const args of [
    ['--block-reason', 'missing waiting-for'],
    ['--waiting-for', 'missing reason'],
    ['--unblock', '--block-reason', 'x', '--waiting-for', 'y'],
  ]) {
    const result = run(cwd, [
      'save',
      created.task_id,
      '--expect-revision',
      '1',
      ...args,
    ])
    assert.notEqual(result.status, 0)
  }
  assert.equal(readFileSync(taskPath(cwd, created.task_id), 'utf8'), before)
})
