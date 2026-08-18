import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  cleanupTemporaryDirectories,
  init,
  plan,
  readTask,
  run,
  temporaryDirectory,
  writePlan,
} from './cli-test-support.mjs'

const fixture = JSON.parse(
  readFileSync('tests/fixtures/envelope-v3-mismatch.json', 'utf8'),
)
const owner = 'codex:session:test-session'
const otherWriter = 'codex:session:envelope-other'

test.afterEach(cleanupTemporaryDirectories)

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

function preparedDirectory() {
  const cwd = temporaryDirectory()
  git(cwd, ['init'])
  writeFileSync(join(cwd, '.gitignore'), '.latch/\nplan.json\nimpact.json\n*.json\n')
  writeFileSync(join(cwd, 'work.txt'), 'initial\n')
  git(cwd, ['add', '.gitignore', 'work.txt'])
  git(cwd, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', 'init'])
  init(cwd)
  return cwd
}

function json(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

function errorEnvelope(result) {
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  return JSON.parse(result.stderr)
}

function checkpointTask(cwd, title, overrides = {}) {
  const planFile = writePlan(cwd, plan({
    workspace_scope: { paths: ['work.txt'] },
    scope: ['work.txt'],
    ...overrides,
  }))
  return json(run(cwd, [
    'checkpoint',
    title,
    '--plan-file',
    planFile,
    '--json',
  ], { actor: owner }))
}

function approve(cwd, taskId, revision = 1) {
  return json(run(cwd, [
    'approve',
    taskId,
    '--expect-revision',
    String(revision),
    '--reason',
    'approved for envelope fixture',
    '--json',
  ], { actor: owner }))
}

function writeImpact(cwd) {
  writeFileSync(
    join(cwd, 'impact.json'),
    `${JSON.stringify({
      kind: 'none',
      reason: 'Envelope fixture does not change module contracts.',
    }, null, 2)}\n`,
  )
}

test('producer-side writer mismatch is schema 3 and routes only to typed takeover approval', () => {
  const cwd = preparedDirectory()
  const created = checkpointTask(cwd, 'envelope 3 mismatch fixture')
  const before = readTask(cwd, created.task_id)

  const envelope = errorEnvelope(run(cwd, [
    'approve',
    created.task_id,
    '--expect-revision',
    '1',
    '--reason',
    'wrong writer fixture',
    '--json',
  ], { actor: otherWriter }))
  assert.equal(envelope.schema_version, fixture.envelope_schema_version)
  assert.equal(envelope.error.code, fixture.writer_mismatch.error_code)
  assert.equal(envelope.error.category, undefined)
  assert.equal(envelope.error.issues, undefined)
  assert.deepEqual(envelope.next_action, fixture.writer_mismatch.next_action)
  assert.deepEqual(readTask(cwd, created.task_id), before)
})

test('phase-mismatch producer output is schema 3 and keeps the plan approval boundary', () => {
  const cwd = preparedDirectory()
  const created = checkpointTask(cwd, 'envelope 3 phase fixture')

  const envelope = errorEnvelope(run(cwd, [
    'verify-all',
    created.task_id,
    '--expect-revision',
    '1',
    '--json',
  ], { actor: owner }))
  assert.equal(envelope.schema_version, fixture.envelope_schema_version)
  assert.equal(envelope.error.code, fixture.phase_mismatch.error_code)
  assert.equal(envelope.error.category, undefined)
  assert.equal(envelope.error.issues, undefined)
  assert.deepEqual(envelope.next_action, fixture.phase_mismatch.next_action)
})

test('recommended command next_actions stay phase-legal for the same task state', () => {
  const cwd = preparedDirectory()
  writeImpact(cwd)

  // verify-all when recommended after approve with pending gates
  const gated = checkpointTask(cwd, 'phase legal verify-all', {
    verification_plan: [
      {
        name: 'ok',
        command: [process.execPath, '-e', 'process.exit(0)'],
        kind: 'gate',
      },
    ],
  })
  const afterApprove = approve(cwd, gated.task_id)
  assert.deepEqual(afterApprove.next_action, fixture.phase_legal_commands.verify_all)
  const verify = json(run(cwd, [
    'verify-all',
    gated.task_id,
    '--expect-revision',
    String(afterApprove.revision),
    '--json',
  ], { actor: owner }))
  assert.deepEqual(verify.next_action, fixture.phase_legal_commands.submit)

  // submit when recommended after all gates pass
  const submitted = json(run(cwd, [
    'submit',
    gated.task_id,
    '--expect-revision',
    String(verify.revision),
    '--changes',
    'gate passed',
    '--unverified-item',
    'manual check remaining',
    '--knowledge-impact-file',
    'impact.json',
    '--json',
  ], { actor: owner }))
  assert.equal(submitted.phase, 'review')

  // no-verify submit when recommended for gate-free standard plan
  const noGate = checkpointTask(cwd, 'phase legal no-verify', {
    verification_plan: [],
  })
  const noGateApproved = approve(cwd, noGate.task_id)
  assert.deepEqual(
    noGateApproved.next_action,
    fixture.phase_legal_commands.submit_no_verify,
  )
  const noVerify = json(run(cwd, [
    'submit',
    noGate.task_id,
    '--expect-revision',
    String(noGateApproved.revision),
    '--no-verify',
    '--reason',
    'documentation only',
    '--changes',
    'docs only',
    '--unverified-item',
    'no runtime check',
    '--knowledge-impact-file',
    'impact.json',
    '--json',
  ], { actor: owner }))
  assert.equal(noVerify.phase, 'review')

  // reopen-review when recommended for stale review proof
  const staleTask = readTask(cwd, gated.task_id)
  staleTask.work_revision += 1
  writeFileSync(
    join(cwd, '.latch', 'tasks', gated.task_id, 'task.json'),
    `${JSON.stringify(staleTask, null, 2)}\n`,
  )
  const staleStatus = json(run(cwd, [
    'context',
    gated.task_id,
    '--json',
    '--status',
  ], { actor: owner }))
  assert.deepEqual(
    staleStatus.task.next_action,
    fixture.phase_legal_commands.reopen_review,
  )
  const reopened = json(run(cwd, [
    'reopen-review',
    gated.task_id,
    '--expect-revision',
    String(staleTask.revision),
    '--reason',
    'proof became stale in fixture',
    '--json',
  ], { actor: owner }))
  assert.equal(reopened.phase, 'dev')
})

test('stale submission closeout uses proof_stale domain code under envelope 3', () => {
  const cwd = preparedDirectory()
  writeImpact(cwd)
  const created = checkpointTask(cwd, 'proof stale fixture', {
    verification_plan: [],
  })
  const approved = approve(cwd, created.task_id)
  const submitted = json(run(cwd, [
    'submit',
    created.task_id,
    '--expect-revision',
    String(approved.revision),
    '--no-verify',
    '--reason',
    'docs only',
    '--changes',
    'docs',
    '--unverified-item',
    'pending manual',
    '--knowledge-impact-file',
    'impact.json',
    '--json',
  ], { actor: owner }))

  const task = readTask(cwd, created.task_id)
  task.work_revision += 1
  writeFileSync(
    join(cwd, '.latch', 'tasks', created.task_id, 'task.json'),
    `${JSON.stringify(task, null, 2)}\n`,
  )

  const envelope = errorEnvelope(run(cwd, [
    'done',
    created.task_id,
    '--expect-revision',
    String(submitted.revision),
    '--closeout-file',
    '-',
    '--json',
  ], {
    actor: owner,
    input: JSON.stringify({
      resolutions: [
        {
          item_id: 'U1',
          outcome: 'resolved',
          resolution: 'fixture resolution',
        },
      ],
    }),
  }))
  assert.equal(envelope.schema_version, fixture.envelope_schema_version)
  assert.equal(envelope.error.code, fixture.proof_stale.error_code)
  assert.equal(envelope.error.category, undefined)
  assert.equal(envelope.error.issues, undefined)
  assert.equal(envelope.next_action.kind, 'command')
  assert.equal(envelope.next_action.command, 'reopen-review')
})
