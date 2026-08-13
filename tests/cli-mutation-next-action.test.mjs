import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  cleanupTemporaryDirectories,
  init,
  plan,
  run,
  temporaryDirectory,
  writePlan,
} from './cli-test-support.mjs'

const owner = 'codex:session:mutation-owner'
const nextWriter = 'codex:session:mutation-next-writer'
const recoveryWriter = 'codex:session:mutation-recovery-writer'

const command = (name, mode) => ({
  kind: 'command',
  command: name,
  ...(mode ? { mode } : {}),
})
const awaitUser = (boundary, reason) => ({
  kind: 'await_user',
  boundary,
  reason,
})
const stop = (reason) => ({ kind: 'stop', reason })

test.afterEach(cleanupTemporaryDirectories)

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

function mutation(cwd, args, actor = owner) {
  const result = run(cwd, [...args, '--json'], { actor })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(typeof output.next_action, 'object')

  const status = run(
    cwd,
    ['context', output.task_id, '--json', '--status'],
    { actor },
  )
  assert.equal(status.status, 0, status.stderr)
  const statusTask = JSON.parse(status.stdout).task
  assert.deepEqual(
    output.next_action,
    statusTask.next_action,
  )
  const statusProof = structuredClone(statusTask.workspace_proof)
  if (statusProof?.live_changes && output.workspace_proof?.live_changes)
    statusProof.live_changes.sample_limit =
      output.workspace_proof.live_changes.sample_limit
  assert.deepEqual(output.workspace_proof, statusProof)
  return output
}

test('task mutation JSON derives next_action from the post-mutation lifecycle state', () => {
  const cwd = temporaryDirectory()
  git(cwd, ['init'])
  writeFileSync(join(cwd, '.gitignore'), '.latch/\nplan.json\nimpact.json\n')
  writeFileSync(join(cwd, 'work.txt'), 'initial\n')
  git(cwd, ['add', '.gitignore', 'work.txt'])
  init(cwd)

  const planFile = writePlan(cwd, plan({
    workspace_scope: { paths: ['work.txt'] },
    verification_plan: [
      {
        name: 'first',
        command: [process.execPath, '-e', 'process.exit(0)'],
        kind: 'gate',
      },
      {
        name: 'second',
        command: [process.execPath, '-e', 'process.exit(0)'],
        kind: 'gate',
      },
    ],
  }))
  let output = mutation(cwd, [
    'checkpoint', 'Mutation next action', '--plan-file', planFile,
  ])
  const taskId = output.task_id
  assert.deepEqual(output.next_action, awaitUser('approval', 'implementation_plan'))
  assert.equal('workspace_proof' in output, false)

  output = mutation(cwd, [
    'takeover', taskId, '--expect-revision', String(output.revision),
    '--reason', 'transfer fixture writer',
  ], nextWriter)
  assert.deepEqual(output.next_action, awaitUser('approval', 'implementation_plan'))

  output = mutation(cwd, [
    'save', taskId, '--expect-revision', String(output.revision),
    '--decision', 'keep one shared next_action derivation',
  ], nextWriter)
  assert.deepEqual(output.next_action, awaitUser('approval', 'implementation_plan'))

  output = mutation(cwd, [
    'artifact', 'add', taskId,
    '--expect-revision', String(output.revision),
    'doc:docs/mutation-next-action.md',
  ], nextWriter)
  assert.deepEqual(output.next_action, awaitUser('approval', 'implementation_plan'))

  output = mutation(cwd, [
    'approve', taskId, '--expect-revision', String(output.revision),
    '--reason', 'approve fixture plan',
  ], nextWriter)
  assert.deepEqual(output.next_action, command('verify-all'))
  assert.equal('workspace_proof' in output, false)

  output = mutation(cwd, [
    'verify', taskId, '--expect-revision', String(output.revision),
    '--name', 'first',
  ], nextWriter)
  assert.deepEqual(output.next_action, command('verify-all'))
  assert.equal(output.workspace_proof.generation, 1)

  output = mutation(cwd, [
    'verify-all', taskId, '--expect-revision', String(output.revision),
  ], nextWriter)
  assert.deepEqual(output.next_action, command('submit'))

  output = mutation(cwd, [
    'submit', taskId, '--expect-revision', String(output.revision),
    '--changes', 'covered mutation response next actions',
    '--knowledge-impact-none', 'fixture does not change project knowledge',
  ], nextWriter)
  assert.deepEqual(output.next_action, awaitUser('review', 'review_decision'))

  writeFileSync(join(cwd, 'work.txt'), 'changed after submission\n')
  output = mutation(cwd, [
    'takeover', taskId, '--expect-revision', String(output.revision),
    '--reason', 'transfer stale review recovery',
  ], recoveryWriter)
  assert.deepEqual(output.next_action, command('reopen-review'))

  output = mutation(cwd, [
    'reopen-review', taskId, '--expect-revision', String(output.revision),
    '--reason', 'submission proof is stale after a scoped change',
  ], recoveryWriter)
  assert.deepEqual(output.next_action, command('verify-all'))

  output = mutation(cwd, [
    'verify-all', taskId, '--expect-revision', String(output.revision),
  ], recoveryWriter)
  assert.deepEqual(output.next_action, command('submit'))

  output = mutation(cwd, [
    'submit', taskId, '--expect-revision', String(output.revision),
    '--changes', 'reverified mutation response next actions',
    '--knowledge-impact-none', 'fixture has no durable knowledge impact',
  ], recoveryWriter)
  assert.deepEqual(output.next_action, awaitUser('review', 'review_decision'))

  writeFileSync(join(cwd, 'impact.json'), `${JSON.stringify({
    kind: 'none',
    reason: 'corrected fixture knowledge impact',
  })}\n`)
  output = mutation(cwd, [
    'patch-submission-knowledge-impact', taskId,
    '--expect-revision', String(output.revision),
    '--knowledge-impact-file', 'impact.json',
    '--reason', 'correct the fixture knowledge impact',
  ], recoveryWriter)
  assert.deepEqual(output.next_action, awaitUser('review', 'review_decision'))

  output = mutation(cwd, [
    'done', taskId, '--expect-revision', String(output.revision),
  ], recoveryWriter)
  assert.deepEqual(output.next_action, stop('archived_read_only'))
})

test('checkpoint, plan save, and abandon expose plan and archive next actions', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const unresolvedPlan = writePlan(cwd, plan({
    verification_plan: [],
    open_questions: ['confirm the fixture decision'],
  }))
  let output = mutation(cwd, [
    'checkpoint', 'Plan next action', '--plan-file', unresolvedPlan,
  ])
  const taskId = output.task_id
  assert.deepEqual(output.next_action, awaitUser('plan_input', 'open_questions'))

  const resolvedPlan = writePlan(cwd, plan({
    verification_plan: [],
    open_questions: [],
  }), 'resolved-plan.json')
  output = mutation(cwd, [
    'save', taskId, '--expect-revision', String(output.revision),
    '--plan-file', resolvedPlan,
  ])
  assert.deepEqual(output.next_action, awaitUser('approval', 'implementation_plan'))

  output = mutation(cwd, [
    'abandon', taskId, '--expect-revision', String(output.revision),
    '--reason', 'finish archive response fixture',
  ])
  assert.deepEqual(output.next_action, stop('archived_read_only'))

  const closeoutPlan = writePlan(cwd, plan({
    verification_plan: [],
  }), 'closeout-plan.json')
  output = mutation(cwd, [
    'checkpoint', 'Closeout next action', '--plan-file', closeoutPlan,
  ])
  const closeoutTaskId = output.task_id
  output = mutation(cwd, [
    'approve', closeoutTaskId, '--expect-revision', String(output.revision),
    '--reason', 'approve closeout fixture',
  ])
  assert.deepEqual(output.next_action, command('submit', 'no_verify'))
  output = mutation(cwd, [
    'submit', closeoutTaskId, '--expect-revision', String(output.revision),
    '--changes', 'exercise unverified closeout action',
    '--unverified-item', 'manual observation remains',
    '--knowledge-impact-none', 'fixture has no durable knowledge impact',
    '--no-verify', '--reason', 'fixture plan has no gates',
  ])
  assert.deepEqual(output.next_action, awaitUser('closeout', 'unverified_items'))
})
