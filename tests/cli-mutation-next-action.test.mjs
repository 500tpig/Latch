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

test.afterEach(cleanupTemporaryDirectories)

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

function mutation(cwd, args, actor = owner) {
  const result = run(cwd, [...args, '--json'], { actor })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(typeof output.next_action, 'string')

  const status = run(
    cwd,
    ['context', output.task_id, '--json', '--status'],
    { actor },
  )
  assert.equal(status.status, 0, status.stderr)
  assert.equal(
    output.next_action,
    JSON.parse(status.stdout).task.next_action,
  )
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
  assert.equal(output.next_action, 'approve')

  output = mutation(cwd, [
    'takeover', taskId, '--expect-revision', String(output.revision),
    '--reason', 'transfer fixture writer',
  ], nextWriter)
  assert.equal(output.next_action, 'approve')

  output = mutation(cwd, [
    'save', taskId, '--expect-revision', String(output.revision),
    '--decision', 'keep one shared next_action derivation',
  ], nextWriter)
  assert.equal(output.next_action, 'approve')

  output = mutation(cwd, [
    'artifact', 'add', taskId,
    '--expect-revision', String(output.revision),
    'doc:docs/mutation-next-action.md',
  ], nextWriter)
  assert.equal(output.next_action, 'approve')

  output = mutation(cwd, [
    'approve', taskId, '--expect-revision', String(output.revision),
    '--reason', 'approve fixture plan',
  ], nextWriter)
  assert.equal(output.next_action, 'verify')

  output = mutation(cwd, [
    'verify', taskId, '--expect-revision', String(output.revision),
    '--name', 'first',
  ], nextWriter)
  assert.equal(output.next_action, 'verify')

  output = mutation(cwd, [
    'verify-all', taskId, '--expect-revision', String(output.revision),
  ], nextWriter)
  assert.equal(output.next_action, 'submit')

  output = mutation(cwd, [
    'submit', taskId, '--expect-revision', String(output.revision),
    '--changes', 'covered mutation response next actions',
    '--knowledge-impact-none', 'fixture does not change project knowledge',
  ], nextWriter)
  assert.equal(output.next_action, 'review_or_archive')

  writeFileSync(join(cwd, 'work.txt'), 'changed after submission\n')
  output = mutation(cwd, [
    'takeover', taskId, '--expect-revision', String(output.revision),
    '--reason', 'transfer stale review recovery',
  ], recoveryWriter)
  assert.equal(output.next_action, 'reopen_review')

  output = mutation(cwd, [
    'reopen-review', taskId, '--expect-revision', String(output.revision),
    '--reason', 'submission proof is stale after a scoped change',
  ], recoveryWriter)
  assert.equal(output.next_action, 'verify')

  output = mutation(cwd, [
    'verify-all', taskId, '--expect-revision', String(output.revision),
  ], recoveryWriter)
  assert.equal(output.next_action, 'submit')

  output = mutation(cwd, [
    'submit', taskId, '--expect-revision', String(output.revision),
    '--changes', 'reverified mutation response next actions',
    '--knowledge-impact-none', 'fixture has no durable knowledge impact',
  ], recoveryWriter)
  assert.equal(output.next_action, 'review_or_archive')

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
  assert.equal(output.next_action, 'review_or_archive')

  output = mutation(cwd, [
    'done', taskId, '--expect-revision', String(output.revision),
  ], recoveryWriter)
  assert.equal(output.next_action, 'read_only')
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
  assert.equal(output.next_action, 'resolve_open_questions')

  const resolvedPlan = writePlan(cwd, plan({
    verification_plan: [],
    open_questions: [],
  }), 'resolved-plan.json')
  output = mutation(cwd, [
    'save', taskId, '--expect-revision', String(output.revision),
    '--plan-file', resolvedPlan,
  ])
  assert.equal(output.next_action, 'approve')

  output = mutation(cwd, [
    'abandon', taskId, '--expect-revision', String(output.revision),
    '--reason', 'finish archive response fixture',
  ])
  assert.equal(output.next_action, 'read_only')

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
  assert.equal(output.next_action, 'submit')
  output = mutation(cwd, [
    'submit', closeoutTaskId, '--expect-revision', String(output.revision),
    '--changes', 'exercise unverified closeout action',
    '--unverified-item', 'manual observation remains',
    '--knowledge-impact-none', 'fixture has no durable knowledge impact',
    '--no-verify', '--reason', 'fixture plan has no gates',
  ])
  assert.equal(output.next_action, 'prepare_closeout')
})
