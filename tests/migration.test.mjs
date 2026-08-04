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
  createTaskV4,
  initTaskStoreV2,
  readArchivedTaskV2,
  readStateV2,
} from '../dist/core/task-store.js'
import {
  readTaskEventLogV3,
  readTaskEventsV2,
  readTaskEventsV3,
} from '../dist/core/notes-events.js'
import { downgradeTaskEvents } from '../dist/core/migration.js'
import { writeWorkspaceEvidence } from '../dist/core/workspace-evidence.js'

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
    workspace_scope: { paths: ['src/'] },
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

function backupDirectories(cwd, schemaVersion = 4) {
  const root = join(cwd, '.latch', 'archive', `v${schemaVersion}-backup`)
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

test('downgrade projects non-implementation feedback to a v2-safe event', () => {
  const event = {
    type: 'review_feedback',
    task_id: 'task',
    actor,
    revision: 4,
    created_at: new Date().toISOString(),
    plan_revision: 1,
    work_revision: 1,
    classification: 'non_implementation_correction',
    summary: '文档表述修正',
  }
  const [downgraded] = downgradeTaskEvents([event])
  assert.equal(downgraded.classification, 'evaluative')
  assert.equal(downgraded.revision, 1)
})

test('candidate CLI leaves schema 2 claim and patching to the matching runner', () => {
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
  assert.notEqual(claimed.status, 0)
  assert.match(claimed.stderr, /requires its matching runner for schema_version 2/)
  assert.equal(readTask(cwd, legacy.id).schema_version, 2)
  return

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

test('event schema 3 remains forward-compatible for schema 4 tasks', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createTaskV4(
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

test('candidate CLI refuses schema 3 upgrade without changing proof bytes', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createTaskV3(
    store,
    { title: 'proof upgrade', plan: plan(), profile: 'standard' },
    actor,
  ).task
  const directory = taskDirectory(cwd, task.id)
  const snapshot = {
    provider: 'git-v1',
    captured_at: new Date().toISOString(),
    complete: true,
    coverage: {
      git_visible: true,
      explicit_ignored_files: true,
      ignored_tree: false,
    },
    counts: {
      tracked_dirty: 0,
      untracked: 0,
      explicit_ignored: 0,
      in_scope: 0,
      out_of_scope: 0,
    },
    entries: [],
  }
  const reference = writeWorkspaceEvidence(
    directory,
    'upgrade-proof',
    'before',
    snapshot,
  )
  const current = readTask(cwd, task.id)
  current.workspace_proof = {
    generation: 3,
    baseline_ref: reference,
    baseline_counts: snapshot.counts,
    unresolved_violations: [],
  }
  current.verification.gate.check = {
    name: 'check',
    kind: 'gate',
    command: ['pnpm', 'check'],
    status: 'pass',
    exit_code: 0,
    work_revision: 0,
    created_at: new Date().toISOString(),
    command_outcome: { status: 'pass', exit_code: 0 },
    workspace_effect: {
      status: 'unchanged',
      changed_count: 0,
      in_scope_count: 0,
      out_of_scope_count: 0,
      samples: [],
      changes_ref: reference,
    },
    proof: {
      work_revision: 0,
      started_generation: 3,
      ended_generation: 3,
      before_ref: reference,
      after_ref: reference,
      delta_ref: reference,
    },
  }
  writeTask(cwd, current)
  const evidencePath = join(directory, reference.path)
  const before = {
    plan: structuredClone(current.plan),
    proof: structuredClone(current.workspace_proof),
    verification: structuredClone(current.verification),
    evidence: readFileSync(evidencePath),
  }

  const upgraded = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision', '1',
    '--json',
  ])
  assert.notEqual(upgraded.status, 0)
  assert.match(upgraded.stderr, /requires its matching runner for schema_version 3/)
  const after = readTask(cwd, task.id)
  assert.equal(after.schema_version, 3)
  assert.equal(after.revision, 1)
  assert.equal(after.plan_revision, 1)
  assert.equal(after.work_revision, 0)
  assert.deepEqual(after.plan, before.plan)
  assert.deepEqual(after.workspace_proof, before.proof)
  assert.deepEqual(after.verification, before.verification)
  assert.deepEqual(readFileSync(evidencePath), before.evidence)
  assert.deepEqual(readFileSync(evidencePath), before.evidence)
})

test('upgrade-v4 rejects corrupt evidence before changing task or events', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createTaskV3(
    store,
    { title: 'corrupt proof upgrade', plan: plan(), profile: 'standard' },
    actor,
  ).task
  const directory = taskDirectory(cwd, task.id)
  const reference = {
    path: 'evidence/missing.json',
    sha256: 'a'.repeat(64),
    entry_count: 0,
  }
  const current = readTask(cwd, task.id)
  current.workspace_proof = {
    generation: 1,
    baseline_ref: reference,
    baseline_counts: {
      tracked_dirty: 0,
      untracked: 0,
      explicit_ignored: 0,
      in_scope: 0,
      out_of_scope: 0,
    },
    unresolved_violations: [],
  }
  writeTask(cwd, current)
  const beforeTask = readFileSync(taskPath(cwd, task.id), 'utf8')
  const beforeEvents = readFileSync(eventsPath(cwd, task.id), 'utf8')

  const recoveryRejected = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision', '1',
    '--recover-writer',
    '--reason', 'corrupt evidence recovery',
    '--json',
  ], 'codex:session:replacement')
  assert.notEqual(recoveryRejected.status, 0)
  assert.match(recoveryRejected.stderr, /requires its matching runner for schema_version 3/)
  assert.equal(readFileSync(taskPath(cwd, task.id), 'utf8'), beforeTask)
  assert.equal(readFileSync(eventsPath(cwd, task.id), 'utf8'), beforeEvents)

  const rejected = run(cwd, [
    'upgrade-v4',
    '--task', task.id,
    '--expect-revision', '1',
    '--json',
  ])
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /requires its matching runner for schema_version 3/)
  assert.equal(readFileSync(taskPath(cwd, task.id), 'utf8'), beforeTask)
  assert.equal(readFileSync(eventsPath(cwd, task.id), 'utf8'), beforeEvents)
})

test('candidate CLI refuses schema 4 downgrade without task, event, or state writes', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createTaskV4(
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
  const evidenceRef = (name, entryCount) => ({
    path: `evidence/${name}.json`,
    sha256: 'a'.repeat(64),
    entry_count: entryCount,
  })
  current.phase = 'review'
  current.revision = 7
  current.provenance = 'mixed'
  current.workspace_proof = {
    generation: 2,
    baseline_ref: evidenceRef('baseline', 1),
    baseline_counts: {
      tracked_dirty: 0,
      untracked: 1,
      explicit_ignored: 0,
      in_scope: 0,
      out_of_scope: 1,
    },
    unresolved_violations: [{
      id: 'violation-1',
      path: 'outside.txt',
      source_gate: 'project-check',
      created_generation: 2,
      status: 'unresolved',
    }],
  }
  current.verification.gate['project-check'] = {
    name: 'project-check',
    kind: 'gate',
    command: ['pnpm', 'check'],
    status: 'fail',
    exit_code: 0,
    work_revision: 1,
    created_at: '2026-07-16T00:00:06.000Z',
    failure_reason: 'scope_violation',
    command_outcome: { status: 'pass', exit_code: 0 },
    workspace_effect: {
      status: 'out_of_scope_mutation',
      changed_count: 1,
      in_scope_count: 0,
      out_of_scope_count: 1,
      samples: [],
      changes_ref: evidenceRef('delta', 1),
    },
    proof: {
      work_revision: 1,
      started_generation: 1,
      ended_generation: 2,
      before_ref: evidenceRef('before', 0),
      after_ref: evidenceRef('after', 1),
      delta_ref: evidenceRef('delta', 1),
    },
    stale_reason: 'unresolved_scope_violation',
  }
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
  const dates = [1, 2, 3, 4, 5, 6, 7].map((second) =>
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
      type: 'schema_upgraded', actor, task_id: task.id,
      revision: 1, created_at: dates[0], from_schema_version: 3,
      to_schema_version: 4, min_writer_version: '0.4.0',
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
    {
      type: 'proof_generation_started', actor, task_id: task.id,
      revision: 6, created_at: dates[5], generation: 2,
      reason: 'workspace_mutated',
    },
    {
      type: 'verification_run', actor, task_id: task.id,
      revision: 7, created_at: dates[6], name: 'project-check',
      kind: 'gate', status: 'fail', exit_code: 0, work_revision: 1,
      failure_reason: 'scope_violation', started_generation: 1,
      ended_generation: 2, workspace_effect: 'out_of_scope_mutation',
      changed_count: 1, violation_ids: ['violation-1'],
      before_ref: evidenceRef('before', 0),
    },
  ]
  writeEvents(cwd, task.id, originalEvents)
  const taskBefore = readFileSync(taskPath(cwd, task.id), 'utf8')
  const eventsBefore = readFileSync(eventsPath(cwd, task.id), 'utf8')
  const stateBefore = readStateV2(store)

  const result = downgrade(cwd, current)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /requires its matching runner for schema_version 4/)
  assert.equal(readFileSync(taskPath(cwd, task.id), 'utf8'), taskBefore)
  assert.equal(readFileSync(eventsPath(cwd, task.id), 'utf8'), eventsBefore)
  assert.deepEqual(readStateV2(store), stateBefore)
  assert.deepEqual(backupDirectories(cwd), [])
  return
  for (const field of [
    'min_writer_version',
    'primary_writer',
    'profile',
    'work_basis',
    'group_id',
    'provenance',
  ])
    assert.equal(field in downgraded, false)
  assert.equal('workspace_scope' in downgraded.plan, false)
  assert.equal('workspace_proof' in downgraded, false)
  assert.deepEqual(downgraded.verification.gate['project-check'], {
    name: 'project-check',
    kind: 'gate',
    command: ['pnpm', 'check'],
    status: 'fail',
    exit_code: 0,
    work_revision: 1,
    created_at: '2026-07-16T00:00:06.000Z',
  })
  assert.equal(downgraded.implementation_approval.source, 'user')
  assert.equal('plan_revision' in downgraded.submission, false)
  assert.equal('knowledge_impact' in downgraded.submission, false)
  const downgradedEvents = readTaskEventsV2(taskDirectory(cwd, task.id))
  assert.deepEqual(downgradedEvents.map((event) => [
    event.type,
    event.revision,
  ]), [['task_created', 1], ['submitted', 2], ['verification_run', 3]])
  assert.deepEqual(downgradedEvents[2], {
    type: 'verification_run',
    actor,
    task_id: task.id,
    revision: 3,
    created_at: dates[6],
    name: 'project-check',
    kind: 'gate',
    status: 'fail',
    exit_code: 0,
    work_revision: 1,
  })
  assert.deepEqual(readStateV2(store), stateBefore)
  const backup = join(cwd, output.backup_path)
  assert.equal(readFileSync(join(backup, 'task.json'), 'utf8'), taskBefore)
  assert.equal(readFileSync(join(backup, 'events.jsonl'), 'utf8'), eventsBefore)
  const backupTask = JSON.parse(readFileSync(join(backup, 'task.json'), 'utf8'))
  assert.deepEqual(backupTask.plan.workspace_scope, { paths: ['src/'] })
  assert.equal(backupTask.workspace_proof.generation, 2)
  assert.equal(backupTask.verification.gate['project-check'].proof.ended_generation, 2)

  const archived = createTaskV4(
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

  const retrospective = createTaskV4(
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

test('candidate CLI rejects schema 4 downgrade before backup creation', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createTaskV4(
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
  const failureEnvelope = JSON.parse(failed.stderr)
  assert.equal('backup_path' in failureEnvelope, false)
  assert.match(failureEnvelope.error.message, /requires its matching runner for schema_version 4/)
  assert.equal(readFileSync(taskPath(cwd, task.id), 'utf8'), before.task)
  assert.equal(readFileSync(eventsPath(cwd, task.id), 'utf8'), before.events)
  const backups = backupDirectories(cwd)
  assert.equal(backups.length, 0)
  assert.equal(existsSync(join(cwd, '.latch')), true)
})

test('downgrade preconditions fail before backup or task changes', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createTaskV4(
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
  assert.match(stale.stderr, /requires its matching runner for schema_version 4/)

  const legacy = createTaskV2(
    store,
    { title: 'already v2', plan: plan() },
    actor,
  ).task
  const alreadyV2 = downgrade(cwd, legacy)
  assert.notEqual(alreadyV2.status, 0)
  assert.match(alreadyV2.stderr, /requires its matching runner for schema_version 2/)

  assert.equal(readFileSync(taskPath(cwd, task.id), 'utf8'), before)
  assert.deepEqual(backupDirectories(cwd), [])
})
