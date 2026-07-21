import { TASK_EVENT_TYPES } from './types.js'
import type { TaskEvent, TaskV2 } from './types.js'

const v2EventTypes = new Set<string>(TASK_EVENT_TYPES)

function downgradeApproval(task: TaskV2) {
  if (task.work_basis?.kind === 'implementation_authorization') {
    return {
      approved_plan_revision: task.work_basis.plan_revision,
      approved_at: task.work_basis.authorized_at,
      source: 'user' as const,
      reason: task.work_basis.reason || 'downgraded from v3',
    }
  }
  if (task.work_basis?.kind === 'retrospective_record') return undefined
  return task.implementation_approval
    ? structuredClone(task.implementation_approval)
    : undefined
}

export function downgradeTaskValue(task: TaskV2): TaskV2 {
  const approval = downgradeApproval(task)
  const submission = task.submission
    ? {
        work_revision: task.submission.work_revision,
        changes: task.submission.changes,
        verified: task.submission.verified,
        unverified: task.submission.unverified,
        ...(task.submission.no_verify
          ? { no_verify: structuredClone(task.submission.no_verify) }
          : {}),
        submitted_at: task.submission.submitted_at,
      }
    : undefined
  return {
    schema_version: 2,
    id: task.id,
    title: task.title,
    phase: task.phase,
    ...(task.outcome ? { outcome: task.outcome } : {}),
    revision: task.revision,
    plan_revision: task.plan_revision,
    work_revision: task.work_revision,
    workspace_root: task.workspace_root,
    plan: structuredClone(task.plan),
    ...(approval ? { implementation_approval: approval } : {}),
    ...(task.blocked ? { blocked: structuredClone(task.blocked) } : {}),
    verification: structuredClone(task.verification),
    ...(submission ? { submission } : {}),
    ...(task.closure ? { closure: structuredClone(task.closure) } : {}),
    artifacts: structuredClone(task.artifacts),
    created_at: task.created_at,
    updated_at: task.updated_at,
  }
}

export function downgradeTaskEvents(events: TaskEvent[]): TaskEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => v2EventTypes.has(event.type))
    .sort((left, right) =>
      left.event.created_at.localeCompare(right.event.created_at) ||
      left.index - right.index,
    )
    .map(({ event }, index) => ({
      event: structuredClone(event),
      revision: index + 1,
    }))
    .map(({ event, revision }) => {
      if (
        event.type === 'review_feedback' &&
        event.classification === 'non_implementation_correction'
      )
        event.classification = 'evaluative'
      return { ...event, revision }
    })
}
