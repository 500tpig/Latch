import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  cleanupTemporaryDirectories,
  run,
  temporaryDirectory,
} from './cli-test-support.mjs'

const owner = 'codex:session:reconcile-owner'
const otherWriter = 'codex:session:reconcile-other'

test.afterEach(cleanupTemporaryDirectories)

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

function taskPath(cwd, id) {
  return join(cwd, '.latch', 'tasks', id, 'task.json')
}

function taskDirectory(cwd, id) {
  return join(cwd, '.latch', 'tasks', id)
}

function readTask(cwd, id) {
  return JSON.parse(readFileSync(taskPath(cwd, id), 'utf8'))
}

function writeTask(cwd, id, task) {
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(task, null, 2)}\n`)
}

function revision(cwd, id) {
  return String(readTask(cwd, id).revision)
}

function storedState(cwd, id) {
  const directory = taskDirectory(cwd, id)
  const eventsPath = join(directory, 'events.jsonl')
  const evidenceDirectory = join(directory, 'evidence')
  const evidence = existsSync(evidenceDirectory)
    ? readdirSync(evidenceDirectory)
        .sort()
        .map((name) => [name, readFileSync(join(evidenceDirectory, name), 'utf8')])
    : []
  return {
    task: readFileSync(taskPath(cwd, id), 'utf8'),
    events: existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8') : '',
    evidence,
  }
}

function createRepo({ tracked = {}, untracked = {} } = {}) {
  const cwd = temporaryDirectory()
  git(cwd, ['init'])
  git(cwd, ['config', 'user.email', 'fixture@example.com'])
  git(cwd, ['config', 'user.name', 'Fixture'])
  writeFileSync(join(cwd, '.gitignore'), '.latch/\nplan.json\n')
  const files = {
    'scope.txt': 'scope\n',
    ...tracked,
  }
  for (const [path, content] of Object.entries(files))
    writeFileSync(join(cwd, path), content)
  git(cwd, ['add', '.gitignore', ...Object.keys(files)])
  git(cwd, ['commit', '-m', 'fixture baseline'])
  for (const [path, content] of Object.entries(untracked))
    writeFileSync(join(cwd, path), content)
  const initialized = run(cwd, ['init'], { actor: owner })
  assert.equal(initialized.status, 0, initialized.stderr)
  return cwd
}

function createTask(cwd, gates, { approve = true } = {}) {
  const plan = {
    goal: '验证独立 workspace violation reconcile',
    workspace_scope: { paths: ['scope.txt'] },
    scope: ['仅修改 scope.txt'],
    acceptance: ['只按原始 before evidence 恢复 violation'],
    approach: ['运行真实 Git workspace fixture'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['verify -> manual restore -> reconcile -> verify-all'],
    out_of_scope: [],
    verification_plan: gates.map(({ name, script }) => ({
      name,
      command: [process.execPath, '-e', script],
      kind: 'gate',
    })),
    open_questions: [],
  }
  writeFileSync(join(cwd, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
  const checkpoint = run(cwd, [
    'checkpoint', 'reconcile fixture', '--plan-file', 'plan.json', '--json',
  ], { actor: owner })
  assert.equal(checkpoint.status, 0, checkpoint.stderr)
  const id = JSON.parse(checkpoint.stdout).task_id
  if (approve) {
    const approved = run(cwd, [
      'approve', id, '--expect-revision', '1',
      '--reason', 'approve reconcile fixture', '--json',
    ], { actor: owner })
    assert.equal(approved.status, 0, approved.stderr)
  }
  return id
}

function verify(cwd, id, name) {
  return run(cwd, [
    'verify', id, '--expect-revision', revision(cwd, id),
    '--name', name, '--json',
  ], { actor: owner })
}

function reconcile(cwd, id, actor = owner, expectedRevision = revision(cwd, id)) {
  return run(cwd, [
    'reconcile', id, '--expect-revision', expectedRevision, '--json',
  ], { actor })
}

test('reconcile restores tracked, untracked, delete, rename, and bounded IDs in one mutation', () => {
  const extras = Object.fromEntries(
    Array.from({ length: 7 }, (_, index) => [`extra-${index}.txt`, `extra ${index}\n`]),
  )
  const cwd = createRepo({
    tracked: {
      'tracked.txt': 'tracked original\n',
      'deleted.txt': 'deleted original\n',
      'renamed.txt': 'renamed original\n',
      ...extras,
    },
    untracked: { 'untracked.txt': 'untracked original\n' },
  })
  const mutateScript = [
    "const fs = require('node:fs')",
    "fs.writeFileSync('tracked.txt', 'tracked changed\\n')",
    "fs.unlinkSync('untracked.txt')",
    "fs.unlinkSync('deleted.txt')",
    "fs.renameSync('renamed.txt', 'renamed-next.txt')",
    ...Object.keys(extras).map(
      (path) => `fs.writeFileSync(${JSON.stringify(path)}, 'changed\\n')`,
    ),
  ].join('; ')
  const id = createTask(cwd, [
    { name: 'clean-first', script: 'process.exit(0)' },
    { name: 'mutate', script: mutateScript },
  ])
  assert.equal(verify(cwd, id, 'clean-first').status, 0)
  const mutated = verify(cwd, id, 'mutate')
  assert.notEqual(mutated.status, 0)
  const before = readTask(cwd, id)
  assert.ok(before.workspace_proof.unresolved_violations.length > 8)
  before.submission = {
    plan_revision: before.plan_revision,
    work_revision: before.work_revision,
    changes: 'stale reconcile fixture submission',
    verified: '',
    unverified_items: [],
    knowledge_impact: { kind: 'none', reason: 'fixture' },
    submitted_at: before.updated_at,
  }
  writeTask(cwd, id, before)

  writeFileSync(join(cwd, 'tracked.txt'), 'tracked original\n')
  writeFileSync(join(cwd, 'untracked.txt'), 'untracked original\n')
  writeFileSync(join(cwd, 'deleted.txt'), 'deleted original\n')
  renameSync(join(cwd, 'renamed-next.txt'), join(cwd, 'renamed.txt'))
  for (const [path, content] of Object.entries(extras))
    writeFileSync(join(cwd, path), content)

  const result = reconcile(cwd, id)
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.resolved_count, before.workspace_proof.unresolved_violations.length)
  assert.equal(output.remaining_count, 0)
  assert.equal(output.resolved_ids.total, output.resolved_count)
  assert.equal(output.resolved_ids.sample_limit, 8)
  assert.equal(output.resolved_ids.sample.length, 8)
  assert.equal(output.resolved_ids.truncated, true)
  assert.deepEqual(output.remaining_ids, {
    total: 0,
    sample_limit: 8,
    sample: [],
    truncated: false,
  })
  assert.equal(output.workspace_proof.generation, before.workspace_proof.generation + 1)
  assert.equal(output.workspace_proof.unresolved_violations, 0)
  assert.deepEqual(output.next_action, {
    kind: 'command',
    command: 'verify-all',
  })

  const after = readTask(cwd, id)
  assert.equal(after.workspace_proof.generation, before.workspace_proof.generation + 1)
  assert.equal(after.workspace_proof.unresolved_violations.length, 0)
  assert.equal(after.submission, undefined)
  assert.notEqual(
    after.verification.gate['clean-first'].proof.ended_generation,
    after.workspace_proof.generation,
  )
  assert.notEqual(
    after.verification.gate.mutate.proof.ended_generation,
    after.workspace_proof.generation,
  )
  const status = run(cwd, ['context', id, '--json', '--status'], { actor: owner })
  assert.equal(status.status, 0, status.stderr)
  const statusTask = JSON.parse(status.stdout).task
  assert.equal(statusTask.gates.stale, 2)
  const statusProof = statusTask.workspace_proof
  statusProof.live_changes.sample_limit =
    output.workspace_proof.live_changes.sample_limit
  assert.deepEqual(output.workspace_proof, statusProof)
})

test('reconcile keeps approximate content, different Git state, and unrestored entries fail closed', () => {
  const cwd = createRepo({
    tracked: {
      'approx.txt': 'approx head\n',
      'state.txt': 'state head\n',
      'unrestored.txt': 'unrestored head\n',
    },
  })
  writeFileSync(join(cwd, 'approx.txt'), 'approx dirty\n')
  writeFileSync(join(cwd, 'state.txt'), 'state dirty\n')
  writeFileSync(join(cwd, 'unrestored.txt'), 'unrestored dirty\n')
  const id = createTask(cwd, [{
    name: 'mutate',
    script: [
      "const fs = require('node:fs')",
      "fs.writeFileSync('approx.txt', 'approx changed\\n')",
      "fs.writeFileSync('state.txt', 'state changed\\n')",
      "fs.writeFileSync('unrestored.txt', 'unrestored changed\\n')",
    ].join('; '),
  }])
  assert.notEqual(verify(cwd, id, 'mutate').status, 0)
  writeFileSync(join(cwd, 'approx.txt'), 'approx dirty \n')
  writeFileSync(join(cwd, 'state.txt'), 'state dirty\n')
  git(cwd, ['add', 'state.txt'])
  const before = storedState(cwd, id)

  const result = reconcile(cwd, id)
  assert.notEqual(result.status, 0)
  const error = JSON.parse(result.stderr)
  assert.equal(error.error.code, 'workspace_violation')
  assert.match(error.error.message, /No unresolved workspace violation matches/)
  assert.deepEqual(storedState(cwd, id), before)
})

test('reconcile resolves only exact items and no-op leaves task, event, and evidence unchanged', () => {
  const cwd = createRepo({
    tracked: { 'first.txt': 'first\n', 'second.txt': 'second\n' },
  })
  const id = createTask(cwd, [{
    name: 'mutate',
    script: [
      "const fs = require('node:fs')",
      "fs.writeFileSync('first.txt', 'first changed\\n')",
      "fs.writeFileSync('second.txt', 'second changed\\n')",
    ].join('; '),
  }])
  assert.notEqual(verify(cwd, id, 'mutate').status, 0)
  writeFileSync(join(cwd, 'first.txt'), 'first\n')

  const partial = reconcile(cwd, id)
  assert.equal(partial.status, 0, partial.stderr)
  const output = JSON.parse(partial.stdout)
  assert.equal(output.resolved_count, 1)
  assert.equal(output.remaining_count, 1)
  assert.equal(output.resolved_ids.truncated, false)
  assert.equal(output.remaining_ids.sample.length, 1)

  const beforeNoop = storedState(cwd, id)
  const noop = reconcile(cwd, id)
  assert.notEqual(noop.status, 0)
  assert.equal(JSON.parse(noop.stderr).error.code, 'workspace_violation')
  assert.deepEqual(storedState(cwd, id), beforeNoop)
})

test('reconcile without workspace proof is a no-op rejection', () => {
  const cwd = createRepo()
  const id = createTask(cwd, [{ name: 'clean', script: 'process.exit(0)' }])
  const before = storedState(cwd, id)
  const result = reconcile(cwd, id)
  assert.notEqual(result.status, 0)
  assert.equal(JSON.parse(result.stderr).error.code, 'workspace_violation')
  assert.deepEqual(storedState(cwd, id), before)
})

test('reconcile capture failure leaves task, event, and evidence unchanged', () => {
  const cwd = createRepo({ tracked: { 'outside.txt': 'outside\n' } })
  const id = createTask(cwd, [{
    name: 'mutate',
    script: "require('node:fs').writeFileSync('outside.txt', 'changed\\n')",
  }])
  assert.notEqual(verify(cwd, id, 'mutate').status, 0)
  writeFileSync(join(cwd, 'outside.txt'), 'outside\n')
  const before = storedState(cwd, id)
  renameSync(join(cwd, '.git'), join(cwd, '.git-disabled'))

  const result = reconcile(cwd, id)
  assert.notEqual(result.status, 0)
  assert.match(JSON.parse(result.stderr).error.message, /workspace evidence error/i)
  assert.deepEqual(storedState(cwd, id), before)
})

test('reconcile rejects phase, revision, writer, and historical schema without partial writes', () => {
  const phaseCwd = createRepo()
  const phaseId = createTask(phaseCwd, [{ name: 'clean', script: 'process.exit(0)' }], {
    approve: false,
  })
  let before = storedState(phaseCwd, phaseId)
  const phase = reconcile(phaseCwd, phaseId)
  assert.notEqual(phase.status, 0)
  assert.equal(JSON.parse(phase.stderr).error.code, 'phase_mismatch')
  assert.deepEqual(storedState(phaseCwd, phaseId), before)

  const cwd = createRepo({ tracked: { 'outside.txt': 'outside\n' } })
  const id = createTask(cwd, [{
    name: 'mutate',
    script: "require('node:fs').writeFileSync('outside.txt', 'changed\\n')",
  }])
  assert.notEqual(verify(cwd, id, 'mutate').status, 0)
  writeFileSync(join(cwd, 'outside.txt'), 'outside\n')

  before = storedState(cwd, id)
  const conflict = reconcile(cwd, id, owner, String(Number(revision(cwd, id)) - 1))
  assert.notEqual(conflict.status, 0)
  assert.match(JSON.parse(conflict.stderr).error.message, /Task changed/)
  assert.deepEqual(storedState(cwd, id), before)

  const mismatch = reconcile(cwd, id, otherWriter)
  assert.notEqual(mismatch.status, 0)
  assert.match(JSON.parse(mismatch.stderr).error.message, /Writer mismatch/)
  assert.deepEqual(storedState(cwd, id), before)

  const review = readTask(cwd, id)
  review.phase = 'review'
  writeTask(cwd, id, review)
  before = storedState(cwd, id)
  const reviewPhase = reconcile(cwd, id)
  assert.notEqual(reviewPhase.status, 0)
  assert.equal(JSON.parse(reviewPhase.stderr).error.code, 'phase_mismatch')
  assert.deepEqual(storedState(cwd, id), before)

  const historical = readTask(cwd, id)
  historical.schema_version = 4
  historical.min_writer_version = '0.4.0'
  writeTask(cwd, id, historical)
  before = storedState(cwd, id)
  const schema = reconcile(cwd, id)
  assert.notEqual(schema.status, 0)
  assert.equal(JSON.parse(schema.stderr).error.code, 'writer_version_mismatch')
  assert.deepEqual(storedState(cwd, id), before)
})

test('reconcile rejects caller-selected paths and ignore flags before task mutation', () => {
  const cwd = createRepo({ tracked: { 'outside.txt': 'outside\n' } })
  const id = createTask(cwd, [{
    name: 'mutate',
    script: "require('node:fs').writeFileSync('outside.txt', 'changed\\n')",
  }])
  assert.notEqual(verify(cwd, id, 'mutate').status, 0)
  writeFileSync(join(cwd, 'outside.txt'), 'outside\n')
  const before = storedState(cwd, id)

  const invocations = [
    ['reconcile', id, 'outside.txt', '--expect-revision', revision(cwd, id), '--json'],
    ['reconcile', id, '--ignore', 'outside.txt', '--expect-revision', revision(cwd, id), '--json'],
    ['reconcile', id, '--json'],
  ]
  for (const invocation of invocations) {
    const result = run(cwd, invocation, { actor: owner })
    assert.notEqual(result.status, 0)
    assert.equal(JSON.parse(result.stderr).error.code, 'invalid_arguments')
    assert.deepEqual(storedState(cwd, id), before)
  }
})

test('reconcile does not treat current scope expansion as restoration', () => {
  const cwd = createRepo({ tracked: { 'outside.txt': 'outside\n' } })
  const id = createTask(cwd, [{
    name: 'mutate',
    script: "require('node:fs').writeFileSync('outside.txt', 'changed\\n')",
  }])
  assert.notEqual(verify(cwd, id, 'mutate').status, 0)

  const expanded = readTask(cwd, id).plan
  expanded.workspace_scope = { paths: ['scope.txt', 'outside.txt'] }
  writeFileSync(join(cwd, 'expanded-plan.json'), `${JSON.stringify(expanded, null, 2)}\n`)
  const saved = run(cwd, [
    'save', id, '--expect-revision', revision(cwd, id),
    '--plan-file', 'expanded-plan.json', '--json',
  ], { actor: owner })
  assert.equal(saved.status, 0, saved.stderr)
  const approved = run(cwd, [
    'approve', id, '--expect-revision', revision(cwd, id),
    '--reason', 'approve expanded fixture scope', '--json',
  ], { actor: owner })
  assert.equal(approved.status, 0, approved.stderr)
  const before = storedState(cwd, id)

  const result = reconcile(cwd, id)
  assert.notEqual(result.status, 0)
  assert.equal(JSON.parse(result.stderr).error.code, 'workspace_violation')
  assert.deepEqual(storedState(cwd, id), before)
})

test('reconcile human output reports counts without running a gate', () => {
  const cwd = createRepo({ tracked: { 'outside.txt': 'outside\n' } })
  const id = createTask(cwd, [{
    name: 'mutate',
    script: "require('node:fs').writeFileSync('outside.txt', 'changed\\n')",
  }])
  assert.notEqual(verify(cwd, id, 'mutate').status, 0)
  writeFileSync(join(cwd, 'outside.txt'), 'outside\n')
  const gateCreatedAt = readTask(cwd, id).verification.gate.mutate.created_at

  const result = run(cwd, [
    'reconcile', id, '--expect-revision', revision(cwd, id),
  ], { actor: owner })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /1 restored, 0 remaining/)
  assert.match(result.stdout, /Resolved IDs:/)
  assert.equal(readTask(cwd, id).verification.gate.mutate.created_at, gateCreatedAt)
})
