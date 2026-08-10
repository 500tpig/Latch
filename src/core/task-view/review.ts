import type { TaskStoreV2 } from '../task-store.js'
import type { TaskV2 } from '../types.js'
import {
  briefClosure,
  briefSubmission,
  schema5DetailView,
} from './closeout.js'
import {
  briefVerificationPlan,
  statusTask,
} from './list-status.js'

export function reviewTask(
  store: TaskStoreV2,
  task: TaskV2,
  actor: string,
  archived = false,
) {
  const status = statusTask(store, task, actor, archived)
  const schema5View = schema5DetailView(
    task,
    status.workspace_proof?.live_status,
  )
  return {
    ...status,
    goal: task.plan.goal,
    ...(task.plan.workspace_scope
      ? { workspace_scope: task.plan.workspace_scope }
      : {}),
    scope: task.plan.scope,
    acceptance: task.plan.acceptance,
    verification_plan: briefVerificationPlan(
      task,
      archived ? undefined : status.workspace_proof?.live_status,
    ),
    ...(task.submission ? { submission: briefSubmission(task) } : {}),
    ...(task.closure ? { closure: briefClosure(task) } : {}),
    ...(schema5View ? { schema5_view: schema5View } : {}),
    updated_at: task.updated_at,
  }
}
