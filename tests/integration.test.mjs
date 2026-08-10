import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const cli = join(process.cwd(), 'dist/cli.js')
function run(cwd, args, actor = 'codex:session:integration') {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, LATCH_ACTOR: actor },
  })
}
function json(result) {
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function writeJson(cwd, path, value) {
  writeFileSync(join(cwd, path), `${JSON.stringify(value, null, 2)}\n`)
  return path
}

function noGatePlan(goal = 'reader fixture') {
  return {
    goal,
    workspace_scope: { paths: ['fixture'] },
    scope: ['fixture'],
    acceptance: ['reader context'],
    approach: ['run argv'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['approve submit context done'],
    out_of_scope: [],
    verification_plan: [],
    open_questions: [],
  }
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
    const approved = json(run(cwd, [
      'approve', id, '--expect-revision', '1', '--reason', 'approved', '--json',
    ]))
    assert.deepEqual(approved.shared_worktree, {
      active_task_count: 0,
      overlap_task_count: 0,
      sample_limit: 8,
      sample: [],
      truncated: false,
    })
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
    assert.deepEqual(status.shared_worktree, approved.shared_worktree)

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
    assert.equal(brief.submission.unverified_items_summary.sample_limit, 8)
    assert.equal(brief.submission.unverified_items_summary.truncated, false)
    assert.equal(brief.schema5_view.reviewer_next_action, 'prepare_closeout')
    assert.equal('unverified_items' in brief.submission, false)
    const reviewHuman = run(cwd, ['context', id]).stdout
    for (const line of contract.human.review_lines) assert.match(reviewHuman, new RegExp(line))
    assert.match(reviewHuman, /sample_limit=8/)
    assert.match(reviewHuman, /Reviewer next action: prepare_closeout/)

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
    assert.deepEqual(
      archivedContext.task.schema5_view.closeout.resolution_counts,
      contract.archive.resolution_counts,
    )
    assert.equal(
      archivedContext.task.schema5_view.closeout.resolutions.sample.length,
      Object.values(contract.archive.resolution_counts).reduce((sum, count) => sum + count, 0),
    )
    const archivedStatus = json(run(cwd, ['context', id, '--json', '--status'])).task
    assert.equal(archivedStatus.resolution_pending_count, contract.archive.resolution_pending_count)
    const archivedHuman = run(cwd, ['context', id]).stdout
    for (const line of contract.human.archive_lines) assert.match(archivedHuman, new RegExp(line))
    assert.match(archivedHuman, /Follow-up next action: track_followup_items/)

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
    const doneTimeline = archivedContext.timeline.findLast((event) => event.event_type === 'done')
    assert.equal(doneTimeline.title, '完成归档：3 项 closeout')
    assert.equal(doneTimeline.next_action, '跟进 closeout 中标记的 follow-up。')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('schema 5 Board reader fixture matches richer bounded Context projections', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'latch-v2-reader-'))
  try {
    spawnSync('git', ['init'], { cwd, encoding: 'utf8' })
    const contract = JSON.parse(
      readFileSync(join(process.cwd(), 'tests/fixtures/context-v5-board-reader.json'), 'utf8'),
    )
    assert.doesNotMatch(JSON.stringify(contract), /\/Users\//)
    assert.equal(contract.sample_limit, 8)

    json(run(cwd, ['init', '--json']))
    writeJson(cwd, '.latch/impact.json', {
      kind: 'none',
      reason: 'Reader fixture does not change module contracts.',
    })
    writeJson(cwd, '.latch/plan.json', noGatePlan('open reader fixture'))
    const open = json(run(cwd, [
      'checkpoint', 'open reader fixture',
      '--plan-file', '.latch/plan.json', '--json',
    ]))
    json(run(cwd, [
      'approve', open.task_id, '--expect-revision', '1',
      '--reason', 'approved', '--json',
    ]))
    const openBrief = json(run(cwd, [
      'context', open.task_id, '--json', '--brief',
    ])).task
    assert.equal(openBrief.phase, contract.views.open.phase)
    assert.deepEqual(
      openBrief.schema5_view.unverified_items,
      contract.views.open.schema5_view.unverified_items,
    )
    assert.equal(
      openBrief.schema5_view.reviewer_next_action,
      contract.views.open.schema5_view.reviewer_next_action,
    )
    const openReview = json(run(cwd, [
      'context', open.task_id, '--json', '--review',
    ]))
    assert.equal(openReview.view, contract.review_view.view)
    assert.equal(openReview.task.next_action, contract.views.open.review.next_action)
    assert.deepEqual(
      openReview.task.schema5_view,
      contract.views.open.schema5_view,
    )
    for (const field of contract.review_view.default_omitted_history)
      assert.equal(field in openReview, false)
    for (const field of contract.review_view.omitted_task_fields)
      assert.equal(field in openReview.task, false)
    assert.deepEqual(openReview.task.scope, ['fixture'])
    assert.deepEqual(openReview.task.acceptance, ['reader context'])

    const takeoverReview = json(run(
      cwd,
      ['context', open.task_id, '--json', '--review'],
      'codex:session:review-reader',
    ))
    assert.equal(takeoverReview.task.next_action, 'takeover')

    const unverifiedArgs = Array.from(
      { length: contract.views.review_truncated.schema5_view.unverified_items.total },
      (_, index) => ['--unverified', `Reader item ${index + 1}`],
    ).flat()
    json(run(cwd, [
      'submit', open.task_id, '--expect-revision', '2',
      '--changes', 'reader review fixture',
      ...unverifiedArgs,
      '--knowledge-impact-file', '.latch/impact.json',
      '--no-verify', '--reason', 'no gates',
      '--json',
    ]))
    const review = json(run(cwd, [
      'context', open.task_id, '--json', '--brief',
    ]))
    assert.deepEqual(
      review.task.schema5_view.unverified_items,
      contract.views.review_truncated.schema5_view.unverified_items,
    )
    assert.equal(
      review.task.schema5_view.reviewer_next_action,
      contract.views.review_truncated.schema5_view.reviewer_next_action,
    )
    const compactReview = json(run(cwd, [
      'context', open.task_id, '--json', '--review',
    ]))
    assert.equal(
      compactReview.task.next_action,
      contract.views.review_truncated.review.next_action,
    )
    assert.deepEqual(
      {
        changes: compactReview.task.submission.changes,
        unverified_count: compactReview.task.submission.unverified_count,
        unverified_items_summary:
          compactReview.task.submission.unverified_items_summary,
      },
      contract.views.review_truncated.review.submission,
    )
    assert.equal('verification' in compactReview.task, false)
    assert.equal('plan' in compactReview.task, false)
    assert.equal('timeline' in compactReview, false)
    assert.equal('recent_events' in compactReview, false)

    const reviewTimeline = json(run(cwd, [
      'context', open.task_id, '--json', '--review',
      '--history', 'timeline',
    ]))
    assert.equal(reviewTimeline.history_view, 'timeline')
    assert.equal(reviewTimeline.timeline.length <= 5, true)
    assert.equal('recent_events' in reviewTimeline, false)
    const submittedTimeline = review.timeline.findLast((event) => event.event_type === 'submitted')
    assert.equal(
      submittedTimeline.title,
      contract.views.review_truncated.timeline.submitted_title,
    )
    assert.equal(
      submittedTimeline.details.unverified_item_ids_total,
      contract.views.review_truncated.timeline.unverified_item_ids_total,
    )
    assert.equal(
      submittedTimeline.details.unverified_item_ids_sample_limit,
      contract.views.review_truncated.timeline.unverified_item_ids_sample_limit,
    )
    assert.equal(
      submittedTimeline.details.unverified_item_ids_truncated,
      contract.views.review_truncated.timeline.unverified_item_ids_truncated,
    )

    writeJson(cwd, '.latch/stale-plan.json', {
      ...noGatePlan('stale review fixture'),
      verification_plan: [{
        name: 'gate',
        command: [process.execPath, '-e', 'process.exit(0)'],
        kind: 'gate',
      }],
    })
    const stale = json(run(cwd, [
      'checkpoint', 'stale review fixture',
      '--plan-file', '.latch/stale-plan.json', '--json',
    ]))
    json(run(cwd, [
      'approve', stale.task_id, '--expect-revision', '1',
      '--reason', 'approved', '--json',
    ]))
    json(run(cwd, [
      'verify', stale.task_id, '--expect-revision', '2',
      '--name', 'gate', '--json',
    ]))
    json(run(cwd, [
      'submit', stale.task_id, '--expect-revision', '3',
      '--changes', 'stale review fixture',
      '--knowledge-impact-file', '.latch/impact.json', '--json',
    ]))
    const currentProofReview = json(run(cwd, [
      'context', stale.task_id, '--json', '--review',
    ]))
    assert.deepEqual(
      Object.keys(currentProofReview.task.verification_plan[0]).sort(),
      contract.review_view.named_gate_fields,
    )
    writeFileSync(join(cwd, 'fixture'), 'changed after submission\n')
    const staleReview = json(run(cwd, [
      'context', stale.task_id, '--json', '--review',
    ]))
    assert.equal(
      staleReview.task.next_action,
      contract.views.review_stale.review.next_action,
    )
    assert.equal(
      staleReview.task.workspace_proof.live_status,
      contract.views.review_stale.review.live_status,
    )
    assert.equal(
      staleReview.task.verification_plan[0].status,
      contract.views.review_stale.review.gate_status,
    )
    assert.equal(
      staleReview.task.verification_plan[0].stale_reason,
      contract.views.review_stale.review.gate_stale_reason,
    )
    const staleTakeover = json(run(
      cwd,
      ['context', stale.task_id, '--json', '--review'],
      'codex:session:review-reader',
    ))
    assert.equal(
      staleTakeover.task.next_action,
      contract.views.review_stale.review.writer_mismatch_next_action,
    )
    assert.equal(
      staleTakeover.task.after_takeover_next_action,
      contract.views.review_stale.review.after_takeover_next_action,
    )
    rmSync(join(cwd, 'fixture'), { force: true })

    writeJson(cwd, '.latch/review-ready-plan.json', noGatePlan('review ready fixture'))
    const reviewReady = json(run(cwd, [
      'checkpoint', 'review ready fixture',
      '--plan-file', '.latch/review-ready-plan.json', '--json',
    ]))
    json(run(cwd, [
      'approve', reviewReady.task_id, '--expect-revision', '1',
      '--reason', 'approved', '--json',
    ]))
    json(run(cwd, [
      'submit', reviewReady.task_id, '--expect-revision', '2',
      '--changes', 'review ready fixture',
      '--knowledge-impact-file', '.latch/impact.json',
      '--no-verify', '--reason', 'no gates', '--json',
    ]))
    const readyReview = json(run(cwd, [
      'context', reviewReady.task_id, '--json', '--review',
    ]))
    assert.equal(
      readyReview.task.next_action,
      contract.views.review_ready.review.next_action,
    )

    writeJson(cwd, '.latch/mixed-plan.json', noGatePlan('mixed archive fixture'))
    const mixed = json(run(cwd, [
      'checkpoint', 'mixed archive fixture',
      '--plan-file', '.latch/mixed-plan.json', '--json',
    ]))
    json(run(cwd, [
      'approve', mixed.task_id, '--expect-revision', '1',
      '--reason', 'approved', '--json',
    ]))
    json(run(cwd, [
      'submit', mixed.task_id, '--expect-revision', '2',
      '--changes', 'mixed archive fixture',
      '--unverified', 'Resolved browser check',
      '--unverified', 'Accepted compatibility risk',
      '--unverified', 'Release observation follow-up',
      '--knowledge-impact-file', '.latch/impact.json',
      '--no-verify', '--reason', 'no gates',
      '--json',
    ]))
    writeJson(cwd, '.latch/mixed-closeout.json', {
      resolutions: [
        { item_id: 'U1', outcome: 'resolved', resolution: 'Browser check passed' },
        {
          item_id: 'U2',
          outcome: 'accepted_risk',
          user_acceptance: { statement: 'User accepts the compatibility risk' },
        },
        {
          item_id: 'U3',
          outcome: 'followup',
          followup: {
            action: 'Observe production for one week',
            owner: {
              kind: 'external',
              account_uri: 'https://github.com/orgs/example/teams/runtime',
            },
          },
        },
      ],
    })
    json(run(cwd, [
      'done', mixed.task_id, '--expect-revision', '3',
      '--closeout-file', '.latch/mixed-closeout.json',
      '--json',
    ]))
    const mixedArchive = json(run(cwd, ['context', mixed.task_id, '--json']))
    assert.deepEqual(
      mixedArchive.task.schema5_view,
      contract.views.archived_mixed.schema5_view,
    )
    const mixedDone = mixedArchive.timeline.findLast((event) => event.event_type === 'done')
    assert.equal(mixedDone.title, contract.views.archived_mixed.timeline.done_title)
    assert.equal(
      mixedDone.next_action,
      contract.views.archived_mixed.timeline.done_next_action,
    )
    const mixedArchiveReview = json(run(cwd, [
      'context', mixed.task_id, '--json', '--review',
    ]))
    assert.equal(mixedArchiveReview.archived, true)
    assert.equal(
      mixedArchiveReview.task.next_action,
      contract.views.archived_mixed.review.next_action,
    )
    assert.deepEqual(
      mixedArchiveReview.task.schema5_view,
      contract.views.archived_mixed.schema5_view,
    )
    assert.equal('timeline' in mixedArchiveReview, false)
    assert.equal('recent_events' in mixedArchiveReview, false)

    writeJson(cwd, '.latch/no-followup-plan.json', noGatePlan('no followup fixture'))
    const noFollowup = json(run(cwd, [
      'checkpoint', 'no followup fixture',
      '--plan-file', '.latch/no-followup-plan.json', '--json',
    ]))
    json(run(cwd, [
      'approve', noFollowup.task_id, '--expect-revision', '1',
      '--reason', 'approved', '--json',
    ]))
    json(run(cwd, [
      'submit', noFollowup.task_id, '--expect-revision', '2',
      '--changes', 'no followup fixture',
      '--unverified', 'Manual check',
      '--knowledge-impact-file', '.latch/impact.json',
      '--no-verify', '--reason', 'no gates',
      '--json',
    ]))
    writeJson(cwd, '.latch/no-followup-closeout.json', {
      resolutions: [
        { item_id: 'U1', outcome: 'resolved', resolution: 'Manual check passed' },
      ],
    })
    json(run(cwd, [
      'done', noFollowup.task_id, '--expect-revision', '3',
      '--closeout-file', '.latch/no-followup-closeout.json',
      '--json',
    ]))
    const noFollowupArchive = json(run(cwd, [
      'context', noFollowup.task_id, '--json',
    ]))
    assert.deepEqual(
      noFollowupArchive.task.schema5_view.closeout,
      contract.views.archived_without_followup.schema5_view.closeout,
    )
    assert.match(
      noFollowupArchive.timeline.findLast((event) => event.event_type === 'done').impact,
      new RegExp(contract.views.archived_without_followup.timeline.done_impact_fragment),
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
