import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CONTEXT_VIEW_BYTE_BUDGETS,
  CONTEXT_VIEW_COLLECTION_LIMITS,
  contextJsonByteLength,
  projectBoundedContext,
} from '../dist/core/task-view/budget.js'

const fixture = JSON.parse(
  readFileSync('tests/fixtures/context-v3-maximum.json', 'utf8'),
)

function repeated(count, make) {
  return Array.from({ length: count }, (_, index) => make(index))
}

function makeMaximumContext() {
  const count = fixture.synthetic_input.repeat_count
  const longText = fixture.synthetic_input.long_text.repeat(20)
  const longId = fixture.synthetic_input.long_id.slice(0, 220)
  const item = (index) => ({
    item_id: `U${index + 1}`,
    summary: longText,
  })
  const changes = repeated(count, (index) => ({
    path: `src/fixture-${index}.ts`,
    scope: index % 2 === 0 ? 'in_scope' : 'out_of_scope',
    category: 'content',
    change: 'content_changed',
  }))
  const bounded = (sample) => ({
    total: count,
    sample_limit: count,
    total_count: count,
    returned_count: count,
    sample,
    truncated: false,
  })
  const verificationPlan = repeated(count, (index) => ({
    name: `gate-${index}`,
    command: ['node', '-e', 'process.exit(0)'],
    kind: 'gate',
    status: 'pass',
  }))
  return {
    schema_version: 3,
    generated_at: '2026-08-13T00:00:00.000Z',
    view: 'brief',
    current: true,
    task: {
      id: longId,
      title: longText,
      task_schema_version: 5,
      phase: 'review',
      revision: 42,
      plan_revision: 3,
      work_revision: 2,
      profile: 'standard',
      provenance: 'clean',
      goal: longText,
      scope: repeated(count, () => longText),
      acceptance: repeated(count, () => longText),
      approach: repeated(count, () => longText),
      user_flow: repeated(count, () => longText),
      open_questions: repeated(count, () => longText),
      writer: {
        primary_writer: longText,
        caller: longText,
        caller_capability: 'writable',
        status: 'writer_mismatch',
      },
      authorization: {
        kind: 'implementation_authorization',
        status: 'valid',
        source: 'user',
        reason: longText,
      },
      shared_worktree: {
        active_task_count: count,
        overlap_task_count: count,
        sample_limit: count,
        total_count: count,
        returned_count: count,
        sample: changes,
        truncated: false,
      },
      workspace_proof: {
        generation: 2,
        baseline_dirty: count,
        baseline_in_scope: count,
        baseline_out_of_scope: count,
        live_status: 'mismatch',
        live_changes: {
          task_scope_content: count,
          ambient: count,
          index_content: count,
          delivery_state: count,
          sample_limit: count,
          total_count: count,
          returned_count: count,
          sample: changes,
          truncated: false,
        },
        unresolved_violations: count,
      },
      gates: { total: count, pending: 0, stale: 0, pass: count, fail: 0 },
      next_action: {
        kind: 'await_user',
        boundary: 'review',
        reason: 'review_decision',
      },
      unverified_count: count,
      resolution_pending_count: count,
      verification_plan: verificationPlan,
      verification: {
        gate: Object.fromEntries(
          repeated(count, (index) => [`gate-${index}`, verificationPlan[index]]),
        ),
        diagnostic: {},
      },
      artifacts: repeated(count, (index) => ({
        kind: 'doc',
        path: `docs/fixture-${index}.md`,
      })),
      submission: {
        plan_revision: 3,
        work_revision: 2,
        changes: longText,
        verified: longText,
        knowledge_impact: { kind: 'updated', reason: longText },
        unverified_count: count,
        unverified_summary: repeated(count, () => longText),
        unverified_items_summary: bounded(repeated(count, item)),
      },
      closure: {
        changes: longText,
        verified: longText,
        unverified_count: count,
        resolution_summary: repeated(count, () => longText),
        closeout_summary: {
          resolution_counts: { resolved: count, accepted_risk: 0, followup: 0 },
          resolutions: bounded(repeated(count, item)),
        },
      },
      schema5_view: {
        unverified_items: bounded(repeated(count, item)),
        reviewer_next_action: 'review_or_archive',
        closeout: {
          resolution_counts: { resolved: count, accepted_risk: 0, followup: 0 },
          resolutions: bounded(repeated(count, item)),
          followup_next_action: 'track_followup_items',
        },
      },
    },
    artifact_delivery: repeated(count, (index) => ({
      kind: 'doc',
      path: `docs/fixture-${index}.md`,
      git_status: 'untracked',
    })),
    warnings: repeated(count, () => longText),
    recent_events: repeated(count, (index) => ({
      type: 'decision_recorded',
      task_id: `event-${index}`,
      reason: longText,
    })),
    timeline: repeated(count, (index) => ({
      event_type: 'decision_recorded',
      title: longText,
      summary: longText,
      next_action: longText,
      revision: index + 1,
    })),
  }
}

test('normative maximum fixture stays within every bounded Context budget', () => {
  for (const view of ['status', 'review', 'brief']) {
    const input = makeMaximumContext()
    if (view === 'status') {
      for (const key of [
        'goal', 'scope', 'acceptance', 'approach', 'user_flow',
        'open_questions', 'verification_plan', 'verification', 'artifacts',
        'submission', 'closure', 'schema5_view',
      ]) delete input.task[key]
      delete input.recent_events
      delete input.timeline
    } else if (view === 'review') {
      for (const key of [
        'user_flow', 'open_questions', 'verification', 'artifacts',
      ]) delete input.task[key]
      delete input.recent_events
      delete input.timeline
    } else {
      for (const key of ['approach', 'user_flow']) delete input.task[key]
    }
    const projected = projectBoundedContext(input, view)
    assert.equal(projected.schema_version, 3)
    assert.equal(typeof projected.task.next_action, 'object')
    assert.ok(
      contextJsonByteLength(projected) <= CONTEXT_VIEW_BYTE_BUDGETS[view],
      `${view} exceeds byte budget`,
    )
    assert.equal(projected.truncation.applied, true)
    assert.ok(projected.truncation.fields.length <= fixture.truncation_metadata_limit)
    for (const field of projected.truncation.fields)
      assert.match(field.path, /^(identity|writer|plan_text|gates|submission|closeout|shared_worktree|live_changes|artifact_delivery|warnings|error|misc)$/)

    const limits = CONTEXT_VIEW_COLLECTION_LIMITS[view]
    assert.ok(projected.task.shared_worktree.sample.length <= limits.sharedWorktree)
    assert.ok(projected.task.workspace_proof.live_changes.sample.length <= limits.liveChanges)
    assert.ok(projected.artifact_delivery.length <= limits.artifactDelivery)
    assert.ok(projected.warnings.length <= limits.warnings)
  }
})

test('projection truncates UTF-8 on code-point boundaries and preserves task identity', () => {
  const input = makeMaximumContext()
  for (const key of [
    'goal', 'scope', 'acceptance', 'approach', 'user_flow',
    'open_questions', 'verification_plan', 'verification', 'artifacts',
    'submission', 'closure', 'schema5_view',
  ]) delete input.task[key]
  delete input.recent_events
  delete input.timeline
  input.task.title = '界'.repeat(400)
  input.task.id = 'fixture-id'
  const projected = projectBoundedContext(input, 'status')
  assert.equal(projected.task.id, 'fixture-id')
  assert.ok(Buffer.byteLength(projected.task.title, 'utf8') <= 256)
  assert.equal(
    Buffer.from(projected.task.title, 'utf8').toString('utf8'),
    projected.task.title,
  )
})
