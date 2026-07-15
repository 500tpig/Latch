import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const cli = join(process.cwd(), 'dist/cli.js')
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-v2-lifecycle-'))
  temporaryDirectories.push(directory)
  return directory
}

function run(cwd, args, actor = 'codex:session:lifecycle') {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LATCH_ACTOR: actor },
  })
}

function runAsync(cwd, args, actor) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env: { ...process.env, LATCH_ACTOR: actor },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

function plan(overrides = {}) {
  return {
    goal: '实现 Slice 3',
    scope: ['src/core/progress.ts'],
    acceptance: ['lifecycle tests pass'],
    approach: ['使用 per-task 短锁'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['plan -> dev -> review'],
    out_of_scope: ['verify', 'submit', 'done', 'abandon'],
    verification_plan: [
      { name: 'lifecycle', command: ['node', '--test'], kind: 'gate' },
    ],
    open_questions: [],
    ...overrides,
  }
}

function writePlan(cwd, value, name = `plan-${Math.random()}.json`) {
  writeFileSync(join(cwd, name), `${JSON.stringify(value, null, 2)}\n`)
  return name
}

function init(cwd) {
  const result = run(cwd, ['init'])
  assert.equal(result.status, 0, result.stderr)
}

function checkpoint(cwd, title, overrides = {}) {
  const result = run(cwd, [
    'checkpoint',
    title,
    '--plan-file',
    writePlan(cwd, plan(overrides)),
    '--json',
  ])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function taskPath(cwd, id) {
  return join(cwd, '.latch', 'tasks', id, 'task.json')
}

function eventsPath(cwd, id) {
  return join(cwd, '.latch', 'tasks', id, 'events.jsonl')
}

function readTask(cwd, id) {
  return JSON.parse(readFileSync(taskPath(cwd, id), 'utf8'))
}

function writeTask(cwd, id, update) {
  const task = readTask(cwd, id)
  update(task)
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(task, null, 2)}\n`)
}

function approve(cwd, created, extra = ['--reason', '用户批准']) {
  return run(cwd, [
    'approve',
    created.task_id,
    '--expect-revision',
    String(readTask(cwd, created.task_id).revision),
    ...extra,
    '--json',
  ])
}

function eventEntries(cwd, id) {
  return readFileSync(eventsPath(cwd, id), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse)
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('plan requires direct approval before dev and approval binds plan revision', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, 'approval')
  assert.equal(readTask(cwd, created.task_id).phase, 'plan')

  const result = approve(cwd, created)
  assert.equal(result.status, 0, result.stderr)
  const task = readTask(cwd, created.task_id)
  assert.equal(task.phase, 'dev')
  assert.equal(task.work_revision, 1)
  assert.equal(task.implementation_approval.approved_plan_revision, 1)
  assert.equal(task.implementation_approval.source, 'user')
})

test('approve rejects open questions without persistence side effects', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, 'questions', { open_questions: ['是否实现？'] })
  const beforeTask = readFileSync(taskPath(cwd, created.task_id), 'utf8')
  const beforeEvents = readFileSync(eventsPath(cwd, created.task_id), 'utf8')

  const result = approve(cwd, created)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /open_questions/)
  assert.equal(readFileSync(taskPath(cwd, created.task_id), 'utf8'), beforeTask)
  assert.equal(readFileSync(eventsPath(cwd, created.task_id), 'utf8'), beforeEvents)
})

test('any persisted plan change invalidates approval, gates, and submission', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, 'plan change')
  assert.equal(approve(cwd, created).status, 0)
  writeTask(cwd, created.task_id, (task) => {
    task.phase = 'review'
    task.verification.gate.lifecycle = {
      name: 'lifecycle', kind: 'gate', command: ['node', '--test'], status: 'pass',
      exit_code: 0, work_revision: 1, created_at: new Date().toISOString(),
    }
    task.submission = {
      work_revision: 1, changes: 'done', verified: 'pass', unverified: '',
      submitted_at: new Date().toISOString(),
    }
  })
  const next = plan({ scope: ['src/cli.ts'] })
  const result = run(cwd, [
    'save', created.task_id, '--expect-revision', '2',
    '--plan-file', writePlan(cwd, next), '--feedback', '范围需要调整', '--json',
  ])
  assert.equal(result.status, 0, result.stderr)
  const task = readTask(cwd, created.task_id)
  assert.equal(task.phase, 'plan')
  assert.equal(task.plan_revision, 2)
  assert.equal('implementation_approval' in task, false)
  assert.deepEqual(task.verification, { gate: {}, diagnostic: {} })
  assert.equal('submission' in task, false)
  const feedback = eventEntries(cwd, created.task_id).at(-1)
  assert.equal(feedback.type, 'review_feedback')
  assert.equal(feedback.classification, 'plan_change')
  assert.equal(feedback.summary, '范围需要调整')
})

test('review correction returns to dev, preserves approval, and increments work revision', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, 'correction')
  assert.equal(approve(cwd, created).status, 0)
  writeTask(cwd, created.task_id, (task) => {
    task.phase = 'review'
    task.submission = {
      work_revision: 1, changes: 'first', verified: '', unverified: 'none',
      submitted_at: new Date().toISOString(),
    }
  })
  const result = approve(cwd, created, ['--feedback', '改用明确图标'])
  assert.equal(result.status, 0, result.stderr)
  const task = readTask(cwd, created.task_id)
  assert.equal(task.phase, 'dev')
  assert.equal(task.work_revision, 2)
  assert.equal(task.implementation_approval.approved_plan_revision, 1)
  assert.equal('submission' in task, false)
  const feedback = eventEntries(cwd, created.task_id).findLast(
    (event) => event.type === 'review_feedback',
  )
  assert.equal(feedback.classification, 'implementation_correction')
  assert.equal(feedback.summary, '改用明确图标')
})

test('active tasks allow approve and return a shared worktree warning', () => {
  for (const phase of ['dev', 'check', 'review']) {
    const cwd = temporaryDirectory()
    init(cwd)
    const first = checkpoint(cwd, `first ${phase}`)
    writeTask(cwd, first.task_id, (task) => {
      task.phase = phase
      if (phase !== 'dev') task.work_revision = 1
    })
    const second = checkpoint(cwd, `second ${phase}`)
    const approved = approve(cwd, second)
    assert.equal(approved.status, 0, approved.stderr)
    assert.match(JSON.parse(approved.stdout).warnings[0], /Shared worktree/)
    assert.equal(readTask(cwd, first.task_id).phase, phase)

    writeTask(cwd, first.task_id, (task) => {
      task.blocked = {
        reason: 'waiting', waiting_for: 'user', blocked_at: new Date().toISOString(),
      }
    })
    const third = checkpoint(cwd, `third ${phase}`)
    const blockedApproved = approve(cwd, third)
    assert.equal(blockedApproved.status, 0, blockedApproved.stderr)
    assert.match(JSON.parse(blockedApproved.stdout).warnings[0], /Shared worktree/)
    assert.equal(readTask(cwd, first.task_id).phase, phase)
  }
})

test('archived done and abandoned tasks do not produce a shared worktree warning', () => {
  for (const outcome of ['done', 'abandoned']) {
    const cwd = temporaryDirectory()
    init(cwd)
    const first = checkpoint(cwd, `archived ${outcome}`)
    writeTask(cwd, first.task_id, (task) => {
      task.phase = 'review'
      task.outcome = outcome
    })
    const archive = join(cwd, '.latch', 'archive', '2026-07', first.task_id)
    mkdirSync(dirname(archive), { recursive: true })
    renameSync(dirname(taskPath(cwd, first.task_id)), archive)
    const second = checkpoint(cwd, `after ${outcome}`)
    const result = approve(cwd, second)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout).warnings, [])
  }
})

test('two real processes approving different tasks both succeed independently', async () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const first = checkpoint(cwd, 'parallel first')
  const second = checkpoint(cwd, 'parallel second')
  const args = (created) => [
    'approve', created.task_id, '--expect-revision', '1', '--reason', '用户批准', '--json',
  ]
  const results = await Promise.all([
    runAsync(cwd, args(first), 'codex:session:parallel-a'),
    runAsync(cwd, args(second), 'codex:session:parallel-b'),
  ])
  assert.deepEqual(results.map((result) => result.status).sort(), [0, 0])
  for (const task of [first, second]) {
    assert.equal(readTask(cwd, task.task_id).phase, 'dev')
    assert.equal(eventEntries(cwd, task.task_id).length, 3)
  }
})

test('unused workspace lock does not block approval', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, 'lock conflict')
  const lockPath = join(cwd, '.latch', '.locks', 'workspace.lock')
  writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`)
  const result = approve(cwd, created)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(lockPath), true)
})
