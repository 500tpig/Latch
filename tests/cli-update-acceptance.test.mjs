import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  checkpoint,
  cleanupTemporaryDirectories,
  init,
  readTask,
  run,
  taskPath,
  temporaryDirectory,
} from './cli-test-support.mjs'

const owner = 'codex:session:test-session'
const otherWriter = 'codex:session:update-acceptance-other'

test.afterEach(cleanupTemporaryDirectories)

function taskDirectory(cwd, id) {
  return join(cwd, '.latch', 'tasks', id)
}

function writeTask(cwd, id, task) {
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(task, null, 2)}\n`)
}

function writeJson(cwd, name, value) {
  writeFileSync(join(cwd, name), `${JSON.stringify(value, null, 2)}\n`)
  return name
}

function revision(cwd, id) {
  return String(readTask(cwd, id).revision)
}

function events(cwd, id) {
  return readFileSync(join(taskDirectory(cwd, id), 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function storedState(cwd, id) {
  const directory = taskDirectory(cwd, id)
  const evidenceDirectory = join(directory, 'evidence')
  return {
    task: readFileSync(taskPath(cwd, id), 'utf8'),
    events: readFileSync(join(directory, 'events.jsonl'), 'utf8'),
    state: readFileSync(join(cwd, '.latch', 'state.json'), 'utf8'),
    evidence: existsSync(evidenceDirectory)
      ? readdirSync(evidenceDirectory)
          .sort()
          .map((name) => [
            name,
            readFileSync(join(evidenceDirectory, name), 'utf8'),
          ])
      : [],
  }
}

function authorization(source) {
  return {
    kind: 'implementation_authorization',
    source,
    reason: `${source} acceptance authorization`,
    scope: { summary: '实施更新后的当前 plan' },
  }
}

function updateAcceptance(cwd, id, updates, options = {}) {
  const updatesFile = options.updatesFile ?? writeJson(cwd, 'updates.json', updates)
  const args = [
    'update-acceptance',
    id,
    '--expect-revision',
    options.expectRevision ?? revision(cwd, id),
    '--updates-file',
    updatesFile,
  ]
  if (options.authorizationFile)
    args.push('--authorization-file', options.authorizationFile)
  if (options.brief) args.push('--brief')
  if (options.json !== false) args.push('--json')
  return run(cwd, args, {
    actor: options.actor ?? owner,
    input: options.input,
  })
}

function createTask(cwd, title, acceptance = ['接受 A', '接受 B', '接受 C'], overrides = {}) {
  return checkpoint(cwd, title, {
    acceptance,
    ...overrides,
  })
}

function seedLifecycle(cwd, id, phase) {
  const task = readTask(cwd, id)
  const evidenceDirectory = join(taskDirectory(cwd, id), 'evidence')
  mkdirSync(evidenceDirectory, { recursive: true })
  writeFileSync(join(evidenceDirectory, 'baseline.json'), '{}\n')
  task.phase = phase
  if (phase !== 'plan') {
    task.work_revision = 1
    task.implementation_approval = {
      approved_plan_revision: task.plan_revision,
      approved_at: task.updated_at,
      source: 'user',
      reason: 'fixture approval',
    }
  }
  if (phase === 'check') {
    delete task.implementation_approval
    task.work_basis = {
      kind: 'implementation_authorization',
      plan_revision: task.plan_revision,
      authorized_at: task.updated_at,
      source: 'user_approve',
      reason: 'fixture structured authorization',
      scope: { summary: 'fixture scope' },
    }
  }
  task.verification.gate.tests = {
    name: 'tests',
    kind: 'gate',
    command: ['pnpm', 'test'],
    status: 'pass',
    exit_code: 0,
    work_revision: task.work_revision,
    created_at: task.updated_at,
  }
  task.workspace_proof = {
    generation: 1,
    baseline_ref: {
      path: 'evidence/baseline.json',
      sha256: '0'.repeat(64),
      entry_count: 0,
    },
    baseline_counts: {
      tracked_dirty: 0,
      untracked: 0,
      explicit_ignored: 0,
      in_scope: 0,
      out_of_scope: 0,
    },
    unresolved_violations: [],
  }
  if (phase === 'review') {
    task.submission = {
      plan_revision: task.plan_revision,
      work_revision: task.work_revision,
      changes: 'fixture submission',
      verified: 'tests: pass',
      unverified_items: [],
      knowledge_impact: { kind: 'none', reason: 'fixture' },
      submitted_at: task.updated_at,
    }
  }
  writeTask(cwd, id, task)
  return task
}

test('update-acceptance replaces exact items in place and preserves every other plan field', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = createTask(cwd, 'update acceptance success')
  const before = readTask(cwd, created.task_id)
  const replacements = [
    { from: '接受 A', to: '接受 A2' },
    { from: '接受 C', to: '接受 C2' },
  ]

  const result = updateAcceptance(cwd, created.task_id, { replacements })

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.schema_version, 3)
  assert.equal(output.previous_revision, 1)
  assert.equal(output.revision, 2)
  assert.equal(output.phase, 'plan')
  assert.equal(output.plan_revision, 2)
  assert.equal(output.work_revision, 0)
  assert.equal(output.authorization_applied, false)
  assert.deepEqual(output.replacements, replacements)
  assert.deepEqual(output.next_action, {
    kind: 'await_user',
    boundary: 'approval',
    reason: 'implementation_plan',
  })
  const after = readTask(cwd, created.task_id)
  assert.deepEqual(after.plan, {
    ...before.plan,
    acceptance: ['接受 A2', '接受 B', '接受 C2'],
  })
  const event = events(cwd, created.task_id).at(-1)
  const { created_at: eventCreatedAt, ...eventFields } = event
  assert.deepEqual(eventFields, {
    plan_revision: 2,
    type: 'plan_updated',
    task_id: created.task_id,
    actor: owner,
    revision: 2,
  })
  assert.equal(Number.isNaN(Date.parse(eventCreatedAt)), false)

  const human = updateAcceptance(
    cwd,
    created.task_id,
    { replacements: [{ from: '接受 B', to: '接受 B2' }] },
    { json: false },
  )
  assert.equal(human.status, 0, human.stderr)
  assert.equal(
    human.stdout,
    `Updated 1 acceptance item(s) for ${created.task_id}.\n` +
      'Lifecycle: plan revision 2 -> 3; task revision 2 -> 3; phase plan; authorization not-applied.\n',
  )
})

test('update-acceptance rejects invalid replacements without partial mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = createTask(cwd, 'update acceptance refusals')
  const cases = [
    [{ replacements: [], extra: true }, /only the replacements property/],
    [{ replacements: [] }, /at least one item/],
    [{ replacements: [{ from: '接受 A', to: '接受 A2', extra: true }] }, /only from and to/],
    [{ replacements: [{ from: '', to: '接受 A2' }] }, /from at index 0 must be non-empty/],
    [{ replacements: [{ from: '接受 A', to: ' ' }] }, /to at index 0 must be non-empty/],
    [{ replacements: [{ from: '接受 A', to: '接受 A' }] }, /must change the acceptance text/],
    [{ replacements: [
      { from: '接受 A', to: '接受 A2' },
      { from: '接受 A', to: '接受 A3' },
    ] }, /duplicates an earlier replacement target/],
    [{ replacements: [{ from: '不存在', to: '接受 A2' }] }, /matched 0/],
    [{ replacements: [{ from: '接受 A', to: '接受 B' }] }, /must not create duplicate acceptance items/],
  ]

  for (const [updates, pattern] of cases) {
    const before = storedState(cwd, created.task_id)
    const result = updateAcceptance(cwd, created.task_id, updates)
    assert.notEqual(result.status, 0)
    const error = JSON.parse(result.stderr).error
    assert.equal(error.code, 'invalid_arguments')
    assert.match(error.message, pattern)
    assert.deepEqual(storedState(cwd, created.task_id), before)
  }

  const duplicate = createTask(
    cwd,
    'update duplicate acceptance refusal',
    ['重复验收', '重复验收'],
  )
  const before = storedState(cwd, duplicate.task_id)
  const result = updateAcceptance(cwd, duplicate.task_id, {
    replacements: [{ from: '重复验收', to: '新验收' }],
  })
  assert.notEqual(result.status, 0)
  assert.match(JSON.parse(result.stderr).error.message, /matched 2/)
  assert.deepEqual(storedState(cwd, duplicate.task_id), before)
})

test('update-acceptance invalidates lifecycle proof while retaining the workspace baseline', () => {
  for (const phase of ['plan', 'dev', 'check', 'review']) {
    const cwd = temporaryDirectory()
    init(cwd)
    const created = createTask(cwd, `update acceptance from ${phase}`)
    const before = seedLifecycle(cwd, created.task_id, phase)
    const sidecar = join(
      taskDirectory(cwd, created.task_id),
      'evidence',
      'baseline.json',
    )

    const result = updateAcceptance(cwd, created.task_id, {
      replacements: [{ from: '接受 A', to: `接受 A ${phase}` }],
    })

    assert.equal(result.status, 0, `${phase}: ${result.stderr}`)
    const output = JSON.parse(result.stdout)
    assert.equal(output.phase, 'plan')
    assert.equal(output.plan_revision, 2)
    assert.equal(output.work_revision, before.work_revision)
    assert.equal('workspace_proof' in output, true)
    const after = readTask(cwd, created.task_id)
    assert.equal(after.phase, 'plan')
    assert.equal(after.plan_revision, 2)
    assert.equal(after.work_revision, before.work_revision)
    assert.deepEqual(after.verification, { gate: {}, diagnostic: {} })
    assert.equal('submission' in after, false)
    assert.deepEqual(after.workspace_proof, before.workspace_proof)
    assert.equal(existsSync(sidecar), true)
  }
})

test('update-acceptance applies explicit user_approve and valid user_delta authorization atomically', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const approved = createTask(cwd, 'update acceptance user approve')
  const approveFile = writeJson(cwd, 'approve.json', authorization('user_approve'))
  let result = updateAcceptance(
    cwd,
    approved.task_id,
    { replacements: [{ from: '接受 A', to: '接受 A approved' }] },
    { authorizationFile: approveFile },
  )
  assert.equal(result.status, 0, result.stderr)
  let output = JSON.parse(result.stdout)
  assert.equal(output.authorization_applied, true)
  assert.equal(output.phase, 'dev')
  assert.equal(output.plan_revision, 2)
  assert.equal(output.work_revision, 1)
  assert.deepEqual(output.next_action, {
    kind: 'command',
    command: 'verify-all',
  })
  let task = readTask(cwd, approved.task_id)
  assert.equal(task.work_basis.source, 'user_approve')
  assert.equal(task.work_basis.plan_revision, 2)
  assert.deepEqual(
    events(cwd, approved.task_id).slice(-3).map((event) => event.type),
    ['plan_updated', 'implementation_authorized', 'work_started'],
  )

  const delta = createTask(cwd, 'update acceptance user delta')
  const initialApproval = run(cwd, [
    'approve',
    delta.task_id,
    '--expect-revision',
    '1',
    '--reason',
    'approve initial plan',
    '--json',
  ])
  assert.equal(initialApproval.status, 0, initialApproval.stderr)
  const deltaFile = writeJson(cwd, 'delta.json', authorization('user_delta'))
  result = updateAcceptance(
    cwd,
    delta.task_id,
    { replacements: [{ from: '接受 B', to: '接受 B delta' }] },
    { authorizationFile: deltaFile },
  )
  assert.equal(result.status, 0, result.stderr)
  output = JSON.parse(result.stdout)
  assert.equal(output.plan_revision, 2)
  assert.equal(output.work_revision, 2)
  task = readTask(cwd, delta.task_id)
  assert.equal(task.phase, 'dev')
  assert.equal(task.work_basis.source, 'user_delta')
  assert.equal(task.work_basis.plan_revision, 2)
})

test('update-acceptance refuses inferred or invalid authorization before mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = createTask(cwd, 'update acceptance invalid authorization')
  const cases = [
    authorization('user_delta'),
    authorization('user_request'),
    { ...authorization('user_approve'), reason: '' },
  ]
  for (const [index, value] of cases.entries()) {
    const authorizationFile = writeJson(cwd, `invalid-${index}.json`, value)
    const before = storedState(cwd, created.task_id)
    const result = updateAcceptance(
      cwd,
      created.task_id,
      { replacements: [{ from: '接受 A', to: '接受 A2' }] },
      { authorizationFile },
    )
    assert.notEqual(result.status, 0)
    assert.equal(JSON.parse(result.stderr).error.code, 'invalid_arguments')
    assert.deepEqual(storedState(cwd, created.task_id), before)
  }

  const openQuestion = createTask(
    cwd,
    'update acceptance unapprovable plan',
    undefined,
    { open_questions: ['是否继续？'] },
  )
  const approveFile = writeJson(cwd, 'unapprovable.json', authorization('user_approve'))
  const before = storedState(cwd, openQuestion.task_id)
  const denied = updateAcceptance(
    cwd,
    openQuestion.task_id,
    { replacements: [{ from: '接受 A', to: '接受 A2' }] },
    { authorizationFile: approveFile },
  )
  assert.notEqual(denied.status, 0)
  assert.equal(JSON.parse(denied.stderr).error.code, 'invalid_arguments')
  assert.deepEqual(storedState(cwd, openQuestion.task_id), before)
})

test('update-acceptance returns typed task, writer, schema, blocked, and revision refusals without mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const missing = updateAcceptance(
    cwd,
    'missing-task',
    { replacements: [{ from: '接受 A', to: '接受 A2' }] },
    { expectRevision: '1' },
  )
  assert.notEqual(missing.status, 0)
  assert.equal(JSON.parse(missing.stderr).error.code, 'task_not_found')

  const revisionTask = createTask(cwd, 'update acceptance revision refusal')
  let before = storedState(cwd, revisionTask.task_id)
  let result = updateAcceptance(
    cwd,
    revisionTask.task_id,
    { replacements: [{ from: '接受 A', to: '接受 A2' }] },
    { expectRevision: '9' },
  )
  assert.notEqual(result.status, 0)
  assert.equal(JSON.parse(result.stderr).error.code, 'revision_conflict')
  assert.deepEqual(storedState(cwd, revisionTask.task_id), before)

  result = updateAcceptance(
    cwd,
    revisionTask.task_id,
    { replacements: [{ from: '接受 A', to: '接受 A2' }] },
    { actor: otherWriter },
  )
  assert.notEqual(result.status, 0)
  assert.equal(JSON.parse(result.stderr).error.code, 'writer_mismatch')
  assert.deepEqual(storedState(cwd, revisionTask.task_id), before)

  for (const schemaVersion of [2, 3, 4]) {
    const historicalTask = createTask(
      cwd,
      `update acceptance schema ${schemaVersion} refusal`,
    )
    const historical = readTask(cwd, historicalTask.task_id)
    historical.schema_version = schemaVersion
    if (schemaVersion === 4) historical.min_writer_version = '0.4.0'
    else delete historical.min_writer_version
    if (schemaVersion === 2) {
      delete historical.primary_writer
      delete historical.profile
      delete historical.provenance
    }
    writeTask(cwd, historicalTask.task_id, historical)
    before = storedState(cwd, historicalTask.task_id)
    result = updateAcceptance(
      cwd,
      historicalTask.task_id,
      { replacements: [{ from: '接受 A', to: '接受 A2' }] },
    )
    assert.notEqual(result.status, 0)
    assert.equal(
      JSON.parse(result.stderr).error.code,
      'writer_version_mismatch',
    )
    assert.deepEqual(storedState(cwd, historicalTask.task_id), before)
  }

  const blockedTask = createTask(cwd, 'update acceptance blocked refusal')
  const blocked = readTask(cwd, blockedTask.task_id)
  blocked.blocked = {
    reason: '等待输入',
    waiting_for: '用户',
    blocked_at: blocked.updated_at,
  }
  writeTask(cwd, blockedTask.task_id, blocked)
  before = storedState(cwd, blockedTask.task_id)
  result = updateAcceptance(
    cwd,
    blockedTask.task_id,
    { replacements: [{ from: '接受 A', to: '接受 A2' }] },
  )
  assert.notEqual(result.status, 0)
  assert.equal(JSON.parse(result.stderr).error.code, 'task_blocked')
  assert.deepEqual(storedState(cwd, blockedTask.task_id), before)
})

test('update-acceptance enforces one stdin consumer and exposes bounded brief output', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = createTask(cwd, 'update acceptance stdin')
  const before = storedState(cwd, created.task_id)
  const dualStdin = updateAcceptance(
    cwd,
    created.task_id,
    {},
    {
      updatesFile: '-',
      authorizationFile: '-',
      input: '{}',
    },
  )
  assert.notEqual(dualStdin.status, 0)
  assert.equal(JSON.parse(dualStdin.stderr).error.code, 'invalid_arguments')
  assert.deepEqual(storedState(cwd, created.task_id), before)

  const stdinResult = updateAcceptance(
    cwd,
    created.task_id,
    {},
    {
      updatesFile: '-',
      input: JSON.stringify({
        replacements: [{ from: '接受 A', to: '接受 A stdin' }],
      }),
      brief: true,
    },
  )
  assert.equal(stdinResult.status, 0, stdinResult.stderr)
  const output = JSON.parse(stdinResult.stdout)
  assert.equal(output.replacement_count, 1)
  assert.equal('replacements' in output, false)
})

test('update-acceptance help exposes only the approved arguments', () => {
  const cwd = temporaryDirectory()
  const expected =
    'Usage: latch update-acceptance <task-id> --expect-revision <revision> --updates-file <path|-> [--authorization-file <path|->] [--json] [--brief]\n' +
    '--authorization-file JSON: {"kind":"implementation_authorization","source":"user_delta","reason":"Describe the authorized plan delta.","scope":{"summary":"Describe the current post-delta plan."}}\n'
  const human = run(cwd, ['update-acceptance', '--help'])
  assert.equal(human.status, 0, human.stderr)
  assert.equal(human.stdout, expected)
  const jsonMode = run(cwd, ['update-acceptance', '--help', '--json'])
  assert.equal(jsonMode.status, 0, jsonMode.stderr)
  assert.equal(jsonMode.stdout, expected)
  const top = run(cwd, ['--help'])
  assert.equal(top.status, 0, top.stderr)
  assert.match(top.stdout, /update-acceptance <task-id>/)
})
