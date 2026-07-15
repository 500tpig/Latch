import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  createTaskV3,
  initTaskStoreV2,
} from '../dist/core/task-store.js'
import {
  readTaskEventsV2,
  readTaskEventsV3,
} from '../dist/core/notes-events.js'
import { actorId, isWritableActor } from '../dist/core/actor.js'

const cli = join(process.cwd(), 'dist/cli.js')
const writerA = 'codex:session:writer-a'
const writerB = 'claude:session:writer-b'
const writerC = 'opencode:session:writer-c'
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-v3-actor-'))
  temporaryDirectories.push(directory)
  return directory
}

function run(cwd, args, actor = writerA) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LATCH_ACTOR: actor },
  })
}

function plan(overrides = {}) {
  return {
    goal: '验证 actor writer affinity',
    scope: ['temporary fixture'],
    acceptance: ['actor tests pass'],
    approach: ['使用 schema 3 fixture'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['claim -> takeover'],
    out_of_scope: ['R2 product command'],
    verification_plan: [],
    open_questions: [],
    ...overrides,
  }
}

function writePlan(cwd) {
  writeFileSync(join(cwd, 'plan.json'), `${JSON.stringify(plan(), null, 2)}\n`)
}

function taskDirectory(cwd, id) {
  return join(cwd, '.latch', 'tasks', id)
}

function taskPath(cwd, id) {
  return join(taskDirectory(cwd, id), 'task.json')
}

function readTask(cwd, id) {
  return JSON.parse(readFileSync(taskPath(cwd, id), 'utf8'))
}

function writeTask(cwd, task) {
  writeFileSync(taskPath(cwd, task.id), `${JSON.stringify(task, null, 2)}\n`)
}

function createV3(cwd, actor = writerA) {
  const store = initTaskStoreV2(cwd)
  return createTaskV3(store, { title: 'actor fixture', plan: plan() }, actor).task
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('canonical actor parsing uses a session-scoped Codex thread id', () => {
  assert.equal(isWritableActor('codex:session:thread-1'), true)
  assert.equal(isWritableActor('codex:session:DEFAULT'), false)
  assert.equal(isWritableActor('codex:default:thread-1'), false)
  assert.equal(isWritableActor('codex:thread-1'), false)

  const latchActor = process.env.LATCH_ACTOR
  const threadId = process.env.CODEX_THREAD_ID
  try {
    delete process.env.LATCH_ACTOR
    process.env.CODEX_THREAD_ID = 'thread-1'
    assert.equal(actorId(), 'codex:session:thread-1')
    process.env.LATCH_ACTOR = ''
    assert.equal(actorId(), '')
  } finally {
    if (latchActor === undefined) delete process.env.LATCH_ACTOR
    else process.env.LATCH_ACTOR = latchActor
    if (threadId === undefined) delete process.env.CODEX_THREAD_ID
    else process.env.CODEX_THREAD_ID = threadId
  }
})

test('invalid actors cannot write or use current while explicit reads remain available', () => {
  const cwd = temporaryDirectory()
  assert.equal(run(cwd, ['init'], 'unknown:default').status, 0)
  writePlan(cwd)

  const rejected = run(
    cwd,
    ['checkpoint', 'rejected', '--plan-file', 'plan.json'],
    'claude:default',
  )
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /Actor not writable: claude:default/)
  assert.match(rejected.stderr, /LATCH_ACTOR=<tool>:session:<opaque-id>/)

  const task = createV3(cwd)
  assert.equal(run(cwd, ['list', '--json'], '').status, 0)
  assert.equal(run(cwd, ['context', task.id, '--json'], '').status, 0)

  const implicitContext = run(cwd, ['context', '--json'], '')
  assert.notEqual(implicitContext.status, 0)
  assert.match(implicitContext.stderr, /Actor required for context without task id/)

  const use = run(cwd, ['use', task.id], 'codex:default')
  assert.notEqual(use.status, 0)
  assert.match(use.stderr, /Actor not writable: codex:default/)

  const approve = run(
    cwd,
    ['approve', task.id, '--expect-revision', '1', '--reason', 'approved'],
    'unknown:default',
  )
  assert.notEqual(approve.status, 0)
  assert.equal(readTask(cwd, task.id).revision, 1)
})

test('default checkpoint remains v2 and cannot append writer events', () => {
  const cwd = temporaryDirectory()
  assert.equal(run(cwd, ['init']).status, 0)
  writePlan(cwd)
  const created = run(cwd, [
    'checkpoint',
    'v2 compatibility',
    '--plan-file',
    'plan.json',
    '--json',
  ])
  assert.equal(created.status, 0, created.stderr)
  const id = JSON.parse(created.stdout).task_id
  const beforeTask = readFileSync(taskPath(cwd, id), 'utf8')
  const eventsPath = join(taskDirectory(cwd, id), 'events.jsonl')
  const beforeEvents = readFileSync(eventsPath, 'utf8')

  const task = readTask(cwd, id)
  assert.equal(task.schema_version, 2)
  assert.equal('primary_writer' in task, false)
  assert.deepEqual(beforeEvents.trim().split('\n').map(JSON.parse).map((event) => event.type), [
    'task_created',
  ])

  const claim = run(cwd, [
    'claim',
    id,
    '--expect-revision',
    '1',
    '--reason',
    'continue-request',
  ])
  assert.notEqual(claim.status, 0)
  assert.match(claim.stderr, /requires schema_version 3/)
  assert.equal(readFileSync(taskPath(cwd, id), 'utf8'), beforeTask)
  assert.equal(readFileSync(eventsPath, 'utf8'), beforeEvents)

  task.primary_writer = writerA
  writeTask(cwd, task)
  const mixedSchema = run(cwd, ['context', id, '--json'])
  assert.notEqual(mixedSchema.status, 0)
  assert.match(mixedSchema.stderr, /schema_version 3 is required/)
})

test('schema 3 creation binds the primary writer and use does not grant writes', () => {
  const cwd = temporaryDirectory()
  const task = createV3(cwd)
  assert.equal(task.schema_version, 3)
  assert.equal(task.primary_writer, writerA)

  const use = run(cwd, ['use', task.id], writerB)
  assert.equal(use.status, 0, use.stderr)
  const denied = run(cwd, [
    'approve',
    task.id,
    '--expect-revision',
    '1',
    '--reason',
    'approved',
  ], writerB)
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /Writer mismatch/)
  assert.equal(readTask(cwd, task.id).revision, 1)

  const approved = run(cwd, [
    'approve',
    task.id,
    '--expect-revision',
    '1',
    '--reason',
    'approved',
  ])
  assert.equal(approved.status, 0, approved.stderr)
  assert.equal(readTask(cwd, task.id).phase, 'dev')

  const sideEffect = join(cwd, 'verification-ran')
  const verify = run(cwd, [
    'verify',
    task.id,
    '--expect-revision',
    '2',
    '--name',
    'writer-check',
    '--diagnostic',
    '--',
    process.execPath,
    '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(sideEffect)}, 'ran')`,
  ], writerB)
  assert.notEqual(verify.status, 0)
  assert.match(verify.stderr, /Writer mismatch/)
  assert.equal(existsSync(sideEffect), false)
})

test('legacy schema 3 task requires claim and preserves lifecycle facts', () => {
  const cwd = temporaryDirectory()
  const task = createV3(cwd)
  assert.equal(run(cwd, [
    'approve',
    task.id,
    '--expect-revision',
    '1',
    '--reason',
    'approved',
  ]).status, 0)
  assert.equal(run(cwd, [
    'submit',
    task.id,
    '--expect-revision',
    '2',
    '--changes',
    'done',
    '--unverified',
    '',
    '--no-verify',
    '--reason',
    'fixture',
  ]).status, 0)

  const legacy = readTask(cwd, task.id)
  delete legacy.primary_writer
  writeTask(cwd, legacy)
  const before = readTask(cwd, task.id)

  const denied = run(cwd, [
    'save',
    task.id,
    '--expect-revision',
    '3',
    '--block-reason',
    'waiting',
    '--waiting-for',
    'user',
  ], writerB)
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /legacy_unclaimed/)

  const claimed = run(cwd, [
    'claim',
    task.id,
    '--expect-revision',
    '3',
    '--reason',
    'continue-request',
    '--json',
  ], writerB)
  assert.equal(claimed.status, 0, claimed.stderr)
  const after = readTask(cwd, task.id)
  assert.equal(after.primary_writer, writerB)
  assert.equal(after.revision, 4)
  for (const field of ['phase', 'work_revision', 'implementation_approval', 'verification', 'submission'])
    assert.deepEqual(after[field], before[field])

  const events = readTaskEventsV3(taskDirectory(cwd, task.id))
  assert.deepEqual(events.at(-1), {
    type: 'writer_claimed',
    task_id: task.id,
    actor: writerB,
    revision: 4,
    created_at: events.at(-1).created_at,
    reason: 'continue-request',
  })
  assert.throws(
    () => readTaskEventsV2(taskDirectory(cwd, task.id)),
    /Invalid event type/,
  )

  const secondClaim = run(cwd, [
    'claim',
    task.id,
    '--expect-revision',
    '4',
  ], writerC)
  assert.notEqual(secondClaim.status, 0)
  assert.match(secondClaim.stderr, /Use takeover, not claim/)
})

test('takeover is explicit, preserves phase, and excludes the previous writer', () => {
  const cwd = temporaryDirectory()
  const task = createV3(cwd)

  const readOnly = run(cwd, ['context', task.id, '--json'], writerB)
  assert.equal(readOnly.status, 0, readOnly.stderr)
  assert.equal(readTask(cwd, task.id).revision, 1)

  const takeover = run(cwd, [
    'takeover',
    task.id,
    '--expect-revision',
    '1',
    '--reason',
    'explicit-handoff',
    '--json',
  ], writerB)
  assert.equal(takeover.status, 0, takeover.stderr)
  const output = JSON.parse(takeover.stdout)
  assert.match(output.warnings[0], /shared Git worktree/)
  const transferred = readTask(cwd, task.id)
  assert.equal(transferred.primary_writer, writerB)
  assert.equal(transferred.phase, 'plan')
  assert.equal(transferred.revision, 2)

  const events = readTaskEventsV3(taskDirectory(cwd, task.id))
  assert.deepEqual(events.at(-1), {
    type: 'writer_taken_over',
    task_id: task.id,
    actor: writerB,
    revision: 2,
    created_at: events.at(-1).created_at,
    from: writerA,
    to: writerB,
    reason: 'explicit-handoff',
  })

  const oldWriter = run(cwd, [
    'approve',
    task.id,
    '--expect-revision',
    '2',
    '--reason',
    'approved',
  ], writerA)
  assert.notEqual(oldWriter.status, 0)
  assert.match(oldWriter.stderr, /Writer mismatch/)

  const newWriter = run(cwd, [
    'approve',
    task.id,
    '--expect-revision',
    '2',
    '--reason',
    'approved',
  ], writerB)
  assert.equal(newWriter.status, 0, newWriter.stderr)
})

test('invalid primary_writer values are schema errors, not legacy tasks', () => {
  for (const primaryWriter of ['', 'claude:default', 'invalid', null]) {
    const cwd = temporaryDirectory()
    const task = createV3(cwd)
    task.primary_writer = primaryWriter
    writeTask(cwd, task)

    const context = run(cwd, ['context', task.id, '--json'])
    assert.notEqual(context.status, 0)
    assert.match(context.stderr, /Invalid primary_writer/)
  }
})
