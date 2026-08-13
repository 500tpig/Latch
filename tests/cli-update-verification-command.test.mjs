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
const otherWriter = 'codex:session:update-verification-other'

test.afterEach(cleanupTemporaryDirectories)

function taskDirectory(cwd, id) {
  return join(cwd, '.latch', 'tasks', id)
}

function writeTask(cwd, id, task) {
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(task, null, 2)}\n`)
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

function updateVerificationCommand(cwd, id, name, command, options = {}) {
  const args = [
    'update-verification-command',
    id,
    '--expect-revision',
    options.expectRevision ?? revision(cwd, id),
    '--name',
    name,
  ]
  if (options.authorizationFile)
    args.push('--authorization-file', options.authorizationFile)
  if (options.json !== false) args.push('--json')
  if (options.omitSeparator) args.push(...command)
  else args.push('--', ...command)
  return run(cwd, args, {
    actor: options.actor ?? owner,
    input: options.input,
  })
}

function authorization(source) {
  return {
    kind: 'implementation_authorization',
    source,
    reason: `${source} verification command authorization`,
    scope: { summary: '实施更新后的当前 plan' },
  }
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
  task.verification.diagnostic.notes = {
    name: 'notes',
    kind: 'diagnostic',
    command: ['echo', 'notes'],
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

function createTask(cwd, title, overrides = {}) {
  return checkpoint(cwd, title, {
    verification_plan: [
      { name: 'tests', command: ['pnpm', 'test'], kind: 'gate' },
      { name: 'notes', command: ['echo', 'notes'], kind: 'diagnostic' },
    ],
    ...overrides,
  })
}

test('update-verification-command updates one gate argv and preserves every other plan field', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = createTask(cwd, 'update verification success')
  const before = readTask(cwd, created.task_id)
  const command = ['pnpm', 'check', '--filter', 'pkg with space', 'ユニコード']

  const result = updateVerificationCommand(
    cwd,
    created.task_id,
    'tests',
    command,
  )

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.schema_version, 2)
  assert.equal(output.previous_revision, 1)
  assert.equal(output.revision, 2)
  assert.equal(output.phase, 'plan')
  assert.equal(output.plan_revision, 2)
  assert.equal(output.work_revision, 0)
  assert.equal(output.authorization_applied, false)
  assert.equal(output.next_action, 'approve')
  assert.deepEqual(output.verification, {
    name: 'tests',
    kind: 'gate',
    previous_command: ['pnpm', 'test'],
    command,
  })
  const after = readTask(cwd, created.task_id)
  assert.deepEqual(after.plan, {
    ...before.plan,
    verification_plan: [
      { name: 'tests', command, kind: 'gate' },
      { name: 'notes', command: ['echo', 'notes'], kind: 'diagnostic' },
    ],
  })
  assert.equal(after.plan_revision, 2)
  assert.equal(after.work_revision, 0)
  const event = events(cwd, created.task_id).at(-1)
  const { created_at: eventCreatedAt, ...eventFields } = event
  assert.deepEqual(eventFields, {
    plan_revision: 2,
    change: 'verification_command_update',
    gate_name: 'tests',
    previous_command: ['pnpm', 'test'],
    command,
    type: 'plan_updated',
    task_id: created.task_id,
    actor: owner,
    revision: 2,
  })
  assert.equal(Number.isNaN(Date.parse(eventCreatedAt)), false)

  const human = updateVerificationCommand(
    cwd,
    created.task_id,
    'tests',
    ['node', '--test', 'tests/cli-update-verification-command.test.mjs'],
    { json: false },
  )
  assert.equal(human.status, 0, human.stderr)
  assert.equal(
    human.stdout,
    `Updated verification command for ${created.task_id} gate tests: "node" "--test" "tests/cli-update-verification-command.test.mjs".\n` +
      'Lifecycle: plan revision 2 -> 3; task revision 2 -> 3; phase plan; authorization not-applied.\n',
  )
})

test('update-verification-command rejects invalid targets and commands without partial mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = createTask(cwd, 'update verification refusals')
  const cases = [
    {
      name: 'missing',
      command: ['pnpm', 'check'],
      pattern: /could not find verification item/,
    },
    {
      name: 'notes',
      command: ['pnpm', 'check'],
      pattern: /only updates kind=gate/,
    },
    {
      name: 'tests',
      command: [],
      pattern: /non-empty command after --/,
    },
    {
      name: 'tests',
      command: ['pnpm', 'test'],
      pattern: /is unchanged/,
    },
    {
      name: 'tests',
      command: ['replace-with-real-command'],
      pattern: /sentinel command token/,
    },
    {
      name: 'tests',
      command: ['echo', 'done'],
      pattern: /instruction-only gate command echo/,
    },
    {
      name: 'tests',
      command: ['printf', 'done'],
      pattern: /instruction-only gate command printf/,
    },
    {
      name: 'tests',
      command: ['true'],
      pattern: /instruction-only gate command true/,
    },
    {
      name: 'tests',
      command: ['/usr/bin/echo', 'done'],
      pattern: /instruction-only gate command echo/,
    },
  ]

  for (const fixture of cases) {
    const before = storedState(cwd, created.task_id)
    const result = updateVerificationCommand(
      cwd,
      created.task_id,
      fixture.name,
      fixture.command,
    )
    assert.notEqual(result.status, 0, fixture.command.join(' '))
    const error = JSON.parse(result.stderr).error
    assert.equal(error.code, 'invalid_arguments')
    assert.match(error.message, fixture.pattern)
    assert.deepEqual(storedState(cwd, created.task_id), before)
  }

  const withoutSeparator = updateVerificationCommand(
    cwd,
    created.task_id,
    'tests',
    ['pnpm', 'check'],
    { omitSeparator: true },
  )
  assert.notEqual(withoutSeparator.status, 0)
  assert.equal(
    JSON.parse(withoutSeparator.stderr).error.code,
    'invalid_arguments',
  )
  assert.match(
    JSON.parse(withoutSeparator.stderr).error.message,
    /command argv must follow --/,
  )
})

test('update-verification-command invalidates authorization, verification, and submission while retaining workspace baseline', () => {
  for (const phase of ['plan', 'dev', 'check', 'review']) {
    const cwd = temporaryDirectory()
    init(cwd)
    const created = createTask(cwd, `update from ${phase}`)
    const before = seedLifecycle(cwd, created.task_id, phase)
    const sidecar = join(
      taskDirectory(cwd, created.task_id),
      'evidence',
      'baseline.json',
    )

    const result = updateVerificationCommand(
      cwd,
      created.task_id,
      'tests',
      ['pnpm', 'check', phase],
    )

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
    assert.equal('implementation_approval' in after, false)
    if (before.work_basis) {
      assert.deepEqual(after.work_basis, before.work_basis)
      assert.notEqual(after.work_basis.plan_revision, after.plan_revision)
    }
    assert.deepEqual(after.verification, { gate: {}, diagnostic: {} })
    assert.equal('submission' in after, false)
    assert.deepEqual(after.workspace_proof, before.workspace_proof)
    assert.equal(existsSync(sidecar), true)
  }
})

test('update-verification-command applies explicit user_approve and valid user_delta authorization atomically', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const approved = createTask(cwd, 'update user approve')
  const userApprove = authorization('user_approve')
  const result = updateVerificationCommand(
    cwd,
    approved.task_id,
    'tests',
    ['pnpm', 'check'],
    {
      authorizationFile: '-',
      input: JSON.stringify(userApprove),
    },
  )
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.authorization_applied, true)
  assert.equal(output.phase, 'dev')
  assert.equal(output.plan_revision, 2)
  assert.equal(output.work_revision, 1)
  assert.equal(output.next_action, 'verify')
  let task = readTask(cwd, approved.task_id)
  assert.equal(task.work_basis.source, 'user_approve')
  assert.equal(task.work_basis.plan_revision, 2)
  assert.equal(task.work_revision, 1)
  assert.deepEqual(
    events(cwd, approved.task_id).slice(-3).map((event) => event.type),
    ['plan_updated', 'implementation_authorized', 'work_started'],
  )

  const delta = createTask(cwd, 'update user delta')
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
  const userDelta = authorization('user_delta')
  const deltaResult = updateVerificationCommand(
    cwd,
    delta.task_id,
    'tests',
    ['pnpm', 'check'],
    {
      authorizationFile: '-',
      input: JSON.stringify(userDelta),
    },
  )
  assert.equal(deltaResult.status, 0, deltaResult.stderr)
  task = readTask(cwd, delta.task_id)
  assert.equal(task.phase, 'dev')
  assert.equal(task.plan_revision, 2)
  assert.equal(task.work_revision, 2)
  assert.equal(task.work_basis.source, 'user_delta')
  assert.equal(task.work_basis.plan_revision, 2)
})

test('update-verification-command refuses inferred or invalid authorization before mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = createTask(cwd, 'update invalid authorization')
  const cases = [
    authorization('user_delta'),
    authorization('user_request'),
    { ...authorization('user_approve'), reason: '' },
  ]
  for (const value of cases) {
    const before = storedState(cwd, created.task_id)
    const result = updateVerificationCommand(
      cwd,
      created.task_id,
      'tests',
      ['pnpm', 'check'],
      {
        authorizationFile: '-',
        input: JSON.stringify(value),
      },
    )
    assert.notEqual(result.status, 0)
    assert.equal(JSON.parse(result.stderr).error.code, 'invalid_arguments')
    assert.deepEqual(storedState(cwd, created.task_id), before)
  }

  const openQuestion = createTask(cwd, 'update unapprovable plan', {
    open_questions: ['是否继续？'],
  })
  const before = storedState(cwd, openQuestion.task_id)
  const denied = updateVerificationCommand(
    cwd,
    openQuestion.task_id,
    'tests',
    ['pnpm', 'check'],
    {
      authorizationFile: '-',
      input: JSON.stringify(authorization('user_approve')),
    },
  )
  assert.notEqual(denied.status, 0)
  assert.equal(JSON.parse(denied.stderr).error.code, 'invalid_arguments')
  assert.deepEqual(storedState(cwd, openQuestion.task_id), before)
})

test('update-verification-command returns typed task, writer, schema, blocked, and revision refusals without mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)

  const missing = updateVerificationCommand(
    cwd,
    'missing-task',
    'tests',
    ['pnpm', 'check'],
    { expectRevision: '1' },
  )
  assert.notEqual(missing.status, 0)
  assert.equal(JSON.parse(missing.stderr).error.code, 'task_not_found')

  const revisionTask = createTask(cwd, 'update revision refusal')
  let before = storedState(cwd, revisionTask.task_id)
  const revisionResult = updateVerificationCommand(
    cwd,
    revisionTask.task_id,
    'tests',
    ['pnpm', 'check'],
    { expectRevision: '9' },
  )
  assert.notEqual(revisionResult.status, 0)
  assert.equal(JSON.parse(revisionResult.stderr).error.code, 'revision_conflict')
  assert.deepEqual(storedState(cwd, revisionTask.task_id), before)

  before = storedState(cwd, revisionTask.task_id)
  const writerResult = updateVerificationCommand(
    cwd,
    revisionTask.task_id,
    'tests',
    ['pnpm', 'check'],
    { actor: otherWriter },
  )
  assert.notEqual(writerResult.status, 0)
  assert.equal(JSON.parse(writerResult.stderr).error.code, 'writer_mismatch')
  assert.deepEqual(storedState(cwd, revisionTask.task_id), before)

  for (const schemaVersion of [2, 3, 4]) {
    const historicalTask = createTask(
      cwd,
      `update schema ${schemaVersion} refusal`,
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
    const historicalResult = updateVerificationCommand(
      cwd,
      historicalTask.task_id,
      'tests',
      ['pnpm', 'check'],
    )
    assert.notEqual(historicalResult.status, 0)
    assert.equal(
      JSON.parse(historicalResult.stderr).error.code,
      'writer_version_mismatch',
    )
    assert.deepEqual(storedState(cwd, historicalTask.task_id), before)
  }

  const blockedTask = createTask(cwd, 'update blocked refusal')
  const blocked = readTask(cwd, blockedTask.task_id)
  blocked.blocked = {
    reason: '等待输入',
    waiting_for: '用户',
    blocked_at: blocked.updated_at,
  }
  writeTask(cwd, blockedTask.task_id, blocked)
  before = storedState(cwd, blockedTask.task_id)
  const blockedResult = updateVerificationCommand(
    cwd,
    blockedTask.task_id,
    'tests',
    ['pnpm', 'check'],
  )
  assert.notEqual(blockedResult.status, 0)
  assert.equal(JSON.parse(blockedResult.stderr).error.code, 'task_blocked')
  assert.deepEqual(storedState(cwd, blockedTask.task_id), before)
})

test('update-verification-command maps reader shape failures to frozen typed errors', () => {
  const duplicateCwd = temporaryDirectory()
  init(duplicateCwd)
  const duplicateTask = createTask(duplicateCwd, 'update duplicate name refusal')
  const duplicate = readTask(duplicateCwd, duplicateTask.task_id)
  duplicate.plan.verification_plan = [
    { name: 'tests', command: ['pnpm', 'test'], kind: 'gate' },
    { name: 'tests', command: ['pnpm', 'lint'], kind: 'gate' },
  ]
  writeTask(duplicateCwd, duplicateTask.task_id, duplicate)
  let before = storedState(duplicateCwd, duplicateTask.task_id)
  const duplicateResult = updateVerificationCommand(
    duplicateCwd,
    duplicateTask.task_id,
    'tests',
    ['pnpm', 'check'],
  )
  assert.notEqual(duplicateResult.status, 0)
  assert.equal(
    JSON.parse(duplicateResult.stderr).error.code,
    'invalid_arguments',
  )
  assert.match(
    JSON.parse(duplicateResult.stderr).error.message,
    /Duplicate verification_plan\.name/,
  )
  assert.deepEqual(storedState(duplicateCwd, duplicateTask.task_id), before)

  const unwritableCwd = temporaryDirectory()
  init(unwritableCwd)
  const unwritableTask = createTask(
    unwritableCwd,
    'update unwritable min writer refusal',
  )
  const unwritable = readTask(unwritableCwd, unwritableTask.task_id)
  unwritable.min_writer_version = '0.4.0'
  writeTask(unwritableCwd, unwritableTask.task_id, unwritable)
  before = storedState(unwritableCwd, unwritableTask.task_id)
  const unwritableResult = updateVerificationCommand(
    unwritableCwd,
    unwritableTask.task_id,
    'tests',
    ['pnpm', 'check'],
  )
  assert.notEqual(unwritableResult.status, 0)
  assert.equal(
    JSON.parse(unwritableResult.stderr).error.code,
    'writer_version_mismatch',
  )
  assert.match(
    JSON.parse(unwritableResult.stderr).error.message,
    /Invalid min_writer_version/,
  )
  assert.deepEqual(storedState(unwritableCwd, unwritableTask.task_id), before)
})

test('update-verification-command keeps -- after separator out of Latch CLI flag handling', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = createTask(cwd, 'separator fidelity')

  const withVersionArgv = updateVerificationCommand(
    cwd,
    created.task_id,
    'tests',
    ['node', 'script.mjs', '--version'],
  )
  assert.equal(withVersionArgv.status, 0, withVersionArgv.stderr)
  const afterVersion = readTask(cwd, created.task_id)
  assert.deepEqual(afterVersion.plan.verification_plan[0].command, [
    'node',
    'script.mjs',
    '--version',
  ])

  const humanFailure = updateVerificationCommand(
    cwd,
    created.task_id,
    'missing-gate',
    ['node', 'script.mjs', '--json'],
    { json: false },
  )
  assert.notEqual(humanFailure.status, 0)
  assert.equal(humanFailure.stdout, '')
  assert.doesNotMatch(humanFailure.stderr.trim(), /^\{/)
  assert.match(humanFailure.stderr, /could not find verification item/)
  assert.match(humanFailure.stderr, /missing-gate/)
})

test('update-verification-command human and JSON help expose only the approved arguments', () => {
  const cwd = temporaryDirectory()
  const expected =
    'Usage: latch update-verification-command <task-id> --expect-revision <revision> --name <existing-gate-name> [--authorization-file <path|->] [--json] -- <command> [arg...]\n'
  const human = run(cwd, ['update-verification-command', '--help'])
  assert.equal(human.status, 0, human.stderr)
  assert.equal(human.stdout, expected)
  const jsonMode = run(cwd, ['update-verification-command', '--help', '--json'])
  assert.equal(jsonMode.status, 0, jsonMode.stderr)
  assert.equal(jsonMode.stdout, expected)
  const top = run(cwd, ['--help'])
  assert.equal(top.status, 0, top.stderr)
  assert.match(top.stdout, /update-verification-command <task-id>/)
  const unknown = run(cwd, [
    'update-verification-command',
    'task',
    '--expect-revision',
    '1',
    '--name',
    'tests',
    '--plan-file',
    'plan.json',
    '--json',
    '--',
    'pnpm',
    'check',
  ])
  assert.notEqual(unknown.status, 0)
  assert.equal(JSON.parse(unknown.stderr).error.code, 'invalid_arguments')
})

test('update-verification-command does not execute the new gate command', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  writeFileSync(
    join(cwd, 'should-not-run.mjs'),
    'throw new Error("command executed")\n',
  )
  const created = createTask(cwd, 'update does not execute')
  const result = updateVerificationCommand(
    cwd,
    created.task_id,
    'tests',
    [process.execPath, join(cwd, 'should-not-run.mjs')],
  )
  assert.equal(result.status, 0, result.stderr)
  const after = readTask(cwd, created.task_id)
  assert.deepEqual(after.verification, { gate: {}, diagnostic: {} })
})
