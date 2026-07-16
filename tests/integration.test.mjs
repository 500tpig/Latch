import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const cli = join(process.cwd(), 'dist/cli.js')
function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, LATCH_ACTOR: 'codex:session:integration' },
  })
}
function json(result) {
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('formal CLI completes approval, gate, review correction, resubmit, and done', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'latch-v2-integration-'))
  try {
    const plan = {
      goal: 'integration', scope: ['fixture'], acceptance: ['archive'],
      approach: ['run argv'], api_assumptions: [], permission_assumptions: [],
      data_assumptions: [], user_flow: ['approve verify review done'], out_of_scope: [],
      verification_plan: [{ name: 'gate', command: [process.execPath, '-e', 'process.exit(0)'], kind: 'gate' }],
      open_questions: [],
    }
    writeFileSync(join(cwd, 'plan.json'), `${JSON.stringify(plan)}\n`)
    writeFileSync(join(cwd, 'impact.json'), `${JSON.stringify({
      kind: 'none',
      reason: 'Integration fixture does not change module contracts.',
    })}\n`)
    json(run(cwd, ['init', '--json']))
    const created = json(run(cwd, ['checkpoint', 'integration', '--plan-file', 'plan.json', '--json']))
    const id = created.task_id
    json(run(cwd, ['approve', id, '--expect-revision', '1', '--reason', 'approved', '--json']))
    json(run(cwd, ['verify', id, '--expect-revision', '2', '--name', 'gate', '--json']))
    json(run(cwd, ['submit', id, '--expect-revision', '3', '--changes', 'first', '--unverified', '', '--knowledge-impact-file', 'impact.json', '--json']))
    json(run(cwd, ['approve', id, '--expect-revision', '4', '--feedback', 'correction', '--json']))
    json(run(cwd, ['verify', id, '--expect-revision', '5', '--name', 'gate', '--json']))
    json(run(cwd, ['submit', id, '--expect-revision', '6', '--changes', 'second', '--unverified', '', '--knowledge-impact-file', 'impact.json', '--json']))
    const done = json(run(cwd, ['done', id, '--expect-revision', '7', '--followup', 'none', '--json']))
    assert.equal(done.outcome, 'done')
    const month = readdirSync(join(cwd, '.latch', 'archive'))[0]
    const archived = JSON.parse(readFileSync(join(cwd, '.latch', 'archive', month, id, 'task.json'), 'utf8'))
    assert.equal(archived.closure.changes, 'second')
    assert.equal(archived.work_revision, 2)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('Board context fixture exposes stable v2 fields', () => {
  const fixture = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/context-v2.json'), 'utf8'))
  assert.equal(fixture.schema_version, 2)
  assert.equal(fixture.task.phase, 'review')
  assert.equal(fixture.task.implementation_approval.approved_plan_revision, fixture.task.plan_revision)
  assert.equal(fixture.task.submission.work_revision, fixture.task.work_revision)
})
