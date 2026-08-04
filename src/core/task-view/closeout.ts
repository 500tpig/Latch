import type { CloseoutResolution, TaskV2, UnverifiedItem } from '../types.js'
import { concise, SCHEMA5_VIEW_SAMPLE_LIMIT } from './shared.js'

export function schema5UnverifiedItems(task: TaskV2) {
  if (task.schema_version !== 5) return []
  return task.closure?.unverified_items ?? task.submission?.unverified_items ?? []
}


type BoundedView<T> = {
  total: number
  sample_limit: number
  sample: T[]
  truncated: boolean
}

function boundedView<T>(
  items: T[],
  sampleLimit = SCHEMA5_VIEW_SAMPLE_LIMIT,
): BoundedView<T> {
  return {
    total: items.length,
    sample_limit: sampleLimit,
    sample: items.slice(0, sampleLimit),
    truncated: items.length > sampleLimit,
  }
}

function schema5CloseoutCounts(task: TaskV2) {
  const resolutions = task.schema_version === 5
    ? (task.closure?.resolutions ?? [])
    : []
  return {
    resolved: resolutions.filter((item) => item.outcome === 'resolved').length,
    accepted_risk: resolutions.filter((item) => item.outcome === 'accepted_risk').length,
    followup: resolutions.filter((item) => item.outcome === 'followup').length,
  }
}

function resolutionPreview(resolution: CloseoutResolution) {
  if (resolution.outcome === 'resolved')
    return {
      item_id: resolution.item_id,
      outcome: resolution.outcome,
      summary: concise(resolution.resolution),
    }
  if (resolution.outcome === 'accepted_risk')
    return {
      item_id: resolution.item_id,
      outcome: resolution.outcome,
      summary: concise(resolution.user_acceptance.statement),
      accepted_by: resolution.user_acceptance.accepted_by,
    }
  return {
    item_id: resolution.item_id,
    outcome: resolution.outcome,
    summary: concise(resolution.followup.action),
    owner: resolution.followup.owner.account_uri,
  }
}

function schema5ReviewerNextAction(task: TaskV2) {
  if (task.closure) {
    const counts = schema5CloseoutCounts(task)
    return counts.followup > 0 ? 'track_followup_items' : 'read_only_archive'
  }
  if (task.phase === 'review')
    return schema5UnverifiedItems(task).length > 0
      ? 'prepare_closeout'
      : 'review_or_archive'
  if (task.phase === 'plan') return 'approve'
  return 'verify_or_submit'
}

function schema5CloseoutView(task: TaskV2) {
  const counts = schema5CloseoutCounts(task)
  const resolutions = (task.closure?.resolutions ?? []).map(resolutionPreview)
  return {
    resolution_counts: counts,
    resolutions: boundedView(resolutions),
    ...(counts.followup > 0
      ? { followup_next_action: 'track_followup_items' }
      : { no_followup_reason: 'no_followup_resolution_items' }),
  }
}

export function schema5DetailView(task: TaskV2) {
  if (task.schema_version !== 5) return undefined
  const unverifiedItems: UnverifiedItem[] = schema5UnverifiedItems(task)
  return {
    unverified_items: boundedView(unverifiedItems),
    reviewer_next_action: schema5ReviewerNextAction(task),
    ...(task.closure ? { closeout: schema5CloseoutView(task) } : {}),
  }
}

export function briefSubmission(task: TaskV2) {
  const submission = task.submission
  if (!submission || task.schema_version !== 5) return submission
  const items = submission.unverified_items ?? []
  return {
    plan_revision: submission.plan_revision,
    work_revision: submission.work_revision,
    changes: submission.changes,
    verified: submission.verified,
    unverified_count: items.length,
    unverified_summary: items.slice(0, 3),
    ...(items.length > 3 ? { unverified_truncated: true } : {}),
    unverified_items_summary: boundedView(items),
    ...(submission.knowledge_impact
      ? { knowledge_impact: submission.knowledge_impact }
      : {}),
    ...(submission.no_verify ? { no_verify: submission.no_verify } : {}),
    submitted_at: submission.submitted_at,
  }
}

export function briefClosure(task: TaskV2) {
  const closure = task.closure
  if (!closure || task.schema_version !== 5) return closure
  const resolutions = closure.resolutions ?? []
  return {
    changes: closure.changes,
    verified: closure.verified,
    unverified_count: closure.unverified_items?.length ?? 0,
    resolution_counts: schema5CloseoutCounts(task),
    resolution_summary: resolutions.slice(0, 3),
    ...(resolutions.length > 3 ? { resolutions_truncated: true } : {}),
    closeout_summary: schema5CloseoutView(task),
    accepted_at: closure.accepted_at,
  }
}
