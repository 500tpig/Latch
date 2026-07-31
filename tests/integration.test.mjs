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

test('schema 5 CLI completes lifecycle with structured closeout projections', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'latch-v2-integration-'))
  try {
    spawnSync('git', ['init'], { cwd, encoding: 'utf8' })
    const contract = JSON.parse(
      readFileSync(join(process.cwd(), 'tests/fixtures/context-v5-candidate.json'), 'utf8'),
    )
    const plan = {
      goal: 'integration', workspace_scope: { paths: ['fixture'] }, scope: ['fixture'], acceptance: ['archive'],
      approach: ['run argv'], api_assumptions: [], permission_assumptions: [],
      data_assumptions: [], user_flow: ['approve verify review done'], out_of_scope: [],
      verification_plan: [{ name: 'gate', command: [process.execPath, '-e', 'process.exit(0)'], kind: 'gate' }],
      open_questions: [],
    }
    json(run(cwd, ['init', '--json']))
    writeFileSync(join(cwd, '.latch', 'plan.json'), `${JSON.stringify(plan)}\n`)
    writeFileSync(join(cwd, '.latch', 'impact.json'), `${JSON.stringify({
      kind: 'none',
      reason: 'Integration fixture does not change module contracts.',
    })}\n`)
    const created = json(run(cwd, ['checkpoint', 'integration', '--plan-file', '.latch/plan.json', '--json']))
    const id = created.task_id
    const eventsPath = join(cwd, '.latch', 'tasks', id, 'events.jsonl')
    const initialEvents = readFileSync(eventsPath, 'utf8')
    const createdEvent = JSON.parse(initialEvents.trim())
    writeFileSync(eventsPath, `${JSON.stringify({
      type: 'events_meta',
      events_schema_version: contract.events.events_schema_version,
      actor: createdEvent.actor,
      task_id: createdEvent.task_id,
      revision: 0,
      created_at: createdEvent.created_at,
    })}\n${initialEvents}`)
    json(run(cwd, ['approve', id, '--expect-revision', '1', '--reason', 'approved', '--json']))
    json(run(cwd, ['verify', id, '--expect-revision', '2', '--name', 'gate', '--json']))
    assert.equal(JSON.parse(readFileSync(join(cwd, '.latch', 'tasks', id, 'task.json'), 'utf8')).schema_version, 5)
    json(run(cwd, ['submit', id, '--expect-revision', '3', '--changes', 'first', '--knowledge-impact-file', '.latch/impact.json', '--json']))
    json(run(cwd, ['approve', id, '--expect-revision', '4', '--feedback', 'correction', '--json']))
    json(run(cwd, ['verify', id, '--expect-revision', '5', '--name', 'gate', '--json']))
    json(run(cwd, [
      'submit', id, '--expect-revision', '6', '--changes', 'second',
      '--unverified', '定向人工验收尚未完成',
      '--unverified', '低概率兼容风险待用户确认',
      '--unverified', '外部团队需要继续观察',
      '--knowledge-impact-file', '.latch/impact.json', '--json',
    ]))

    const status = json(run(cwd, ['context', id, '--json', '--status'])).task
    assert.equal(status.task_schema_version, contract.task_schema_version)
    assert.equal(status.min_writer_version, contract.min_writer_version)
    assert.equal(status.unverified_count, contract.review.unverified_count)
    assert.equal(status.resolution_pending_count, contract.review.resolution_pending_count)
    assert.equal(status.next_action, contract.review.next_action)

    const full = json(run(cwd, ['context', id, '--json'])).task
    assert.deepEqual(
      full.submission.unverified_items.map((item) => item.item_id),
      contract.review.item_ids,
    )
    const brief = json(run(cwd, ['context', id, '--json', '--brief'])).task
    assert.equal(brief.submission.unverified_count, contract.review.unverified_count)
    assert.equal(
      brief.submission.unverified_summary.length,
      contract.review.unverified_count,
    )
    assert.equal('unverified_items' in brief.submission, false)
    const reviewHuman = run(cwd, ['context', id]).stdout
    for (const line of contract.human.review_lines) assert.match(reviewHuman, new RegExp(line))

    writeFileSync(join(cwd, '.latch', 'closeout.json'), `${JSON.stringify({
      resolutions: [
        { item_id: 'U1', outcome: 'resolved', resolution: '已完成定向人工验收' },
        {
          item_id: 'U2',
          outcome: 'accepted_risk',
          user_acceptance: { statement: '用户明确接受该低概率兼容风险' },
        },
        {
          item_id: 'U3',
          outcome: 'followup',
          followup: {
            action: '发布后观察一周',
            owner: {
              kind: 'external',
              account_uri: contract.archive.followup_owner,
            },
          },
        },
      ],
    }, null, 2)}\n`)
    const done = json(run(cwd, [
      'done', id, '--expect-revision', '7',
      '--closeout-file', '.latch/closeout.json', '--json',
    ]))
    assert.equal(done.outcome, 'done')
    const month = readdirSync(join(cwd, '.latch', 'archive'))[0]
    const archived = JSON.parse(readFileSync(join(cwd, '.latch', 'archive', month, id, 'task.json'), 'utf8'))
    assert.equal(archived.closure.changes, 'second')
    const resolutionCounts = Object.fromEntries(
      Object.keys(contract.archive.resolution_counts).map((outcome) => [
        outcome,
        archived.closure.resolutions.filter((item) => item.outcome === outcome).length,
      ]),
    )
    assert.deepEqual(resolutionCounts, contract.archive.resolution_counts)
    assert.equal(archived.closure.resolutions[1].user_acceptance.accepted_by, contract.archive.accepted_by)
    assert.match(archived.closure.resolutions[1].user_acceptance.recorded_at, /^\d{4}-/)
    assert.equal(archived.work_revision, 2)
    assert.equal(archived.provenance, 'clean')
    assert.equal('provenance' in archived.closure, false)

    const archivedContext = json(run(cwd, ['context', id, '--json']))
    assert.equal(archivedContext.outcome, contract.archive.outcome)
    assert.equal(
      archivedContext.task.closure.resolutions.length,
      Object.values(contract.archive.resolution_counts).reduce((sum, count) => sum + count, 0),
    )
    const archivedStatus = json(run(cwd, ['context', id, '--json', '--status'])).task
    assert.equal(archivedStatus.resolution_pending_count, contract.archive.resolution_pending_count)
    const archivedHuman = run(cwd, ['context', id]).stdout
    for (const line of contract.human.archive_lines) assert.match(archivedHuman, new RegExp(line))

    const submitted = archivedContext.recent_events.findLast((event) => event.type === 'submitted')
    assert.deepEqual(
      contract.events.submitted_fields.map((field) => submitted[field]),
      [contract.review.item_ids, contract.review.unverified_count],
    )
    assert.equal('summary' in submitted, false)
    assert.equal('unverified_items' in submitted, false)
    const doneEvent = archivedContext.recent_events.findLast((event) => event.type === 'done')
    assert.deepEqual(
      contract.events.done_fields.map((field) => doneEvent[field]),
      contract.events.done_fields.map(
        (field) => contract.archive.resolution_counts[field.replace(/_count$/, '')],
      ),
    )
    const eventsMeta = JSON.parse(
      readFileSync(join(cwd, '.latch', 'archive', month, id, 'events.jsonl'), 'utf8')
        .split('\n')[0],
    )
    assert.equal(
      eventsMeta.events_schema_version,
      contract.events.events_schema_version,
    )
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('Board context fixture exposes stable v2 fields', () => {
  const fixture = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/context-v2.json'), 'utf8'))
  assert.equal(fixture.schema_version, 2)
  assert.equal(fixture.task.phase, 'review')
  assert.equal(fixture.task.implementation_approval.approved_plan_revision, fixture.task.plan_revision)
  assert.equal(fixture.task.submission.work_revision, fixture.task.work_revision)
})
