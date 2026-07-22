import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const cli = join(process.cwd(), 'dist/cli.js')
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-v2-review-'))
  temporaryDirectories.push(directory)
  return directory
}

function run(cwd, args, actor = 'codex:session:review') {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LATCH_ACTOR: actor },
  })
}

function plan(overrides = {}) {
  return {
    goal: '完成 review 流程',
    scope: ['src/cli.ts'],
    acceptance: ['tests pass'],
    approach: ['执行 plan argv'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['approve -> verify -> submit -> done'],
    out_of_scope: ['Slice 5'],
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
    open_questions: [],
    ...overrides,
  }
}

function writePlan(cwd, value = plan()) {
  const name = `plan-${Math.random()}.json`
  writeFileSync(join(cwd, name), `${JSON.stringify(value, null, 2)}\n`)
  return name
}

function init(cwd) {
  const result = run(cwd, ['init'])
  assert.equal(result.status, 0, result.stderr)
}

function checkpoint(cwd, value = plan(), title = 'review task') {
  const result = run(cwd, [
    'checkpoint', title, '--plan-file', writePlan(cwd, value), '--json',
  ])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout).task_id
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

function revision(cwd, id) {
  return String(readTask(cwd, id).revision)
}

function approve(cwd, id) {
  const result = run(cwd, [
    'approve', id, '--expect-revision', revision(cwd, id),
    '--reason', '用户批准', '--json',
  ])
  assert.equal(result.status, 0, result.stderr)
}

function verify(cwd, id, name, extra = []) {
  const separator = extra.indexOf('--')
  const options = separator === -1 ? extra : extra.slice(0, separator)
  const command = separator === -1 ? [] : extra.slice(separator)
  return run(cwd, [
    'verify', id, '--expect-revision', revision(cwd, id), '--name', name,
    ...options, '--json', ...command,
  ])
}

function submit(cwd, id, extra = []) {
  const impactFile = `impact-${Math.random()}.json`
  writeFileSync(join(cwd, impactFile), `${JSON.stringify({
    kind: 'none',
    reason: 'Review lifecycle fixture does not change module contracts.',
  })}\n`)
  return run(cwd, [
    'submit', id, '--expect-revision', revision(cwd, id),
    '--changes', '实现完成', '--unverified', '未做浏览器验收',
    '--knowledge-impact-file', impactFile, ...extra, '--json',
  ])
}

function archivedTask(cwd, id) {
  for (const month of readdirSync(join(cwd, '.latch', 'archive')))
    try {
      return JSON.parse(
        readFileSync(join(cwd, '.latch', 'archive', month, id, 'task.json'), 'utf8'),
      )
    } catch {}
  throw new Error(`Archived task not found: ${id}`)
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('multiple named gates are independent and submit requires all current passes', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd)
  approve(cwd, id)

  const first = verify(cwd, id, 'first')
  assert.equal(first.status, 0, first.stderr)
  assert.equal(readTask(cwd, id).phase, 'check')
  const incomplete = submit(cwd, id)
  assert.notEqual(incomplete.status, 0)
  assert.match(incomplete.stderr, /incomplete gates: second/)

  const second = verify(cwd, id, 'second')
  assert.equal(second.status, 0, second.stderr)
  const submitted = submit(cwd, id)
  assert.equal(submitted.status, 0, submitted.stderr)
  const task = readTask(cwd, id)
  assert.equal(task.phase, 'review')
  assert.equal(task.submission.work_revision, 1)
  assert.equal(task.submission.verified, 'first: pass; second: pass')
})

test('same gate rerun replaces its current result and a failure blocks submit', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({
    verification_plan: [
      { name: 'gate', command: [process.execPath, '-e', 'process.exit(1)'], kind: 'gate' },
    ],
  }))
  approve(cwd, id)
  const failed = verify(cwd, id, 'gate')
  assert.notEqual(failed.status, 0)
  assert.equal(readTask(cwd, id).verification.gate.gate.status, 'fail')
  assert.notEqual(submit(cwd, id).status, 0)

  const task = readTask(cwd, id)
  task.plan.verification_plan[0].command = [process.execPath, '-e', 'process.exit(0)']
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(task, null, 2)}\n`)
  const passed = verify(cwd, id, 'gate')
  assert.equal(passed.status, 0, passed.stderr)
  assert.equal(readTask(cwd, id).verification.gate.gate.status, 'pass')
})

test('diagnostic failure is recorded without moving dev to check or blocking submit', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd)
  approve(cwd, id)
  const diagnostic = verify(cwd, id, 'exploratory', [
    '--diagnostic', '--', process.execPath, '-e', 'process.exit(3)',
  ])
  assert.notEqual(diagnostic.status, 0)
  let task = readTask(cwd, id)
  assert.equal(task.phase, 'dev')
  assert.equal(task.verification.diagnostic.exploratory.exit_code, 3)

  assert.equal(verify(cwd, id, 'first').status, 0)
  assert.equal(verify(cwd, id, 'second').status, 0)
  assert.equal(submit(cwd, id).status, 0)
})

test('gate command always comes from plan and command not found is persisted', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({
    verification_plan: [
      { name: 'missing', command: ['latch-v2-command-that-does-not-exist'], kind: 'gate' },
    ],
  }))
  approve(cwd, id)
  const override = verify(cwd, id, 'missing', ['--', process.execPath, '-e', 'process.exit(0)'])
  assert.notEqual(override.status, 0)
  assert.match(override.stderr, /approved plan/)

  const missing = verify(cwd, id, 'missing')
  assert.notEqual(missing.status, 0)
  const task = readTask(cwd, id)
  assert.equal(task.phase, 'check')
  assert.equal(task.verification.gate.missing.status, 'fail')
  assert.equal(task.verification.gate.missing.exit_code, 127)
  assert.match(readFileSync(eventsPath(cwd, id), 'utf8'), /ENOENT/)
})

test('work revision change makes prior gates and submission stale', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [plan().verification_plan[0]] }))
  approve(cwd, id)
  assert.equal(verify(cwd, id, 'first').status, 0)
  assert.equal(submit(cwd, id).status, 0)
  const correction = run(cwd, [
    'approve', id, '--expect-revision', revision(cwd, id),
    '--feedback', '修正实现', '--json',
  ])
  assert.equal(correction.status, 0, correction.stderr)
  assert.equal(readTask(cwd, id).work_revision, 2)
  const stale = run(cwd, [
    'submit', id, '--expect-revision', revision(cwd, id),
    '--changes', 'second', '--unverified', '', '--json',
  ])
  assert.notEqual(stale.status, 0)
})

test('non-implementation correction preserves review proof and submission', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [plan().verification_plan[0]] }))
  approve(cwd, id)
  assert.equal(verify(cwd, id, 'first').status, 0)
  assert.equal(submit(cwd, id).status, 0)
  const before = readTask(cwd, id)
  const correction = run(cwd, [
    'approve', id, '--expect-revision', revision(cwd, id),
    '--non-implementation-feedback', '修正文档表述，代码未变', '--json',
  ])
  assert.equal(correction.status, 0, correction.stderr)
  const after = readTask(cwd, id)
  assert.equal(after.phase, 'review')
  assert.equal(after.work_revision, before.work_revision)
  assert.deepEqual(after.verification, before.verification)
  assert.deepEqual(after.submission, before.submission)
  const events = readFileSync(eventsPath(cwd, id), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const feedback = events.findLast((event) => event.type === 'review_feedback')
  assert.equal(feedback.classification, 'non_implementation_correction')
  assert.equal(feedback.work_revision, before.work_revision)

  const human = run(cwd, [
    'approve', id, '--expect-revision', revision(cwd, id),
    '--non-implementation-feedback', '再次修正文案',
  ])
  assert.equal(human.status, 0, human.stderr)
  assert.match(human.stdout, /Recorded non-implementation feedback/)
  assert.doesNotMatch(human.stdout, /Approved/)
})

test('context timeline rewrites technical review feedback for user reading', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [plan().verification_plan[0]] }))
  approve(cwd, id)
  assert.equal(verify(cwd, id, 'first').status, 0)
  assert.equal(submit(cwd, id).status, 0)
  const feedback = run(cwd, [
    'approve', id, '--expect-revision', revision(cwd, id),
    '--feedback',
    '纠正 submission knowledge_impact：当前 artifact_refs 是产品文档与 canonical skill，并非带 knowledge frontmatter 的模块知识文档；重新提交时改为 kind=none',
    '--json',
  ])
  assert.equal(feedback.status, 0, feedback.stderr)

  const context = run(cwd, ['context', id, '--json', '--brief'])
  assert.equal(context.status, 0, context.stderr)
  const timeline = JSON.parse(context.stdout).timeline
  const entry = timeline.findLast((item) => item.event_type === 'review_feedback')
  assert.equal(entry.title, '反馈：修正提交记录')
  assert.equal(entry.summary, '修正提交记录里的知识影响标记。')
  assert.match(entry.impact, /重新提交验收/)
  assert.doesNotMatch(entry.summary, /knowledge_impact|artifact_refs|kind=none|frontmatter/)
  assert.equal(entry.details.classification, 'implementation_correction')
})

test('submit warns when an artifact is not tracked by Git', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [] }))
  const attached = run(cwd, [
    'save', id, '--expect-revision', revision(cwd, id),
    '--artifact', 'doc:docs/local.md', '--json',
  ])
  assert.equal(attached.status, 0, attached.stderr)
  approve(cwd, id)
  const result = submit(cwd, id, ['--no-verify', '--reason', '纯文档'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(JSON.parse(result.stdout).warnings.join('\n'), /docs\/local\.md is missing/)
})

test('submit reports every untracked worktree file separately from artifacts', () => {
  const cwd = temporaryDirectory()
  spawnSync('git', ['init'], { cwd, encoding: 'utf8' })
  writeFileSync(join(cwd, '.gitignore'), '.latch/\n')
  spawnSync('git', ['add', '.gitignore'], { cwd, encoding: 'utf8' })
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [] }))
  writeFileSync(join(cwd, 'implementation.ts'), 'export const value = 1\n')
  writeFileSync(join(cwd, 'review-note.md'), 'review\n')
  approve(cwd, id)
  const result = submit(cwd, id, ['--no-verify', '--reason', 'fixture'])
  assert.equal(result.status, 0, result.stderr)
  const warnings = JSON.parse(result.stdout).warnings.join('\n')
  assert.match(warnings, /Worktree delivery: implementation\.ts is untracked/)
  assert.match(warnings, /Worktree delivery: review-note\.md is untracked/)
  assert.doesNotMatch(warnings, /Artifact delivery: implementation\.ts/)
})

test('no-verify requires approval, no gates, and a reason', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const noGatePlan = plan({ verification_plan: [] })
  const id = checkpoint(cwd, noGatePlan)
  assert.notEqual(submit(cwd, id, ['--no-verify', '--reason', '纯文档']).status, 0)
  approve(cwd, id)
  assert.notEqual(submit(cwd, id, ['--no-verify']).status, 0)
  const result = submit(cwd, id, ['--no-verify', '--reason', '纯文档'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readTask(cwd, id).submission.no_verify.reason, '纯文档')

  const gated = checkpoint(cwd, plan(), 'gated no verify')
  // 第一张已在 review 仍占用；回 plan 只为构造独立门禁场景。
  const first = readTask(cwd, id)
  first.phase = 'plan'
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(first, null, 2)}\n`)
  approve(cwd, gated)
  assert.notEqual(submit(cwd, gated, ['--no-verify', '--reason', 'skip']).status, 0)
})

test('done freezes current submission into closure, archives, clears current, and retries idempotently', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [] }))
  approve(cwd, id)
  assert.equal(submit(cwd, id, ['--no-verify', '--reason', '纯文档']).status, 0)
  const expected = revision(cwd, id)
  const done = run(cwd, [
    'done', id, '--expect-revision', expected, '--followup', '后续观察', '--json',
  ])
  assert.equal(done.status, 0, done.stderr)
  const archived = archivedTask(cwd, id)
  assert.equal(archived.outcome, 'done')
  assert.equal(archived.closure.changes, '实现完成')
  assert.equal(archived.closure.followup, '后续观察')
  const state = JSON.parse(readFileSync(join(cwd, '.latch', 'state.json'), 'utf8'))
  assert.deepEqual(state.actors, {})

  const retry = run(cwd, [
    'done', id, '--expect-revision', expected, '--followup', 'ignored', '--json',
  ])
  assert.equal(retry.status, 0, retry.stderr)
  assert.equal(JSON.parse(retry.stdout).outcome, 'done')
})

test('done rejects stale submission and abandon requires reason and archives outcome', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const doneId = checkpoint(cwd, plan({ verification_plan: [] }), 'stale done')
  approve(cwd, doneId)
  assert.equal(submit(cwd, doneId, ['--no-verify', '--reason', 'none']).status, 0)
  const task = readTask(cwd, doneId)
  task.work_revision += 1
  writeFileSync(taskPath(cwd, doneId), `${JSON.stringify(task, null, 2)}\n`)
  const stale = run(cwd, [
    'done', doneId, '--expect-revision', revision(cwd, doneId), '--followup', '',
  ])
  assert.notEqual(stale.status, 0)
  assert.match(stale.stderr, /valid submission/)

  task.phase = 'plan'
  writeFileSync(taskPath(cwd, doneId), `${JSON.stringify(task, null, 2)}\n`)
  const abandonedId = checkpoint(cwd, plan(), 'abandoned')
  const missing = run(cwd, [
    'abandon', abandonedId, '--expect-revision', '1',
  ])
  assert.notEqual(missing.status, 0)
  const abandoned = run(cwd, [
    'abandon', abandonedId, '--expect-revision', '1',
    '--reason', '用户取消', '--json',
  ])
  assert.equal(abandoned.status, 0, abandoned.stderr)
  assert.equal(archivedTask(cwd, abandonedId).outcome, 'abandoned')
})
