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
  archiveTaskV2,
  createTaskV2,
  createTaskV3,
  initTaskStoreV2,
  readArchivedTaskV2,
  readStateV2,
} from '../dist/core/task-store.js'
import {
  readTaskEventLogV3,
  readTaskEventsV2,
} from '../dist/core/notes-events.js'

const cli = join(process.cwd(), 'dist/cli.js')
const actor = 'codex:session:migration'
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-migration-'))
  temporaryDirectories.push(directory)
  return directory
}

function run(cwd, args, selectedActor = actor) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LATCH_ACTOR: selectedActor },
  })
}

function plan() {
  return {
    goal: '验证 schema 迁移',
    scope: ['src/core/migration.ts'],
    acceptance: ['migration tests pass'],
    approach: ['使用单 task fixture'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['claim -> patch -> downgrade'],
    out_of_scope: ['batch migration'],
    verification_plan: [],
    open_questions: [],
  }
}

function taskDirectory(cwd, id) {
  return join(cwd, '.latch', 'tasks', id)
}

function taskPath(cwd, id) {
  return join(taskDirectory(cwd, id), 'task.json')
}

function eventsPath(cwd, id) {
  return join(taskDirectory(cwd, id), 'events.jsonl')
}

function readTask(cwd, id) {
  return JSON.parse(readFileSync(taskPath(cwd, id), 'utf8'))
}

function writeTask(cwd, task) {
  writeFileSync(taskPath(cwd, task.id), `${JSON.stringify(task, null, 2)}\n`)
}

function writeEvents(cwd, id, events) {
  writeFileSync(eventsPath(cwd, id), `${events.map(JSON.stringify).join('\n')}\n`)
}

function backupDirectories(cwd) {
  const root = join(cwd, '.latch', 'archive', 'v3-backup')
  return existsSync(root)
    ? readdirSync(root).map((name) => join(root, name))
    : []
}

function downgrade(cwd, task, extra = []) {
  return run(cwd, [
    'downgrade-v2',
    '--task', task.id,
    '--expect-revision', String(task.revision),
    '--confirm-data-loss',
    '--json',
    ...extra,
  ])
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('claim promotes a real v2 review task before legacy impact patch', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const legacy = createTaskV2(
    store,
    { title: 'legacy review', plan: plan() },
    actor,
  ).task
  legacy.phase = 'review'
  legacy.work_revision = 1
  legacy.implementation_approval = {
    approved_plan_revision: 1,
    approved_at: new Date().toISOString(),
    source: 'user',
    reason: 'legacy approval',
  }
  legacy.submission = {
    work_revision: 1,
    changes: 'legacy changes',
    verified: '',
    unverified: '',
    no_verify: { reason: 'legacy fixture' },
    submitted_at: new Date().toISOString(),
  }
  writeTask(cwd, legacy)

  const denied = run(cwd, [
    'patch-submission-knowledge-impact', legacy.id,
    '--expect-revision', '1',
    '--knowledge-impact-file', 'missing.json',
  ])
  assert.notEqual(denied.status, 0)

  const claimed = run(cwd, [
    'claim', legacy.id, '--expect-revision', '1', '--json',
  ])
  assert.equal(claimed.status, 0, claimed.stderr)
  const promoted = readTask(cwd, legacy.id)
  assert.equal(promoted.schema_version, 3)
  assert.equal(promoted.profile, 'standard')
  assert.equal(promoted.provenance, 'clean')
  assert.equal(promoted.primary_writer, actor)
  assert.equal(promoted.phase, 'review')
  assert.equal(promoted.submission.changes, 'legacy changes')

  writeFileSync(join(cwd, 'impact.json'), JSON.stringify({
    kind: 'none',
    reason: 'Legacy fixture does not change module contracts.',
  }))
  const patched = run(cwd, [
    'patch-submission-knowledge-impact', legacy.id,
    '--expect-revision', String(promoted.revision),
    '--knowledge-impact-file', 'impact.json', '--json',
  ])
  assert.equal(patched.status, 0, patched.stderr)
  const current = readTask(cwd, legacy.id)
  assert.equal(current.submission.plan_revision, current.plan_revision)
  assert.equal(current.submission.knowledge_impact.kind, 'none')
})

test('schema 3 event log enforces events_meta and warns on unknown events', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createTaskV3(
    store,
    { title: 'event compatibility', plan: plan(), profile: 'standard' },
    actor,
  ).task
  const original = JSON.parse(readFileSync(eventsPath(cwd, task.id), 'utf8'))
  const meta = {
    type: 'events_meta',
    events_schema_version: 3,
    actor,
    task_id: task.id,
    revision: 0,
    created_at: new Date().toISOString(),
  }
  writeEvents(cwd, task.id, [
    meta,
    original,
    {
      type: 'future_event',
      actor,
      task_id: task.id,
      revision: 2,
      created_at: new Date().toISOString(),
    },
  ])

  const log = readTaskEventLogV3(taskDirectory(cwd, task.id))
  assert.equal(log.meta.type, 'events_meta')
  assert.deepEqual(log.events.map((event) => event.type), ['task_created'])
  assert.match(log.warnings[0], /future_event/)
  assert.throws(
    () => readTaskEventsV2(taskDirectory(cwd, task.id)),
    /Invalid event type/,
  )
  const context = run(cwd, ['context', task.id, '--json'])
  assert.equal(context.status, 0, context.stderr)
  assert.match(JSON.parse(context.stdout).warnings[0], /future_event/)

  writeEvents(cwd, task.id, [original, meta])
  assert.throws(
    () => readTaskEventLogV3(taskDirectory(cwd, task.id)),
    /events_meta must be the unique first line/,
  )
})

test('downgrade-v2 backs up and projects open and archived tasks', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createTaskV3(
    store,
    {
      title: 'open downgrade',
      plan: plan(),
      profile: 'standard',
      groupId: 'Wave:R2',
      workBasis: {
        kind: 'implementation_authorization',
        source: 'user_approve',
        reason: 'approved migration fixture',
        scope: { summary: 'migration fixture' },
      },
    },
    actor,
  ).task
  const current = readTask(cwd, task.id)
  current.phase = 'review'
  current.revision = 5
  current.provenance = 'mixed'
  current.submission = {
    plan_revision: 1,
    work_revision: 1,
    changes: 'done',
    verified: '',
    unverified: '',
    knowledge_impact: {
      kind: 'none',
      reason: 'Fixture does not change module contracts.',
    },
    submitted_at: new Date().toISOString(),
  }
  writeTask(cwd, current)
  const dates = [1, 2, 3, 4, 5].map((second) =>
    `2026-07-16T00:00:0${second}.000Z`,
  )
  const originalEvents = [
    {
      type: 'events_meta', events_schema_version: 3, actor,
      task_id: task.id, revision: 0, created_at: dates[0],
    },
    {
      type: 'task_created', actor, task_id: task.id,
      revision: 1, created_at: dates[0],
    },
    {
      type: 'implementation_authorized', actor, task_id: task.id,
      revision: 2, created_at: dates[1], plan_revision: 1,
      source: 'user_approve', reason: 'approved', scope: { summary: 'fixture' },
    },
    {
      type: 'future_event', actor, task_id: task.id,
      revision: 3, created_at: dates[2],
    },
    {
      type: 'submitted', actor, task_id: task.id,
      revision: 4, created_at: dates[3],
    },
    {
      type: 'group_changed', actor, task_id: task.id,
      revision: 5, created_at: dates[4], from: 'Wave:Old', to: 'Wave:R2',
    },
  ]
  writeEvents(cwd, task.id, originalEvents)
  const taskBefore = readFileSync(taskPath(cwd, task.id), 'utf8')
  const eventsBefore = readFileSync(eventsPath(cwd, task.id), 'utf8')
  const stateBefore = readStateV2(store)

  const result = downgrade(cwd, current)
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.match(output.backup_path, /^\.latch\/archive\/v3-backup\//)
  assert.match(output.warnings[0], /future_event/)
  const downgraded = readTask(cwd, task.id)
  assert.equal(downgraded.schema_version, 2)
  assert.equal(downgraded.revision, 5)
  for (const field of ['primary_writer', 'profile', 'work_basis', 'group_id', 'provenance'])
    assert.equal(field in downgraded, false)
  assert.equal(downgraded.implementation_approval.source, 'user')
  assert.equal('plan_revision' in downgraded.submission, false)
  assert.equal('knowledge_impact' in downgraded.submission, false)
  assert.deepEqual(
    readTaskEventsV2(taskDirectory(cwd, task.id)).map((event) => [
      event.type,
      event.revision,
    ]),
    [['task_created', 1], ['submitted', 2]],
  )
  assert.deepEqual(readStateV2(store), stateBefore)
  const backup = join(cwd, output.backup_path)
  assert.equal(readFileSync(join(backup, 'task.json'), 'utf8'), taskBefore)
  assert.equal(readFileSync(join(backup, 'events.jsonl'), 'utf8'), eventsBefore)

  const archived = createTaskV3(
    store,
    { title: 'archived downgrade', plan: plan(), profile: 'standard' },
    actor,
  ).task
  const archivedResult = archiveTaskV2(store, archived.id, {
    expectRevision: 1,
    actor,
    outcome: 'done',
  }).task
  const archivedDowngrade = downgrade(cwd, archivedResult)
  assert.equal(archivedDowngrade.status, 0, archivedDowngrade.stderr)
  assert.equal(readArchivedTaskV2(store, archived.id).schema_version, 2)

  const retrospective = createTaskV3(
    store,
    {
      title: 'retrospective downgrade',
      plan: plan(),
      profile: 'standard',
      workBasis: {
        kind: 'retrospective_record',
        reason: 'implemented before task',
        implemented_before_task: true,
        scope_summary: 'retrospective fixture',
      },
    },
    actor,
  ).task
  const retrospectiveDowngrade = downgrade(cwd, retrospective)
  assert.equal(
    retrospectiveDowngrade.status,
    0,
    retrospectiveDowngrade.stderr,
  )
  assert.equal('implementation_approval' in readTask(cwd, retrospective.id), false)
})

test('downgrade failure keeps main data and completed backup', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createTaskV3(
    store,
    { title: 'failure backup', plan: plan(), profile: 'standard' },
    actor,
  ).task
  const before = {
    task: readFileSync(taskPath(cwd, task.id), 'utf8'),
    events: readFileSync(eventsPath(cwd, task.id), 'utf8'),
  }
  chmodSync(taskDirectory(cwd, task.id), 0o500)
  const failed = downgrade(cwd, task)
  chmodSync(taskDirectory(cwd, task.id), 0o700)

  assert.notEqual(failed.status, 0)
  assert.equal(readFileSync(taskPath(cwd, task.id), 'utf8'), before.task)
  assert.equal(readFileSync(eventsPath(cwd, task.id), 'utf8'), before.events)
  const backups = backupDirectories(cwd)
  assert.equal(backups.length, 1)
  assert.equal(readFileSync(join(backups[0], 'task.json'), 'utf8'), before.task)
  assert.equal(readFileSync(join(backups[0], 'events.jsonl'), 'utf8'), before.events)
  assert.equal(existsSync(join(cwd, '.latch')), true)
})

test('downgrade preconditions fail before backup or task changes', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createTaskV3(
    store,
    { title: 'preconditions', plan: plan(), profile: 'standard' },
    actor,
  ).task
  const before = readFileSync(taskPath(cwd, task.id), 'utf8')

  const missingConfirmation = run(cwd, [
    'downgrade-v2', '--task', task.id,
    '--expect-revision', '1', '--json',
  ])
  assert.notEqual(missingConfirmation.status, 0)
  assert.match(missingConfirmation.stderr, /confirm-data-loss/)

  const stale = run(cwd, [
    'downgrade-v2', '--task', task.id,
    '--expect-revision', '2', '--confirm-data-loss', '--json',
  ])
  assert.notEqual(stale.status, 0)
  assert.match(stale.stderr, /expected revision 2, current revision 1/)

  const legacy = createTaskV2(
    store,
    { title: 'already v2', plan: plan() },
    actor,
  ).task
  const alreadyV2 = downgrade(cwd, legacy)
  assert.notEqual(alreadyV2.status, 0)
  assert.match(alreadyV2.stderr, /requires a schema_version 3 task/)

  assert.equal(readFileSync(taskPath(cwd, task.id), 'utf8'), before)
  assert.deepEqual(backupDirectories(cwd), [])
})
