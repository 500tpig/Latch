import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  archiveTaskV2,
  downgradeTaskV2,
  openTaskStoreV2,
} from '../dist/core/task-store.js'
import {
  checkpoint,
  cleanupTemporaryDirectories,
  init,
  readTask,
  run,
  taskPath,
  temporaryDirectory,
  writePlan,
} from './cli-test-support.mjs'

test.afterEach(cleanupTemporaryDirectories)

test('use resolves a unique prefix, stores canonical ID, and does not append task event', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const directory = join(cwd, '.latch', 'tasks', created.task_id)
  const eventsBefore = readFileSync(join(directory, 'events.jsonl'), 'utf8')

  const result = run(cwd, ['use', created.task_id.slice(0, 20), '--json'], {
    actor: 'codex:session:another-session',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).task_id, created.task_id)
  const state = JSON.parse(readFileSync(join(cwd, '.latch', 'state.json'), 'utf8'))
  assert.equal(
    state.actors['codex:session:another-session'].current_task_id,
    created.task_id,
  )
  assert.equal(readFileSync(join(directory, 'events.jsonl'), 'utf8'), eventsBefore)
})
test('list and context expose stable full and brief JSON', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)

  const fullList = JSON.parse(run(cwd, ['list', '--json']).stdout)
  assert.equal(fullList.schema_version, 2)
  assert.equal(fullList.current_task_id, created.task_id)
  assert.equal(fullList.tasks[0].plan_revision, 1)
  assert.equal(fullList.tasks[0].work_revision, 0)
  assert.equal(fullList.tasks[0].provenance, 'clean')

  const briefList = JSON.parse(run(cwd, ['list', '--json', '--brief']).stdout)
  assert.equal(briefList.tasks[0].revision, 1)
  assert.equal(briefList.tasks[0].provenance, 'clean')
  assert.equal('plan_revision' in briefList.tasks[0], false)

  const fullContext = JSON.parse(run(cwd, ['context', '--json']).stdout)
  assert.equal(fullContext.current, true)
  assert.equal('archived' in fullContext, false)
  assert.equal(fullContext.task.id, created.task_id)
  assert.equal(fullContext.task.provenance, 'clean')
  assert.equal(fullContext.task.plan.approach[0], '使用 node:util.parseArgs')
  assert.equal(fullContext.history_incomplete, false)
  assert.deepEqual(fullContext.recent_events.map((event) => event.type), [
    'task_created',
  ])
  assert.deepEqual(fullContext.timeline.map((event) => event.title), [
    '创建任务',
  ])
  assert.equal(fullContext.timeline[0].summary, `创建「${readTask(cwd, created.task_id).title}」。`)

  const briefContext = JSON.parse(
    run(cwd, ['context', created.task_id, '--json', '--brief']).stdout,
  )
  assert.equal(briefContext.task.goal, '实现 v2 CLI')
  assert.equal(briefContext.task.provenance, 'clean')
  assert.equal('plan' in briefContext.task, false)
  assert.deepEqual(briefContext.task.verification_plan, [
    {
      name: 'tests',
      command: ['pnpm', 'test'],
      kind: 'gate',
      status: 'pending',
    },
  ])
  assert.equal(briefContext.recent_events.length, 1)
  assert.equal(briefContext.timeline.length, 1)
  assert.equal(briefContext.timeline[0].details.event_type, 'task_created')

  const statusContext = JSON.parse(
    run(cwd, ['context', created.task_id, '--json', '--status']).stdout,
  )
  assert.equal(statusContext.view, 'status')
  assert.equal(statusContext.task.writer.status, 'primary_writer')
  assert.equal(statusContext.task.authorization.status, 'missing')
  assert.equal(statusContext.task.next_action, 'approve')
  assert.equal('goal' in statusContext.task, false)
  assert.ok(JSON.stringify(statusContext).length < JSON.stringify(briefContext).length)

  const saved = run(cwd, [
    'save', created.task_id, '--expect-revision', '1',
    '--decision', '记录增量', '--json',
  ])
  assert.equal(saved.status, 0, saved.stderr)
  const delta = JSON.parse(
    run(cwd, [
      'context', created.task_id, '--json', '--since-revision', '1',
    ]).stdout,
  )
  assert.equal(delta.view, 'delta')
  assert.equal(delta.from_revision, 1)
  assert.equal(delta.to_revision, 2)
  assert.equal(delta.requires_baseline, true)
  assert.deepEqual(delta.events.map((event) => event.type), ['decision_recorded'])
  assert.deepEqual(delta.timeline.map((event) => event.title), ['记录决定'])
  assert.equal(delta.timeline[0].summary, '记录增量')
})

test('context 按精确 ID 只读归档 task 并保持 mutation 为 open-only', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, '归档 Context')
  const store = openTaskStoreV2(cwd)
  const archived = archiveTaskV2(store, created.task_id, {
    expectRevision: 1,
    actor: 'codex:session:test-session',
    outcome: 'done',
    eventFields: {
      resolved_count: 0,
      accepted_risk_count: 0,
      followup_count: 0,
    },
    update(task) {
      task.submission = {
        plan_revision: task.plan_revision,
        work_revision: task.work_revision,
        changes: 'Context archive fixture',
        verified: '',
        unverified_items: [],
        knowledge_impact: {
          kind: 'none',
          reason: 'Context archive fixture does not change module contracts.',
        },
        submitted_at: '2026-07-31T00:00:00.000Z',
      }
      task.closure = {
        changes: task.submission.changes,
        verified: task.submission.verified,
        unverified_items: [],
        resolutions: [],
        accepted_at: '2026-07-31T00:00:00.000Z',
      }
    },
  }).task
  const archivedDirectory = join(
    cwd,
    '.latch',
    'archive',
    archived.updated_at.slice(0, 7),
    archived.id,
  )
  const taskJsonPath = join(archivedDirectory, 'task.json')
  const eventsPath = join(archivedDirectory, 'events.jsonl')

  const statusResult = run(cwd, [
    'context',
    archived.id,
    '--json',
    '--status',
  ])
  assert.equal(statusResult.status, 0, statusResult.stderr)
  const status = JSON.parse(statusResult.stdout)
  assert.equal(status.archived, true)
  assert.equal(status.outcome, 'done')
  assert.equal(status.last_open_phase, 'plan')
  assert.equal(status.current, false)
  assert.equal(status.task.next_action, 'read_only')

  const brief = JSON.parse(run(cwd, [
    'context',
    archived.id,
    '--json',
    '--brief',
    '--history',
    'timeline',
  ]).stdout)
  assert.equal(brief.archived, true)
  assert.equal(brief.history_view, 'timeline')
  assert.equal(brief.timeline.at(-1).event_type, 'done')
  assert.equal('recent_events' in brief, false)

  const delta = JSON.parse(run(cwd, [
    'context',
    archived.id,
    '--json',
    '--since-revision',
    '1',
    '--history',
    'events',
  ]).stdout)
  assert.equal(delta.archived, true)
  assert.deepEqual(delta.events.map((event) => event.type), ['done'])

  const human = run(cwd, ['context', archived.id])
  assert.equal(human.status, 0, human.stderr)
  assert.match(human.stdout, /Archived: yes/)
  assert.match(human.stdout, /Outcome: done/)
  assert.match(human.stdout, /Last open phase: plan/)

  const taskBefore = readFileSync(taskJsonPath, 'utf8')
  const eventsBefore = readFileSync(eventsPath, 'utf8')
  const mutation = run(cwd, [
    'save',
    archived.id,
    '--expect-revision',
    String(archived.revision),
    '--decision',
    '不应写入 archive',
    '--json',
  ])
  assert.notEqual(mutation.status, 0)
  assert.match(mutation.stderr, /Task not found/)
  assert.equal(readFileSync(taskJsonPath, 'utf8'), taskBefore)
  assert.equal(readFileSync(eventsPath, 'utf8'), eventsBefore)

  const prefix = run(cwd, [
    'context',
    archived.id.slice(0, -1),
    '--json',
    '--status',
  ])
  assert.notEqual(prefix.status, 0)
  assert.match(prefix.stderr, /Task not found/)

  const missing = run(cwd, [
    'context',
    '20260730000000000-missing-000000',
    '--json',
    '--status',
  ])
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /Task not found/)
})


test('context 按精确 ID 兼容读取 schema 2 archive', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, 'schema 2 archive', {
    verification_plan: [],
  })
  const store = openTaskStoreV2(cwd)
  const schema4 = readTask(cwd, created.task_id)
  schema4.schema_version = 4
  schema4.min_writer_version = '0.4.0'
  writeFileSync(taskPath(cwd, created.task_id), `${JSON.stringify(schema4, null, 2)}\n`)
  const archived = archiveTaskV2(store, created.task_id, {
    expectRevision: 1,
    actor: 'codex:session:test-session',
    outcome: 'abandoned',
  }).task
  downgradeTaskV2(store, archived.id, {
    expectRevision: archived.revision,
    actor: 'codex:session:test-session',
  })

  const result = run(cwd, ['context', archived.id, '--json'])
  assert.equal(result.status, 0, result.stderr)
  const context = JSON.parse(result.stdout)
  assert.equal(context.archived, true)
  assert.equal(context.outcome, 'abandoned')
  assert.equal(context.last_open_phase, 'plan')
  assert.equal(context.historical_schema, true)
  assert.equal(context.task.schema_version, 2)
  assert.equal(context.recent_events.at(-1).type, 'abandoned')
  assert.equal(context.history_incomplete, false)
  const human = run(cwd, ['context', archived.id])
  assert.equal(human.status, 0, human.stderr)
  assert.match(human.stdout, /Historical schema: yes/)
})

test('context history selector keeps defaults compatible and projects raw or readable history', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const detail = '调试详情'.repeat(120)
  const saved = run(cwd, [
    'save', created.task_id, '--expect-revision', '1',
    '--decision', '记录可读历史选择器',
    '--question', detail,
    '--answer', detail,
    '--json',
  ])
  assert.equal(saved.status, 0, saved.stderr)

  function assertDefaultMatchesBoth(args) {
    const standard = JSON.parse(run(cwd, [
      'context', created.task_id, '--json', ...args,
    ]).stdout)
    const explicitBoth = JSON.parse(run(cwd, [
      'context', created.task_id, '--json', ...args, '--history', 'both',
    ]).stdout)
    const { generated_at: standardGeneratedAt, ...standardBody } = standard
    const {
      generated_at: explicitGeneratedAt,
      history_view: historyView,
      ...explicitBody
    } = explicitBoth
    assert.ok(standardGeneratedAt)
    assert.ok(explicitGeneratedAt)
    assert.equal(historyView, 'both')
    assert.deepEqual(explicitBody, standardBody)
    return standard
  }

  assertDefaultMatchesBoth([])
  const defaultBrief = assertDefaultMatchesBoth(['--brief'])
  assertDefaultMatchesBoth(['--since-revision', '1'])

  const timeline = JSON.parse(
    run(cwd, [
      'context', created.task_id, '--json', '--brief', '--history', 'timeline',
    ]).stdout,
  )
  assert.equal(timeline.history_view, 'timeline')
  assert.equal('recent_events' in timeline, false)
  assert.equal(timeline.timeline.length, 2)
  assert.equal('details' in timeline.timeline[0], false)
  assert.ok(JSON.stringify(timeline).length < JSON.stringify(defaultBrief).length * 0.8)

  const events = JSON.parse(
    run(cwd, [
      'context', created.task_id, '--json', '--brief', '--history', 'events',
    ]).stdout,
  )
  assert.equal(events.history_view, 'events')
  assert.equal('timeline' in events, false)
  assert.deepEqual(events.recent_events, defaultBrief.recent_events)

  const fullTimeline = JSON.parse(
    run(cwd, [
      'context', created.task_id, '--json', '--history', 'timeline',
    ]).stdout,
  )
  assert.equal('recent_events' in fullTimeline, false)
  assert.equal(fullTimeline.history_view, 'timeline')

  const deltaTimeline = JSON.parse(
    run(cwd, [
      'context', created.task_id, '--json', '--since-revision', '1',
      '--history', 'timeline',
    ]).stdout,
  )
  assert.equal(deltaTimeline.view, 'delta')
  assert.equal(deltaTimeline.requires_baseline, true)
  assert.equal('events' in deltaTimeline, false)
  assert.equal('details' in deltaTimeline.timeline[0], false)

  const deltaEvents = JSON.parse(
    run(cwd, [
      'context', created.task_id, '--json', '--since-revision', '1',
      '--history', 'events',
    ]).stdout,
  )
  assert.equal('timeline' in deltaEvents, false)
  assert.deepEqual(deltaEvents.events.map((event) => event.type), ['decision_recorded'])

  const statusHistory = run(cwd, [
    'context', created.task_id, '--json', '--status', '--history', 'timeline',
  ])
  assert.notEqual(statusHistory.status, 0)
  assert.match(statusHistory.stderr, /--history cannot be combined with --status/)

  const humanHistory = run(cwd, [
    'context', created.task_id, '--history', 'timeline',
  ])
  assert.notEqual(humanHistory.status, 0)
  assert.match(humanHistory.stderr, /--history require --json/)

  const invalidHistory = run(cwd, [
    'context', created.task_id, '--json', '--history', 'raw',
  ])
  assert.notEqual(invalidHistory.status, 0)
  assert.match(invalidHistory.stderr, /--history must be timeline, events, or both/)
})

test('context timelines distinguish blocking gate failures from diagnostic results', () => {
  const cwd = temporaryDirectory()
  spawnSync('git', ['init'], { cwd, encoding: 'utf8' })
  writeFileSync(join(cwd, 'tracked.txt'), 'baseline\n')
  spawnSync('git', ['add', 'tracked.txt'], { cwd, encoding: 'utf8' })
  init(cwd)

  function approve(id) {
    const result = run(cwd, [
      'approve',
      id,
      '--expect-revision',
      String(readTask(cwd, id).revision),
      '--reason',
      '用户批准',
      '--json',
    ])
    assert.equal(result.status, 0, result.stderr)
  }

  function diagnostic(id, name, exitCode) {
    return run(cwd, [
      'verify',
      id,
      '--expect-revision',
      String(readTask(cwd, id).revision),
      '--name',
      name,
      '--diagnostic',
      '--json',
      '--',
      process.execPath,
      '-e',
      `process.exit(${exitCode})`,
    ])
  }

  function timelineItem(context, name) {
    return context.timeline.find((event) => event.summary.startsWith(`${name} `))
  }

  function readableFields(event) {
    return {
      event_type: event.event_type,
      title: event.title,
      summary: event.summary,
      impact: event.impact,
      ...(event.next_action ? { next_action: event.next_action } : {}),
    }
  }

  const diagnosticCreated = checkpoint(cwd, 'Diagnostic timeline', {
    workspace_scope: { paths: ['tracked.txt'] },
    scope: ['记录 diagnostic 结果'],
    verification_plan: [],
  })
  approve(diagnosticCreated.task_id)
  const diagnosticPass = diagnostic(
    diagnosticCreated.task_id,
    'diagnostic-pass',
    0,
  )
  assert.equal(diagnosticPass.status, 0, diagnosticPass.stderr)
  const diagnosticFail = diagnostic(
    diagnosticCreated.task_id,
    'diagnostic-fail',
    3,
  )
  assert.notEqual(diagnosticFail.status, 0)
  const diagnosticStatus = JSON.parse(run(cwd, [
    'context', diagnosticCreated.task_id, '--json', '--status',
  ]).stdout)
  assert.equal(diagnosticStatus.task.next_action, 'submit')

  const defaultDiagnostic = JSON.parse(run(cwd, [
    'context', diagnosticCreated.task_id, '--json',
  ]).stdout)
  const diagnosticPassEvent = timelineItem(defaultDiagnostic, 'diagnostic-pass')
  assert.equal(diagnosticPassEvent.title, '记录 diagnostic 结果')
  assert.equal(
    diagnosticPassEvent.impact,
    '这项 diagnostic 结果仅作记录，不构成验收 gate 证明。',
  )
  assert.equal('next_action' in diagnosticPassEvent, false)
  assert.equal(diagnosticPassEvent.details.kind, 'diagnostic')
  const diagnosticFailEvent = timelineItem(defaultDiagnostic, 'diagnostic-fail')
  assert.equal(diagnosticFailEvent.title, '记录 diagnostic 结果')
  assert.equal(
    diagnosticFailEvent.impact,
    '这项 diagnostic 未通过，但结果仅作记录，不构成验收 gate 证明，也不阻塞提交。',
  )
  assert.equal('next_action' in diagnosticFailEvent, false)
  assert.equal(diagnosticFailEvent.details.kind, 'diagnostic')

  const diagnosticHistory = JSON.parse(run(cwd, [
    'context', diagnosticCreated.task_id, '--json', '--history', 'timeline',
  ]).stdout)
  assert.deepEqual(
    readableFields(timelineItem(diagnosticHistory, 'diagnostic-pass')),
    readableFields(diagnosticPassEvent),
  )
  assert.deepEqual(
    readableFields(timelineItem(diagnosticHistory, 'diagnostic-fail')),
    readableFields(diagnosticFailEvent),
  )
  assert.equal(
    'details' in timelineItem(diagnosticHistory, 'diagnostic-fail'),
    false,
  )

  const gateCreated = checkpoint(cwd, 'Gate failure timeline', {
    workspace_scope: { paths: ['tracked.txt'] },
    scope: ['验证 gate failure 文案'],
    verification_plan: [
      {
        name: 'gate-fail',
        command: [process.execPath, '-e', 'process.exit(2)'],
        kind: 'gate',
      },
    ],
  })
  approve(gateCreated.task_id)
  const gateFailure = run(cwd, [
    'verify',
    gateCreated.task_id,
    '--expect-revision',
    String(readTask(cwd, gateCreated.task_id).revision),
    '--name',
    'gate-fail',
    '--json',
  ])
  assert.notEqual(gateFailure.status, 0)

  const defaultGate = JSON.parse(run(cwd, [
    'context', gateCreated.task_id, '--json',
  ]).stdout)
  const gateFailureEvent = timelineItem(defaultGate, 'gate-fail')
  assert.equal(gateFailureEvent.title, '检查未通过')
  assert.equal(gateFailureEvent.impact, '需要先处理失败原因，再继续提交验收。')
  assert.equal(gateFailureEvent.next_action, '查看失败输出并修正。')
  assert.equal(gateFailureEvent.details.kind, 'gate')

  const gateHistory = JSON.parse(run(cwd, [
    'context', gateCreated.task_id, '--json', '--history', 'timeline',
  ]).stdout)
  assert.deepEqual(
    readableFields(timelineItem(gateHistory, 'gate-fail')),
    readableFields(gateFailureEvent),
  )
  assert.equal('details' in timelineItem(gateHistory, 'gate-fail'), false)
})

test('status keeps task writer state and caller capability independent', () => {
  function statusFor(mutator, actor = 'codex:session:test-session') {
    const cwd = temporaryDirectory()
    init(cwd)
    const created = checkpoint(cwd)
    const task = readTask(cwd, created.task_id)
    mutator(task)
    writeFileSync(taskPath(cwd, task.id), `${JSON.stringify(task, null, 2)}\n`)
    const result = run(cwd, ['context', task.id, '--json', '--status'], { actor })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout).task
  }

  const readOnlyLegacy = statusFor((task) => {
    delete task.primary_writer
    task.schema_version = 2
    delete task.min_writer_version
    delete task.profile
    delete task.provenance
    task.blocked = { reason: '等待', waiting_for: '用户', blocked_at: task.updated_at }
  }, '')
  assert.equal(readOnlyLegacy.writer.task_status, 'legacy_unclaimed')
  assert.equal(readOnlyLegacy.writer.caller_capability, 'read_only')
  assert.equal(readOnlyLegacy.writer.status, 'read_only_actor')
  assert.equal(readOnlyLegacy.next_action, 'read_only')

  const writableLegacy = statusFor((task) => {
    delete task.primary_writer
    task.schema_version = 2
    delete task.min_writer_version
    delete task.profile
    delete task.provenance
    task.blocked = { reason: '等待', waiting_for: '用户', blocked_at: task.updated_at }
  })
  assert.equal(writableLegacy.writer.task_status, 'legacy_unclaimed')
  assert.equal(writableLegacy.writer.caller_capability, 'writable')
  assert.equal(writableLegacy.next_action, 'claim')

  const upgradeRequired = statusFor((task) => {
    task.schema_version = 3
    delete task.min_writer_version
  })
  assert.equal(upgradeRequired.task_schema_version, 3)
  assert.equal(upgradeRequired.upgrade_required, true)
  assert.equal(upgradeRequired.writer.task_status, 'schema_upgrade_required')
  assert.equal(upgradeRequired.next_action, 'upgrade_v4')

  const mismatch = statusFor((task) => {
    task.blocked = { reason: '等待', waiting_for: '用户', blocked_at: task.updated_at }
  }, 'codex:session:other')
  assert.equal(mismatch.writer.status, 'writer_mismatch')
  assert.equal(mismatch.next_action, 'takeover')

  const blockedPrimary = statusFor((task) => {
    task.blocked = { reason: '等待', waiting_for: '用户', blocked_at: task.updated_at }
  })
  assert.equal(blockedPrimary.writer.status, 'primary_writer')
  assert.equal(blockedPrimary.next_action, 'unblock')
})

test('status derives phase, gate, and authorization actions after writer checks', () => {
  function statusFor(mutator) {
    const cwd = temporaryDirectory()
    init(cwd)
    const created = checkpoint(cwd)
    const task = readTask(cwd, created.task_id)
    mutator(task)
    writeFileSync(taskPath(cwd, task.id), `${JSON.stringify(task, null, 2)}\n`)
    const result = run(cwd, ['context', task.id, '--json', '--status'])
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout).task
  }

  assert.equal(statusFor((task) => {
    task.plan.open_questions = ['需要确认']
  }).next_action, 'resolve_open_questions')
  assert.equal(statusFor(() => {}).next_action, 'approve')

  const pending = statusFor((task) => {
    task.phase = 'dev'
    task.implementation_approval = {
      approved_plan_revision: task.plan_revision,
      approved_at: task.updated_at,
      source: 'user',
      reason: '已批准',
    }
  })
  assert.equal(pending.authorization.status, 'valid')
  assert.equal(pending.next_action, 'verify')

  const stale = statusFor((task) => {
    task.phase = 'check'
    task.plan_revision = 2
    task.implementation_approval = {
      approved_plan_revision: 1,
      approved_at: task.updated_at,
      source: 'user',
      reason: '旧批准',
    }
  })
  assert.equal(stale.authorization.status, 'stale')
  assert.equal(stale.next_action, 'verify')

  const ready = statusFor((task) => {
    task.phase = 'check'
    task.verification.gate.tests = {
      name: 'tests',
      kind: 'gate',
      command: ['pnpm', 'test'],
      status: 'pass',
      exit_code: 0,
      work_revision: task.work_revision,
      created_at: task.updated_at,
    }
  })
  assert.equal(ready.authorization.status, 'missing')
  assert.equal(ready.next_action, 'submit')

  assert.equal(statusFor((task) => {
    task.phase = 'review'
  }).next_action, 'review_or_archive')
})

test('context reports artifact Git delivery without treating ignored files as local knowledge', () => {
  const cwd = temporaryDirectory()
  spawnSync('git', ['init'], { cwd, encoding: 'utf8' })
  writeFileSync(join(cwd, '.gitignore'), 'ignored.md\n')
  writeFileSync(join(cwd, 'tracked.md'), 'tracked\n')
  writeFileSync(join(cwd, 'untracked.md'), 'untracked\n')
  writeFileSync(join(cwd, 'ignored.md'), 'ignored\n')
  spawnSync('git', ['add', '.gitignore', 'tracked.md'], { cwd, encoding: 'utf8' })
  init(cwd)
  const planFile = writePlan(cwd)
  const created = run(cwd, [
    'checkpoint', 'Artifact delivery', '--plan-file', planFile,
    '--artifact', 'doc:tracked.md',
    '--artifact', 'doc:untracked.md',
    '--artifact', 'doc:ignored.md',
    '--artifact', 'doc:missing.md',
    '--json',
  ])
  assert.equal(created.status, 0, created.stderr)
  const id = JSON.parse(created.stdout).task_id
  const context = JSON.parse(
    run(cwd, ['context', id, '--json', '--status']).stdout,
  )
  assert.deepEqual(
    Object.fromEntries(
      context.artifact_delivery.map((artifact) => [artifact.path, artifact.git_status]),
    ),
    {
      'tracked.md': 'tracked',
      'untracked.md': 'untracked',
      'ignored.md': 'ignored',
      'missing.md': 'missing',
    },
  )
  assert.match(context.warnings.join('\n'), /ignored\.md is ignored/)
  assert.doesNotMatch(context.warnings.join('\n'), /local knowledge/)
})

test('brief context summarizes planned verification states', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, 'Verification summary', {
    verification_plan: [
      { name: 'passed', command: ['pnpm', 'test'], kind: 'gate' },
      { name: 'failed', command: ['pnpm', 'typecheck'], kind: 'gate' },
      { name: 'stale', command: ['pnpm', 'check'], kind: 'gate' },
      { name: 'pending', command: ['pnpm', 'build'], kind: 'diagnostic' },
    ],
  })
  const task = readTask(cwd, created.task_id)
  const createdAt = new Date().toISOString()
  task.work_revision = 2
  task.verification.gate.passed = {
    name: 'passed',
    kind: 'gate',
    command: ['pnpm', 'test'],
    status: 'pass',
    exit_code: 0,
    work_revision: 2,
    created_at: createdAt,
  }
  task.verification.gate.failed = {
    name: 'failed',
    kind: 'gate',
    command: ['pnpm', 'typecheck'],
    status: 'fail',
    exit_code: 1,
    work_revision: 2,
    created_at: createdAt,
    failure_reason: 'command_failed',
    command_outcome: {
      status: 'fail',
      exit_code: 1,
      error: 'typecheck failed',
    },
    workspace_effect: {
      status: 'unchanged',
      changed_count: 0,
      in_scope_count: 0,
      out_of_scope_count: 0,
      samples: [],
    },
  }
  task.verification.gate.stale = {
    name: 'stale',
    kind: 'gate',
    command: ['pnpm', 'check'],
    status: 'pass',
    exit_code: 0,
    work_revision: 1,
    created_at: createdAt,
  }
  task.verification.diagnostic.exploratory = {
    name: 'exploratory',
    kind: 'diagnostic',
    command: ['node', '-e', 'process.exit(3)'],
    status: 'fail',
    exit_code: 3,
    work_revision: 2,
    created_at: createdAt,
    failure_reason: 'evidence_error',
    command_outcome: {
      status: 'fail',
      exit_code: 3,
      error: 'diagnostic failed',
    },
    proof: {
      work_revision: 2,
      started_generation: 1,
      ended_generation: 1,
      before_ref: {
        path: 'evidence/before.json',
        sha256: 'a'.repeat(64),
        entry_count: 1,
      },
      after_ref: {
        path: 'evidence/after.json',
        sha256: 'b'.repeat(64),
        entry_count: 1,
      },
      delta_ref: {
        path: 'evidence/delta.json',
        sha256: 'c'.repeat(64),
        entry_count: 1,
      },
    },
  }
  writeFileSync(taskPath(cwd, created.task_id), `${JSON.stringify(task, null, 2)}\n`)

  const briefContext = JSON.parse(
    run(cwd, ['context', created.task_id, '--json', '--brief']).stdout,
  )
  assert.equal(briefContext.schema_version, 2)
  assert.equal(briefContext.view, 'brief')
  assert.deepEqual(briefContext.task.verification_plan, [
    {
      name: 'passed',
      command: ['pnpm', 'test'],
      kind: 'gate',
      status: 'pass',
    },
    {
      name: 'failed',
      command: ['pnpm', 'typecheck'],
      kind: 'gate',
      status: 'fail',
    },
    {
      name: 'stale',
      command: ['pnpm', 'check'],
      kind: 'gate',
      status: 'stale',
      stale_reason: 'work_revision_changed',
    },
    {
      name: 'pending',
      command: ['pnpm', 'build'],
      kind: 'diagnostic',
      status: 'pending',
    },
  ])
  assert.deepEqual(briefContext.task.verification, {
    gate: {
      passed: {
        name: 'passed',
        kind: 'gate',
        status: 'pass',
        work_revision: 2,
        exit_code: 0,
      },
      failed: {
        name: 'failed',
        kind: 'gate',
        status: 'fail',
        work_revision: 2,
        exit_code: 1,
        failure_reason: 'command_failed',
      },
      stale: {
        name: 'stale',
        kind: 'gate',
        status: 'pass',
        work_revision: 1,
        exit_code: 0,
      },
    },
    diagnostic: {
      exploratory: {
        name: 'exploratory',
        kind: 'diagnostic',
        status: 'fail',
        work_revision: 2,
        exit_code: 3,
        failure_reason: 'evidence_error',
      },
    },
  })
  assert.doesNotMatch(
    JSON.stringify(briefContext.task.verification),
    /"(?:command|created_at|workspace_effect|proof|before_ref|after_ref|delta_ref)":/,
  )

  const fullContext = JSON.parse(
    run(cwd, ['context', created.task_id, '--json']).stdout,
  )
  assert.deepEqual(fullContext.task.verification, task.verification)

  const reviewContext = JSON.parse(
    run(cwd, ['context', created.task_id, '--json', '--review']).stdout,
  )
  assert.equal('verification' in reviewContext.task, false)
})
