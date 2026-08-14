import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const cli = join(process.cwd(), 'dist/cli.js')
const temporaryDirectories = []

function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'latch-happy-path-'))
  temporaryDirectories.push(cwd)
  const git = spawnSync('git', ['init'], { cwd, encoding: 'utf8' })
  assert.equal(git.status, 0, git.stderr)
  const initialized = spawnSync(process.execPath, [cli, 'init'], {
    cwd,
    encoding: 'utf8',
  })
  assert.equal(initialized.status, 0, initialized.stderr)
  return cwd
}

function plan(profile) {
  const common = {
    goal: `${profile} happy path`,
    workspace_scope: { paths: ['work.txt'] },
    scope: ['Keep the scenario inside work.txt'],
    acceptance: ['The no-op verification command passes'],
    approach: ['Exercise only the documented happy-path primitives'],
    verification_plan: [
      {
        name: 'scenario',
        command: [process.execPath, '-e', 'process.exit(0)'],
        kind: 'gate',
      },
    ],
  }
  if (profile === 'light') return common
  return {
    ...common,
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['checkpoint -> approve -> verify-all -> submit -> done'],
    out_of_scope: ['Recovery and diagnostics'],
    open_questions: [],
  }
}

function writePlan(cwd, profile) {
  const path = join(cwd, '.latch', `${profile}-plan.json`)
  writeFileSync(path, `${JSON.stringify(plan(profile), null, 2)}\n`)
  return path
}

function scenario(cwd) {
  const calls = []
  return {
    calls,
    run(label, args) {
      calls.push(label)
      const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, LATCH_ACTOR: 'codex:session:happy-path' },
      })
      assert.equal(result.status, 0, result.stderr)
      return JSON.parse(result.stdout)
    },
  }
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('Light happy path stays within seven CLI calls and two required user turns', () => {
  const cwd = workspace()
  const flow = scenario(cwd)
  let userTurns = 1

  flow.run('list', ['list', '--brief'])
  let output = flow.run('checkpoint', [
    'checkpoint',
    'Light happy path',
    '--plan-file',
    writePlan(cwd, 'light'),
    '--profile',
    'light',
    '--authorize-request',
    'User requested this fixed low-risk scenario',
  ])
  const taskId = output.task_id
  assert.deepEqual(output.next_action, { kind: 'command', command: 'verify-all' })

  output = flow.run('verify-all', [
    'verify-all', taskId, '--expect-revision', String(output.revision),
  ])
  assert.deepEqual(output.next_action, { kind: 'command', command: 'submit' })

  output = flow.run('submit', [
    'submit', taskId, '--expect-revision', String(output.revision),
    '--changes', 'Exercised the Light happy path',
    '--knowledge-impact-none', 'Scenario creates no project knowledge',
  ])
  assert.deepEqual(output.next_action, {
    kind: 'await_user',
    boundary: 'review',
    reason: 'review_decision',
  })
  userTurns += 1

  flow.run('review', ['context', taskId, '--review'])
  output = flow.run('done', [
    'done', taskId, '--expect-revision', String(output.revision),
  ])
  assert.equal(output.outcome, 'done')

  assert.deepEqual(flow.calls, [
    'list', 'checkpoint', 'verify-all', 'submit', 'review', 'done',
  ])
  assert.ok(flow.calls.length <= 7)
  assert.equal(userTurns, 2)
})

test('Standard happy path stays within nine CLI calls and three required user turns', () => {
  const cwd = workspace()
  const flow = scenario(cwd)
  let userTurns = 1

  flow.run('list', ['list', '--brief'])
  let output = flow.run('checkpoint', [
    'checkpoint',
    'Standard happy path',
    '--plan-file',
    writePlan(cwd, 'standard'),
  ])
  const taskId = output.task_id
  assert.deepEqual(output.next_action, {
    kind: 'await_user',
    boundary: 'approval',
    reason: 'implementation_plan',
  })
  userTurns += 1

  flow.run('plan brief', ['context', taskId, '--brief'])
  output = flow.run('approve', [
    'approve', taskId, '--expect-revision', String(output.revision),
    '--reason', 'User approved the current plan',
  ])
  assert.deepEqual(output.next_action, { kind: 'command', command: 'verify-all' })

  output = flow.run('verify-all', [
    'verify-all', taskId, '--expect-revision', String(output.revision),
  ])
  assert.deepEqual(output.next_action, { kind: 'command', command: 'submit' })

  output = flow.run('submit', [
    'submit', taskId, '--expect-revision', String(output.revision),
    '--changes', 'Exercised the Standard happy path',
    '--knowledge-impact-none', 'Scenario creates no project knowledge',
  ])
  assert.deepEqual(output.next_action, {
    kind: 'await_user',
    boundary: 'review',
    reason: 'review_decision',
  })
  userTurns += 1

  flow.run('review', ['context', taskId, '--review'])
  output = flow.run('done', [
    'done', taskId, '--expect-revision', String(output.revision),
  ])
  assert.equal(output.outcome, 'done')

  assert.deepEqual(flow.calls, [
    'list', 'checkpoint', 'plan brief', 'approve',
    'verify-all', 'submit', 'review', 'done',
  ])
  assert.ok(flow.calls.length <= 9)
  assert.equal(userTurns, 3)
})
