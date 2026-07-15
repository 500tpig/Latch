import type { TaskStoreV2 } from './task-store.js'
import {
  currentTaskIdV2,
  listTasksV2,
  taskEventsV2,
  taskHistoryIncompleteV2,
} from './task-store.js'
import type { TaskV2 } from './types.js'
import { now } from './utils.js'

export type JsonEnvelopeV2 = {
  schema_version: 2
  generated_at: string
}

export function jsonEnvelopeV2(): JsonEnvelopeV2 {
  return {
    schema_version: 2,
    generated_at: now(),
  }
}

function taskSummary(task: TaskV2, brief: boolean) {
  if (brief)
    return {
      id: task.id,
      title: task.title,
      phase: task.phase,
      revision: task.revision,
      ...(task.blocked ? { blocked: task.blocked } : {}),
      updated_at: task.updated_at,
    }

  return {
    id: task.id,
    title: task.title,
    phase: task.phase,
    revision: task.revision,
    plan_revision: task.plan_revision,
    work_revision: task.work_revision,
    profile: task.profile ?? 'standard',
    ...(task.blocked ? { blocked: task.blocked } : {}),
    created_at: task.created_at,
    updated_at: task.updated_at,
  }
}

export function listJsonV2(store: TaskStoreV2, actor: string, brief: boolean) {
  const currentTaskId = currentTaskIdV2(store, actor)
  return {
    ...jsonEnvelopeV2(),
    ...(currentTaskId ? { current_task_id: currentTaskId } : {}),
    tasks: listTasksV2(store).map((task) => taskSummary(task, brief)),
  }
}

function briefVerificationPlan(task: TaskV2) {
  return task.plan.verification_plan.map((item) => {
    const result = task.verification[item.kind][item.name]
    const status = !result
      ? 'pending'
      : result.work_revision !== task.work_revision
        ? 'stale'
        : result.status

    return { ...item, status }
  })
}

function briefTask(task: TaskV2) {
  return {
    id: task.id,
    title: task.title,
    phase: task.phase,
    revision: task.revision,
    plan_revision: task.plan_revision,
    work_revision: task.work_revision,
    profile: task.profile ?? 'standard',
    goal: task.plan.goal,
    scope: task.plan.scope,
    acceptance: task.plan.acceptance,
    open_questions: task.plan.open_questions,
    ...(task.implementation_approval
      ? { implementation_approval: task.implementation_approval }
      : {}),
    ...(task.work_basis ? { work_basis: task.work_basis } : {}),
    ...(task.blocked ? { blocked: task.blocked } : {}),
    verification_plan: briefVerificationPlan(task),
    verification: task.verification,
    ...(task.submission ? { submission: task.submission } : {}),
    artifacts: task.artifacts,
    updated_at: task.updated_at,
  }
}

export function contextJsonV2(
  store: TaskStoreV2,
  task: TaskV2,
  actor: string,
  brief: boolean,
) {
  const events = taskEventsV2(store, task.id)
  return {
    ...jsonEnvelopeV2(),
    current: currentTaskIdV2(store, actor) === task.id,
    task: brief ? briefTask(task) : task,
    recent_events: brief ? events.slice(-5) : events,
    history_incomplete: taskHistoryIncompleteV2(store, task.id),
  }
}

export function listHumanV2(store: TaskStoreV2, actor: string) {
  const tasks = listTasksV2(store)
  if (tasks.length === 0) return 'No open Latch v2 tasks.'
  const currentTaskId = currentTaskIdV2(store, actor)
  return tasks
    .map((task) => {
      const marker = task.id === currentTaskId ? '*' : ' '
      const blocked = task.blocked ? ` blocked: ${task.blocked.reason}` : ''
      return `${marker} ${task.id}  ${task.phase}  r${task.revision}  ${task.title}${blocked}`
    })
    .join('\n')
}

export function contextHumanV2(
  store: TaskStoreV2,
  task: TaskV2,
  actor: string,
) {
  const current = currentTaskIdV2(store, actor) === task.id
  const historyIncomplete = taskHistoryIncompleteV2(store, task.id)
  const lines = [
    `Task: ${task.id}`,
    `Title: ${task.title}`,
    `Phase: ${task.phase}`,
    `Revision: ${task.revision}`,
    `Plan revision: ${task.plan_revision}`,
    `Work revision: ${task.work_revision}`,
    `Profile: ${task.profile ?? 'standard'}`,
    `Current: ${current ? 'yes' : 'no'}`,
    `Goal: ${task.plan.goal}`,
    `Scope: ${task.plan.scope.join(' | ') || '-'}`,
    `Acceptance: ${task.plan.acceptance.join(' | ') || '-'}`,
    `Open questions: ${task.plan.open_questions.join(' | ') || '-'}`,
    `Artifacts: ${task.artifacts.map((item) => `${item.kind}:${item.path}`).join(' | ') || '-'}`,
    `History incomplete: ${historyIncomplete ? 'yes' : 'no'}`,
  ]
  if (task.blocked) {
    lines.push(`Blocked: ${task.blocked.reason}`)
    lines.push(`Waiting for: ${task.blocked.waiting_for}`)
  }
  return lines.join('\n')
}
