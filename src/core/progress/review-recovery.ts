import {
  assertTaskWritableV2,
  updateTaskV4,
} from '../task-store.js'
import type { TaskStoreV2, TaskWriteResultV2 } from '../task-store.js'
import {
  currentWorkspaceLiveStatus,
  hasValidImplementationAuthorization,
  requireText,
  sharedWorktreeWarnings,
  submissionProofStatus,
  withWarnings,
} from './shared.js'

export type ReopenReviewTaskV3Input = {
  expectRevision: number
  actor: string
  reason: string
}

export function reopenReviewTaskV3(
  store: TaskStoreV2,
  id: string,
  input: ReopenReviewTaskV3Input,
): TaskWriteResultV2 {
  const reason = requireText(input.reason, '--reason is required.')
  const current = assertTaskWritableV2(
    store,
    id,
    input.actor,
    input.expectRevision,
  )
  if (current.schema_version !== 5)
    throw new Error('Reopen review requires schema_version 5.')
  if (current.blocked) throw new Error(`Task is blocked: ${current.blocked.reason}`)
  if (current.phase !== 'review')
    throw new Error('Reopen review requires a task in review.')
  if (!current.submission)
    throw new Error('Reopen review requires an existing submission.')
  if (!hasValidImplementationAuthorization(current))
    throw new Error(
      'Reopen review requires a valid implementation authorization; retrospective work cannot be reopened.',
    )
  const liveStatus = currentWorkspaceLiveStatus(store, current)
  if (submissionProofStatus(current, liveStatus) !== 'stale')
    throw new Error('Reopen review requires stale submission proof.')

  const workRevision = current.work_revision + 1
  return withWarnings(updateTaskV4(store, current.id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    events: [
      {
        type: 'decision_recorded',
        fields: {
          plan_revision: current.plan_revision,
          question: '为何恢复已失效的 review submission？',
          answer: reason,
          conclusion: 'Submission proof 已失效，任务返回 dev 并开启新的工作轮次。',
        },
      },
      { type: 'work_started', fields: { work_revision: workRevision } },
    ],
    update(task) {
      task.work_revision = workRevision
      task.phase = 'dev'
      delete task.submission
    },
  }), sharedWorktreeWarnings(store, current.id))
}
