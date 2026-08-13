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
const otherWriter = 'codex:session:append-scope-other'

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

function appendScope(cwd, id, paths, options = {}) {
  const args = [
    'append-scope',
    id,
    '--expect-revision',
    options.expectRevision ?? revision(cwd, id),
  ]
  for (const path of paths) args.push('--path', path)
  if (options.authorizationFile)
    args.push('--authorization-file', options.authorizationFile)
  if (options.json !== false) args.push('--json')
  return run(cwd, args, {
    actor: options.actor ?? owner,
    input: options.input,
  })
}

function authorization(source) {
  return {
    kind: 'implementation_authorization',
    source,
    reason: `${source} append authorization`,
    scope: { summary: '实施追加后的当前 plan' },
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

test('append-scope appends normalized unique paths and preserves every other plan field', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  mkdirSync(join(cwd, 'assets'))
  const created = checkpoint(cwd, 'append scope success', {
    workspace_scope: { paths: ['existing.txt'] },
  })
  const before = readTask(cwd, created.task_id)

  const result = appendScope(cwd, created.task_id, [
    'existing.txt',
    'docs/new.md',
    'lib//entry.ts',
    'docs/new.md',
    'assets/',
  ])

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.schema_version, 3)
  assert.equal(output.previous_revision, 1)
  assert.equal(output.revision, 2)
  assert.equal(output.phase, 'plan')
  assert.equal(output.plan_revision, 2)
  assert.equal(output.work_revision, 0)
  assert.equal(output.authorization_applied, false)
  assert.deepEqual(output.next_action, {
    kind: 'await_user',
    boundary: 'approval',
    reason: 'implementation_plan',
  })
  assert.deepEqual(output.appended_paths, [
    'docs/new.md',
    'lib/entry.ts',
    'assets/',
  ])
  const after = readTask(cwd, created.task_id)
  assert.deepEqual(after.plan, {
    ...before.plan,
    workspace_scope: {
      paths: ['existing.txt', 'docs/new.md', 'lib/entry.ts', 'assets/'],
    },
  })
  assert.equal(after.plan_revision, 2)
  assert.equal(after.work_revision, 0)
  const event = events(cwd, created.task_id).at(-1)
  const { created_at: eventCreatedAt, ...eventFields } = event
  assert.deepEqual(eventFields, {
    plan_revision: 2,
    change: 'workspace_scope_append',
    appended_paths: ['docs/new.md', 'lib/entry.ts', 'assets/'],
    type: 'plan_updated',
    task_id: created.task_id,
    actor: owner,
    revision: 2,
  })
  assert.equal(Number.isNaN(Date.parse(eventCreatedAt)), false)

  const human = appendScope(cwd, created.task_id, ['next.txt'], {
    json: false,
  })
  assert.equal(human.status, 0, human.stderr)
  assert.equal(
    human.stdout,
    `Appended 1 workspace scope path(s) to ${created.task_id}: next.txt.\n` +
      'Lifecycle: plan revision 2 -> 3; task revision 2 -> 3; phase plan; authorization not-applied.\n',
  )
})

test('append-scope rejects invalid, root, directory, and no-op paths without partial mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  mkdirSync(join(cwd, 'existing-directory'))
  const created = checkpoint(cwd, 'append scope refusals', {
    workspace_scope: { paths: ['existing.txt'] },
  })
  const cases = [
    { paths: [], pattern: /--path is required/ },
    { paths: [''], pattern: /empty or root path/ },
    { paths: ['/absolute.txt'], pattern: /Invalid plan\.workspace_scope\.paths/ },
    { paths: ['../escape.txt'], pattern: /Invalid plan\.workspace_scope\.paths/ },
    { paths: ['src/*.ts'], pattern: /Invalid plan\.workspace_scope\.paths/ },
    { paths: [':(top)src/file.ts'], pattern: /Invalid plan\.workspace_scope\.paths/ },
    { paths: ['.'], pattern: /repo root/ },
    { paths: ['./'], pattern: /repo root/ },
    { paths: ['existing-directory'], pattern: /existing directory/ },
    { paths: ['existing.txt', 'existing.txt'], pattern: /did not contain any new/ },
  ]

  for (const fixture of cases) {
    const before = storedState(cwd, created.task_id)
    const result = appendScope(cwd, created.task_id, fixture.paths)
    assert.notEqual(result.status, 0, fixture.paths.join(','))
    const error = JSON.parse(result.stderr).error
    assert.equal(error.code, 'invalid_arguments')
    assert.match(error.message, fixture.pattern)
    assert.deepEqual(storedState(cwd, created.task_id), before)
  }
})

test('append-scope invalidates authorization, verification, submission, and active proof in every open phase', () => {
  for (const phase of ['plan', 'dev', 'check', 'review']) {
    const cwd = temporaryDirectory()
    init(cwd)
    const created = checkpoint(cwd, `append from ${phase}`, {
      workspace_scope: { paths: ['existing.txt'] },
    })
    const before = seedLifecycle(cwd, created.task_id, phase)
    const sidecar = join(taskDirectory(cwd, created.task_id), 'evidence', 'baseline.json')

    const result = appendScope(cwd, created.task_id, [`${phase}.txt`])

    assert.equal(result.status, 0, `${phase}: ${result.stderr}`)
    const output = JSON.parse(result.stdout)
    assert.equal(output.phase, 'plan')
    assert.equal(output.plan_revision, 2)
    assert.equal(output.work_revision, before.work_revision)
    assert.equal('workspace_proof' in output, false)
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
    assert.equal('workspace_proof' in after, false)
    assert.equal(existsSync(sidecar), true)
  }
})

test('append-scope applies explicit user_approve and valid user_delta authorization atomically', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const approved = checkpoint(cwd, 'append user approve', {
    workspace_scope: { paths: ['existing.txt'] },
  })
  const userApprove = authorization('user_approve')
  const result = appendScope(cwd, approved.task_id, ['approved.txt'], {
    authorizationFile: '-',
    input: JSON.stringify(userApprove),
  })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
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
  assert.equal(task.work_revision, 1)
  assert.deepEqual(
    events(cwd, approved.task_id).slice(-3).map((event) => event.type),
    ['plan_updated', 'implementation_authorized', 'work_started'],
  )

  const delta = checkpoint(cwd, 'append user delta', {
    workspace_scope: { paths: ['existing.txt'] },
  })
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
  const deltaResult = appendScope(cwd, delta.task_id, ['delta.txt'], {
    authorizationFile: '-',
    input: JSON.stringify(userDelta),
  })
  assert.equal(deltaResult.status, 0, deltaResult.stderr)
  task = readTask(cwd, delta.task_id)
  assert.equal(task.phase, 'dev')
  assert.equal(task.plan_revision, 2)
  assert.equal(task.work_revision, 2)
  assert.equal(task.work_basis.source, 'user_delta')
  assert.equal(task.work_basis.plan_revision, 2)
})

test('append-scope refuses inferred or invalid authorization before mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, 'append invalid authorization', {
    workspace_scope: { paths: ['existing.txt'] },
  })
  const cases = [
    authorization('user_delta'),
    authorization('user_request'),
    { ...authorization('user_approve'), reason: '' },
  ]
  for (const value of cases) {
    const before = storedState(cwd, created.task_id)
    const result = appendScope(cwd, created.task_id, ['new.txt'], {
      authorizationFile: '-',
      input: JSON.stringify(value),
    })
    assert.notEqual(result.status, 0)
    assert.equal(JSON.parse(result.stderr).error.code, 'invalid_arguments')
    assert.deepEqual(storedState(cwd, created.task_id), before)
  }

  const openQuestion = checkpoint(cwd, 'append unapprovable plan', {
    workspace_scope: { paths: ['existing.txt'] },
    open_questions: ['是否继续？'],
  })
  const before = storedState(cwd, openQuestion.task_id)
  const denied = appendScope(cwd, openQuestion.task_id, ['new.txt'], {
    authorizationFile: '-',
    input: JSON.stringify(authorization('user_approve')),
  })
  assert.notEqual(denied.status, 0)
  assert.equal(JSON.parse(denied.stderr).error.code, 'invalid_arguments')
  assert.deepEqual(storedState(cwd, openQuestion.task_id), before)
})

test('append-scope returns typed task, writer, schema, blocked, and revision refusals without mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)

  const missing = appendScope(cwd, 'missing-task', ['new.txt'], {
    expectRevision: '1',
  })
  assert.notEqual(missing.status, 0)
  assert.equal(JSON.parse(missing.stderr).error.code, 'task_not_found')

  const revisionTask = checkpoint(cwd, 'append revision refusal')
  let before = storedState(cwd, revisionTask.task_id)
  const revisionResult = appendScope(cwd, revisionTask.task_id, ['new.txt'], {
    expectRevision: '9',
  })
  assert.notEqual(revisionResult.status, 0)
  assert.equal(JSON.parse(revisionResult.stderr).error.code, 'revision_conflict')
  assert.deepEqual(storedState(cwd, revisionTask.task_id), before)

  before = storedState(cwd, revisionTask.task_id)
  const writerResult = appendScope(cwd, revisionTask.task_id, ['new.txt'], {
    actor: otherWriter,
  })
  assert.notEqual(writerResult.status, 0)
  assert.equal(JSON.parse(writerResult.stderr).error.code, 'writer_mismatch')
  assert.deepEqual(storedState(cwd, revisionTask.task_id), before)

  for (const schemaVersion of [2, 3, 4]) {
    const historicalTask = checkpoint(
      cwd,
      `append schema ${schemaVersion} refusal`,
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
    const historicalResult = appendScope(
      cwd,
      historicalTask.task_id,
      ['new.txt'],
    )
    assert.notEqual(historicalResult.status, 0)
    assert.equal(
      JSON.parse(historicalResult.stderr).error.code,
      'writer_version_mismatch',
    )
    assert.deepEqual(storedState(cwd, historicalTask.task_id), before)
  }

  const blockedTask = checkpoint(cwd, 'append blocked refusal')
  const blocked = readTask(cwd, blockedTask.task_id)
  blocked.blocked = {
    reason: '等待输入',
    waiting_for: '用户',
    blocked_at: blocked.updated_at,
  }
  writeTask(cwd, blockedTask.task_id, blocked)
  before = storedState(cwd, blockedTask.task_id)
  const blockedResult = appendScope(cwd, blockedTask.task_id, ['new.txt'])
  assert.notEqual(blockedResult.status, 0)
  assert.equal(JSON.parse(blockedResult.stderr).error.code, 'task_blocked')
  assert.deepEqual(storedState(cwd, blockedTask.task_id), before)
})

test('append-scope human and JSON help expose only the approved arguments', () => {
  const cwd = temporaryDirectory()
  const expected =
    'Usage: latch append-scope <task-id> --expect-revision <revision> --path <repo-relative-path>... [--authorization-file <path|->] [--json]\n'
  const human = run(cwd, ['append-scope', '--help'])
  assert.equal(human.status, 0, human.stderr)
  assert.equal(human.stdout, expected)
  const jsonMode = run(cwd, ['append-scope', '--help', '--json'])
  assert.equal(jsonMode.status, 0, jsonMode.stderr)
  assert.equal(jsonMode.stdout, expected)
  const top = run(cwd, ['--help'])
  assert.equal(top.status, 0, top.stderr)
  assert.match(top.stdout, /append-scope <task-id>/)
  const unknown = run(cwd, [
    'append-scope',
    'task',
    '--expect-revision',
    '1',
    '--path',
    'new.txt',
    '--plan-file',
    'plan.json',
    '--json',
  ])
  assert.notEqual(unknown.status, 0)
  assert.equal(JSON.parse(unknown.stderr).error.code, 'invalid_arguments')
})
