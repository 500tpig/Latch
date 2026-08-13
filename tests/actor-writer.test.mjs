import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  createTaskV2,
  createTaskV5,
  initTaskStoreV2,
} from '../dist/core/task-store.js'
import {
  readTaskEventsV2,
  readTaskEventsV3,
} from '../dist/core/notes-events.js'
import { actorId, isWritableActor } from '../dist/core/actor.js'
import {
  injectHostActor,
  resolveGrokSessionFromActiveSessions,
} from '../dist/host-adapter.js'

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

function runWithEnvironment(cwd, args, environment) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: environment,
  })
}

function plan(overrides = {}) {
  return {
    goal: '验证 actor writer affinity',
    workspace_scope: { paths: ['src/'] },
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

function archivedTaskPath(cwd, id) {
  const archiveRoot = join(cwd, '.latch', 'archive')
  for (const month of readdirSync(archiveRoot)) {
    const path = join(archiveRoot, month, id, 'task.json')
    if (existsSync(path)) return path
  }
  throw new Error(`Archived task not found: ${id}`)
}

function createV3(cwd, actor = writerA) {
  const store = initTaskStoreV2(cwd)
  const task = createTaskV5(
    store,
    { title: 'actor fixture', plan: plan(), profile: 'standard' },
    actor,
  ).task
  return task
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('host adapter injects Codex and Grok actors without expanding Core host detection', () => {
  assert.equal(isWritableActor('codex:session:thread-1'), true)
  assert.equal(isWritableActor('grok:session:session-1'), true)
  assert.equal(isWritableActor('codex:session:DEFAULT'), false)
  assert.equal(isWritableActor('codex:default:thread-1'), false)
  assert.equal(isWritableActor('codex:thread-1'), false)

  const latchActor = process.env.LATCH_ACTOR
  const threadId = process.env.CODEX_THREAD_ID
  const grokSession = process.env.GROK_SESSION_ID
  const grokAgent = process.env.GROK_AGENT
  try {
    delete process.env.LATCH_ACTOR
    delete process.env.GROK_SESSION_ID
    delete process.env.GROK_AGENT
    process.env.CODEX_THREAD_ID = 'thread-1'
    assert.equal(actorId(), 'unknown:default')
    injectHostActor()
    assert.equal(actorId(), 'codex:session:thread-1')

    process.env.LATCH_ACTOR = ''
    injectHostActor()
    assert.equal(actorId(), '')

    process.env.LATCH_ACTOR = 'adapter:session:session-1'
    injectHostActor()
    assert.equal(actorId(), 'adapter:session:session-1')

    delete process.env.LATCH_ACTOR
    delete process.env.CODEX_THREAD_ID
    process.env.GROK_SESSION_ID = 'grok-session-1'
    injectHostActor()
    assert.equal(actorId(), 'grok:session:grok-session-1')

    // Codex wins over Grok when both host ids are present.
    delete process.env.LATCH_ACTOR
    process.env.CODEX_THREAD_ID = 'thread-2'
    process.env.GROK_SESSION_ID = 'grok-session-2'
    injectHostActor()
    assert.equal(actorId(), 'codex:session:thread-2')

    delete process.env.LATCH_ACTOR
    delete process.env.CODEX_THREAD_ID
    delete process.env.GROK_SESSION_ID
    delete process.env.GROK_AGENT
    // Isolate from a real Grok tool shell that may export GROK_AGENT.
    injectHostActor(process.env, {
      resolveGrokSessionId: () => undefined,
    })
    assert.equal(actorId(), 'unknown:default')
    assert.equal(isWritableActor(actorId()), false)

    // GROK_AGENT without a resolvable session stays read-only.
    process.env.GROK_AGENT = '1'
    injectHostActor(process.env, {
      resolveGrokSessionId: () => undefined,
    })
    assert.equal(actorId(), 'unknown:default')

    delete process.env.LATCH_ACTOR
    injectHostActor(process.env, {
      resolveGrokSessionId: () => 'resolved-from-host',
    })
    assert.equal(actorId(), 'grok:session:resolved-from-host')

    // Explicit empty LATCH_ACTOR still fails closed even with Grok host signals.
    process.env.LATCH_ACTOR = ''
    injectHostActor(process.env, {
      resolveGrokSessionId: () => 'should-not-apply',
    })
    assert.equal(actorId(), '')
  } finally {
    if (latchActor === undefined) delete process.env.LATCH_ACTOR
    else process.env.LATCH_ACTOR = latchActor
    if (threadId === undefined) delete process.env.CODEX_THREAD_ID
    else process.env.CODEX_THREAD_ID = threadId
    if (grokSession === undefined) delete process.env.GROK_SESSION_ID
    else process.env.GROK_SESSION_ID = grokSession
    if (grokAgent === undefined) delete process.env.GROK_AGENT
    else process.env.GROK_AGENT = grokAgent
  }
})

test('Grok active_sessions pid match injects only on unique ancestor match', () => {
  const sessionsPath = join(temporaryDirectory(), 'active_sessions.json')
  writeFileSync(
    sessionsPath,
    `${JSON.stringify([
      { session_id: 'sess-a', pid: 100 },
      { session_id: 'sess-b', pid: 200 },
    ])}\n`,
  )

  const parents = new Map([
    [10, 100],
    [100, 1],
  ])
  const readParentPid = (pid) => parents.get(pid)

  assert.equal(
    resolveGrokSessionFromActiveSessions(
      {},
      { grokActiveSessionsPath: sessionsPath, readParentPid },
      10,
    ),
    'sess-a',
  )

  // Multiple distinct sessions on the chain → fail closed.
  parents.set(10, 100)
  parents.set(100, 200)
  parents.set(200, 1)
  assert.equal(
    resolveGrokSessionFromActiveSessions(
      {},
      { grokActiveSessionsPath: sessionsPath, readParentPid },
      10,
    ),
    undefined,
  )

  // No match → fail closed.
  assert.equal(
    resolveGrokSessionFromActiveSessions(
      {},
      { grokActiveSessionsPath: sessionsPath, readParentPid },
      999,
    ),
    undefined,
  )
})

test('Codex adapter enables checkpoint only with a stable thread id', () => {
  const cwd = temporaryDirectory()
  const environment = { ...process.env, CODEX_THREAD_ID: 'codex-thread-1' }
  delete environment.LATCH_ACTOR
  delete environment.GROK_SESSION_ID
  delete environment.GROK_AGENT
  assert.equal(runWithEnvironment(cwd, ['init'], environment).status, 0)
  writePlan(cwd)

  const created = runWithEnvironment(
    cwd,
    ['checkpoint', 'Codex task', '--plan-file', 'plan.json', '--json'],
    environment,
  )
  assert.equal(created.status, 0, created.stderr)
  const task = readTask(cwd, JSON.parse(created.stdout).task_id)
  assert.equal(task.primary_writer, 'codex:session:codex-thread-1')

  const explicitlyEmpty = runWithEnvironment(
    cwd,
    ['checkpoint', 'Rejected task', '--plan-file', 'plan.json'],
    { ...environment, LATCH_ACTOR: '' },
  )
  assert.notEqual(explicitlyEmpty.status, 0)
  assert.match(explicitlyEmpty.stderr, /Actor not writable: \(empty\)/)
})

test('Grok adapter enables checkpoint with GROK_SESSION_ID and rejects empty LATCH_ACTOR', () => {
  const cwd = temporaryDirectory()
  const environment = {
    ...process.env,
    GROK_SESSION_ID: 'grok-thread-1',
    GROK_AGENT: '1',
  }
  delete environment.LATCH_ACTOR
  delete environment.CODEX_THREAD_ID
  assert.equal(runWithEnvironment(cwd, ['init'], environment).status, 0)
  writePlan(cwd)

  const created = runWithEnvironment(
    cwd,
    ['checkpoint', 'Grok task', '--plan-file', 'plan.json', '--json'],
    environment,
  )
  assert.equal(created.status, 0, created.stderr)
  const task = readTask(cwd, JSON.parse(created.stdout).task_id)
  assert.equal(task.primary_writer, 'grok:session:grok-thread-1')

  const explicitlyEmpty = runWithEnvironment(
    cwd,
    ['checkpoint', 'Rejected Grok task', '--plan-file', 'plan.json'],
    { ...environment, LATCH_ACTOR: '' },
  )
  assert.notEqual(explicitlyEmpty.status, 0)
  assert.match(explicitlyEmpty.stderr, /Actor not writable: \(empty\)/)
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
  assert.match(rejected.stderr, /host adapter must provide LATCH_ACTOR/i)

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

test('default checkpoint creates schema 5 and candidate CLI leaves legacy v2 to its matching runner', () => {
  const cwd = temporaryDirectory()
  assert.equal(run(cwd, ['init']).status, 0)
  writePlan(cwd)
  const created = run(cwd, [
    'checkpoint',
    'schema 5 default',
    '--plan-file',
    'plan.json',
    '--json',
  ])
  assert.equal(created.status, 0, created.stderr)
  const id = JSON.parse(created.stdout).task_id
  const task = readTask(cwd, id)
  assert.equal(task.schema_version, 5)
  assert.equal(task.min_writer_version, '0.5.0')
  assert.equal(task.profile, 'standard')
  assert.equal(task.primary_writer, writerA)

  const store = initTaskStoreV2(cwd)
  const legacy = createTaskV2(
    store,
    { title: 'legacy v2', plan: plan() },
    writerA,
  ).task
  const eventsPath = join(taskDirectory(cwd, legacy.id), 'events.jsonl')
  const beforeTask = readFileSync(taskPath(cwd, legacy.id), 'utf8')
  const beforeEvents = readFileSync(eventsPath, 'utf8')

  const denied = run(cwd, [
    'save', legacy.id, '--expect-revision', '1',
    '--block-reason', 'waiting', '--waiting-for', 'user',
  ])
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /Latch CLI 0\.6\.0 only mutates schema_version 5/)
  assert.equal(readFileSync(taskPath(cwd, legacy.id), 'utf8'), beforeTask)
  assert.equal(readFileSync(eventsPath, 'utf8'), beforeEvents)

  const claim = run(cwd, [
    'claim',
    legacy.id,
    '--expect-revision',
    '1',
    '--reason',
    'continue-request',
  ])
  assert.notEqual(claim.status, 0)
  assert.match(claim.stderr, /requires its matching runner for schema_version 2/)
  assert.equal(readFileSync(taskPath(cwd, legacy.id), 'utf8'), beforeTask)
  assert.equal(readFileSync(eventsPath, 'utf8'), beforeEvents)
})

test('schema 5 creation binds the primary writer and use does not grant writes', () => {
  const cwd = temporaryDirectory()
  const task = createV3(cwd)
  assert.equal(task.schema_version, 5)
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

test('schema 3 task requires explicit upgrade-v4 and preserves lifecycle facts', () => {
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
    '--knowledge-impact-none',
    'fixture has no knowledge impact',
    '--no-verify',
    '--reason',
    'fixture',
  ]).status, 0)

  const legacy = readTask(cwd, task.id)
  legacy.schema_version = 3
  delete legacy.min_writer_version
  legacy.submission.unverified = legacy.submission.unverified_items
    .map((item) => item.summary)
    .join('; ')
  delete legacy.submission.unverified_items
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
  ], writerA)
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /requires its matching runner for schema_version 3/)
  assert.deepEqual(readTask(cwd, task.id), before)
  return

  const writerMismatch = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision',
    '3',
  ], writerB)
  assert.notEqual(writerMismatch.status, 0)
  assert.match(writerMismatch.stderr, /Writer mismatch/)
  assert.match(writerMismatch.stderr, /--recover-writer --reason <text>/)
  assert.deepEqual(readTask(cwd, task.id), before)

  const staleUpgrade = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision',
    '2',
  ], writerA)
  assert.notEqual(staleUpgrade.status, 0)
  assert.match(staleUpgrade.stderr, /expected revision 2, current revision 3/)
  assert.deepEqual(readTask(cwd, task.id), before)

  const upgraded = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision',
    '3',
    '--json',
  ], writerA)
  assert.equal(upgraded.status, 0, upgraded.stderr)
  const output = JSON.parse(upgraded.stdout)
  assert.equal(output.schema_version, 2)
  assert.equal(output.task_schema_version, 4)
  assert.equal(output.primary_writer, writerA)
  assert.equal(output.writer_recovered, false)
  const after = readTask(cwd, task.id)
  assert.equal(after.schema_version, 4)
  assert.equal(after.min_writer_version, '0.4.0')
  assert.equal(after.primary_writer, writerA)
  assert.equal(after.revision, 4)
  for (const field of ['phase', 'work_revision', 'implementation_approval', 'verification', 'submission'])
    assert.deepEqual(after[field], before[field])

  const events = readTaskEventsV3(taskDirectory(cwd, task.id))
  assert.deepEqual(events.at(-1), {
    type: 'schema_upgraded',
    task_id: task.id,
    actor: writerA,
    revision: 4,
    created_at: events.at(-1).created_at,
    from_schema_version: 3,
    to_schema_version: 4,
    min_writer_version: '0.4.0',
  })
  assert.throws(
    () => readTaskEventsV2(taskDirectory(cwd, task.id)),
    /Invalid event type/,
  )

  const secondUpgrade = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision',
    '4',
  ], writerA)
  assert.notEqual(secondUpgrade.status, 0)
  assert.match(secondUpgrade.stderr, /requires an open schema_version 3 task/)

  const schema2 = createTaskV2(
    initTaskStoreV2(cwd),
    { title: 'schema 2 upgrade rejection', plan: plan() },
    writerA,
  ).task
  const schema2Upgrade = run(cwd, [
    'upgrade-v4',
    '--task', schema2.id,
    '--expect-revision',
    '1',
  ], writerA)
  assert.notEqual(schema2Upgrade.status, 0)
  assert.match(schema2Upgrade.stderr, /requires an open schema_version 3 task/)

  const schema2Recovery = run(cwd, [
    'upgrade-v4',
    '--task', schema2.id,
    '--expect-revision',
    '1',
    '--recover-writer',
    '--reason',
    'schema 2 must use claim',
  ], writerB)
  assert.notEqual(schema2Recovery.status, 0)
  assert.match(schema2Recovery.stderr, /requires an open schema_version 3 task/)

  const archivedSource = createV3(cwd)
  const archived = run(cwd, [
    'abandon',
    archivedSource.id,
    '--expect-revision',
    '1',
    '--reason',
    'archive upgrade rejection fixture',
  ], writerA)
  assert.equal(archived.status, 0, archived.stderr)
  const archivedPath = archivedTaskPath(cwd, archivedSource.id)
  const archivedSchema3 = JSON.parse(readFileSync(archivedPath, 'utf8'))
  archivedSchema3.schema_version = 3
  delete archivedSchema3.min_writer_version
  writeFileSync(archivedPath, `${JSON.stringify(archivedSchema3, null, 2)}\n`)
  const archivedUpgrade = run(cwd, [
    'upgrade-v4',
    '--task', archivedSource.id,
    '--expect-revision',
    '2',
  ], writerA)
  assert.notEqual(archivedUpgrade.status, 0)
  assert.match(archivedUpgrade.stderr, /Task not found/)
  const archivedRecovery = run(cwd, [
    'upgrade-v4',
    '--task', archivedSource.id,
    '--expect-revision',
    '2',
    '--recover-writer',
    '--reason',
    'archive remains read-only',
  ], writerB)
  assert.notEqual(archivedRecovery.status, 0)
  assert.match(archivedRecovery.stderr, /Task not found/)
  assert.deepEqual(
    JSON.parse(readFileSync(archivedPath, 'utf8')),
    archivedSchema3,
  )
})

test('upgrade-v4 recovery explicitly transfers schema 3 writer ownership', () => {
  const cwd = temporaryDirectory()
  const task = createV3(cwd, writerA)
  const legacy = readTask(cwd, task.id)
  legacy.schema_version = 3
  delete legacy.min_writer_version
  writeTask(cwd, legacy)
  const before = readTask(cwd, task.id)
  const beforeEvents = readFileSync(
    join(taskDirectory(cwd, task.id), 'events.jsonl'),
    'utf8',
  )

  const missingReason = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision', '1',
    '--recover-writer',
  ], writerB)
  assert.notEqual(missingReason.status, 0)
  assert.match(missingReason.stderr, /--reason is required with --recover-writer/)
  assert.deepEqual(readTask(cwd, task.id), before)

  const routed = run(cwd, [
    'upgrade-v4', '--task', task.id, '--expect-revision', '1',
    '--recover-writer', '--reason', 'matching runner required',
  ], writerB)
  assert.notEqual(routed.status, 0)
  assert.match(routed.stderr, /requires its matching runner for schema_version 3/)
  assert.deepEqual(readTask(cwd, task.id), before)
  assert.equal(
    readFileSync(join(taskDirectory(cwd, task.id), 'events.jsonl'), 'utf8'),
    beforeEvents,
  )
  return

  const blankReason = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision', '1',
    '--recover-writer',
    '--reason', '   ',
  ], writerB)
  assert.notEqual(blankReason.status, 0)
  assert.match(blankReason.stderr, /Invalid reason in upgrade-v4 recovery input/)
  assert.deepEqual(readTask(cwd, task.id), before)

  const unusedReason = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision', '1',
    '--reason', 'unused recovery reason',
  ], writerB)
  assert.notEqual(unusedReason.status, 0)
  assert.match(unusedReason.stderr, /--reason requires --recover-writer/)
  assert.deepEqual(readTask(cwd, task.id), before)

  const sameWriter = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision', '1',
    '--recover-writer',
    '--reason', 'no ownership transfer',
  ], writerA)
  assert.notEqual(sameWriter.status, 0)
  assert.match(sameWriter.stderr, /primary_writer is already/)
  assert.deepEqual(readTask(cwd, task.id), before)

  const staleRecovery = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision', '2',
    '--recover-writer',
    '--reason', 'stale recovery',
  ], writerB)
  assert.notEqual(staleRecovery.status, 0)
  assert.match(staleRecovery.stderr, /expected revision 2, current revision 1/)
  assert.deepEqual(readTask(cwd, task.id), before)
  assert.equal(
    readFileSync(join(taskDirectory(cwd, task.id), 'events.jsonl'), 'utf8'),
    beforeEvents,
  )

  const recovered = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision', '1',
    '--recover-writer',
    '--reason', 'original session unavailable',
    '--json',
  ], writerB)
  assert.equal(recovered.status, 0, recovered.stderr)
  const output = JSON.parse(recovered.stdout)
  assert.equal(output.schema_version, 2)
  assert.equal(output.task_schema_version, 4)
  assert.equal(output.primary_writer, writerB)
  assert.equal(output.writer_recovered, true)
  assert.equal(output.revision, 2)
  assert.match(output.warnings.at(-1), /previous writer may still modify/)

  const after = readTask(cwd, task.id)
  assert.equal(after.schema_version, 4)
  assert.equal(after.min_writer_version, '0.4.0')
  assert.equal(after.primary_writer, writerB)
  assert.equal(after.revision, 2)
  for (const field of [
    'plan',
    'phase',
    'plan_revision',
    'work_revision',
    'work_basis',
    'verification',
    'artifacts',
    'provenance',
  ])
    assert.deepEqual(after[field], before[field])

  const events = readTaskEventsV3(taskDirectory(cwd, task.id))
  assert.deepEqual(events.slice(-2), [
    {
      type: 'writer_taken_over',
      task_id: task.id,
      actor: writerB,
      revision: 2,
      created_at: events.at(-2).created_at,
      from: writerA,
      to: writerB,
      reason: 'original session unavailable',
    },
    {
      type: 'schema_upgraded',
      task_id: task.id,
      actor: writerB,
      revision: 2,
      created_at: events.at(-1).created_at,
      from_schema_version: 3,
      to_schema_version: 4,
      min_writer_version: '0.4.0',
    },
  ])

  const previousWriter = run(cwd, [
    'save',
    task.id,
    '--expect-revision', '2',
    '--block-reason', 'old writer should be excluded',
    '--waiting-for', 'new writer',
  ], writerA)
  assert.notEqual(previousWriter.status, 0)
  assert.match(previousWriter.stderr, /Writer mismatch/)

  const schema4Recovery = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision', '2',
    '--recover-writer',
    '--reason', 'schema 4 must use takeover',
  ], writerC)
  assert.notEqual(schema4Recovery.status, 0)
  assert.match(schema4Recovery.stderr, /requires an open schema_version 3 task/)
})

test('upgrade-v4 recovery keeps event append failure visible after task commit', () => {
  const cwd = temporaryDirectory()
  const task = createV3(cwd, writerA)
  const legacy = readTask(cwd, task.id)
  legacy.schema_version = 3
  delete legacy.min_writer_version
  writeTask(cwd, legacy)
  const eventsPath = join(taskDirectory(cwd, task.id), 'events.jsonl')
  const beforeEvents = readFileSync(eventsPath, 'utf8')
  chmodSync(eventsPath, 0o400)

  const recovered = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision', '1',
    '--recover-writer',
    '--reason', 'event warning fixture',
    '--json',
  ], writerB)
  chmodSync(eventsPath, 0o600)

  assert.notEqual(recovered.status, 0)
  assert.match(recovered.stderr, /requires its matching runner for schema_version 3/)
  assert.equal(readTask(cwd, task.id).revision, 1)
  assert.equal(readFileSync(eventsPath, 'utf8'), beforeEvents)
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
