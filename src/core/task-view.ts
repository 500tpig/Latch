import type { TaskStoreV2 } from './task-store.js'
import {
  currentTaskIdV2,
  listGroupTasksV3,
  listTasksV2,
  taskEventLogV2,
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

function taskSummary(task: TaskV2, brief: boolean, grouped = false) {
  if (brief)
    return {
      id: task.id,
      title: task.title,
      phase: task.phase,
      revision: task.revision,
      provenance: task.provenance ?? 'clean',
      ...(grouped
        ? {
            profile: task.profile ?? 'standard',
            group_id: task.group_id,
            blocked: Boolean(task.blocked),
            ...(task.outcome ? { outcome: task.outcome } : {}),
          }
        : task.blocked
          ? { blocked: task.blocked }
          : {}),
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
    provenance: task.provenance ?? 'clean',
    ...(task.group_id !== undefined ? { group_id: task.group_id } : {}),
    ...(grouped
      ? {
          blocked: Boolean(task.blocked),
          ...(task.outcome ? { outcome: task.outcome } : {}),
        }
      : task.blocked
        ? { blocked: task.blocked }
        : {}),
    created_at: task.created_at,
    updated_at: task.updated_at,
  }
}

type GroupListOptions = {
  groupId?: string
  includeArchive?: boolean
}

function byPhase(tasks: TaskV2[]) {
  const counts: Partial<Record<TaskV2['phase'], number>> = {}
  for (const phase of ['plan', 'dev', 'check', 'review'] as const) {
    const count = tasks.filter((task) => task.phase === phase).length
    if (count > 0) counts[phase] = count
  }
  return counts
}

export function listJsonV2(
  store: TaskStoreV2,
  actor: string,
  brief: boolean,
  options: GroupListOptions = {},
) {
  const currentTaskId = currentTaskIdV2(store, actor)
  if (options.groupId !== undefined) {
    const members = listGroupTasksV3(
      store,
      options.groupId,
      Boolean(options.includeArchive),
    )
    const tasks = [...members.open, ...members.archived].sort((left, right) =>
      left.created_at.localeCompare(right.created_at),
    )
    return {
      ...jsonEnvelopeV2(),
      ...(currentTaskId ? { current_task_id: currentTaskId } : {}),
      tasks: tasks.map((task) => taskSummary(task, brief, true)),
      group: {
        group_id: options.groupId,
        open_count: members.open.length,
        by_phase: byPhase(members.open),
        blocked_count: members.open.filter((task) => task.blocked).length,
        ...(options.includeArchive
          ? {
              done_archived_count: members.archived.filter(
                (task) => task.outcome === 'done',
              ).length,
            }
          : {}),
      },
    }
  }
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
    provenance: task.provenance ?? 'clean',
    ...(task.group_id !== undefined ? { group_id: task.group_id } : {}),
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

function pathHints(task: TaskV2) {
  const basisPaths =
    task.work_basis?.kind === 'implementation_authorization' &&
    task.work_basis.plan_revision === task.plan_revision
      ? task.work_basis.scope.paths ?? []
      : []
  return [...new Set([
    ...basisPaths,
    ...task.artifacts.map((artifact) => artifact.path),
  ])].slice(0, 5)
}

function groupContext(store: TaskStoreV2, task: TaskV2) {
  if (task.group_id === undefined) return undefined
  const members = listGroupTasksV3(store, task.group_id, true)
  const all = [...members.open, ...members.archived].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  )
  const siblings = all.filter((member) => member.id !== task.id)
  return {
    group_id: task.group_id,
    member_count: all.length,
    siblings: siblings.slice(0, 20).map((sibling) => ({
      task_id: sibling.id,
      title: sibling.title,
      phase: sibling.phase,
      blocked: Boolean(sibling.blocked),
      path_hints: pathHints(sibling),
    })),
    truncated: siblings.length > 20,
  }
}

export function contextJsonV2(
  store: TaskStoreV2,
  task: TaskV2,
  actor: string,
  brief: boolean,
) {
  const eventLog = taskEventLogV2(store, task.id)
  const events = eventLog.events
  const group = groupContext(store, task)
  return {
    ...jsonEnvelopeV2(),
    current: currentTaskIdV2(store, actor) === task.id,
    task: brief ? briefTask(task) : task,
    recent_events: brief ? events.slice(-5) : events,
    history_incomplete: taskHistoryIncompleteV2(store, task.id, events),
    ...(eventLog.warnings.length > 0 ? { warnings: eventLog.warnings } : {}),
    ...(group ? { group } : {}),
  }
}

export function listHumanV2(
  store: TaskStoreV2,
  actor: string,
  options: GroupListOptions = {},
) {
  const members = options.groupId !== undefined
    ? listGroupTasksV3(store, options.groupId, Boolean(options.includeArchive))
    : undefined
  const tasks = members
    ? [...members.open, ...members.archived]
    : listTasksV2(store)
  if (tasks.length === 0) return 'No open Latch v2 tasks.'
  const currentTaskId = currentTaskIdV2(store, actor)
  const lines = tasks
    .map((task) => {
      const marker = task.id === currentTaskId ? '*' : ' '
      const blocked = task.blocked ? ` blocked: ${task.blocked.reason}` : ''
      const outcome = task.outcome ? ` ${task.outcome}` : ''
      return `${marker} ${task.id}  ${task.phase}${outcome}  r${task.revision}  ${task.title}${blocked}`
    })
  if (!members) return lines.join('\n')
  const archived = options.includeArchive
    ? `, ${members.archived.filter((task) => task.outcome === 'done').length} done archived`
    : ''
  return [
    `Group ${options.groupId}: ${members.open.length} open, ${members.open.filter((task) => task.blocked).length} blocked${archived}`,
    ...lines,
  ].join('\n')
}

export function contextHumanV2(
  store: TaskStoreV2,
  task: TaskV2,
  actor: string,
) {
  const current = currentTaskIdV2(store, actor) === task.id
  const eventLog = taskEventLogV2(store, task.id)
  const historyIncomplete = taskHistoryIncompleteV2(
    store,
    task.id,
    eventLog.events,
  )
  const group = groupContext(store, task)
  const lines = [
    `Task: ${task.id}`,
    `Title: ${task.title}`,
    `Phase: ${task.phase}`,
    `Revision: ${task.revision}`,
    `Plan revision: ${task.plan_revision}`,
    `Work revision: ${task.work_revision}`,
    `Profile: ${task.profile ?? 'standard'}`,
    ...(task.group_id !== undefined ? [`Group: ${task.group_id}`] : []),
    `Current: ${current ? 'yes' : 'no'}`,
    `Goal: ${task.plan.goal}`,
    `Scope: ${task.plan.scope.join(' | ') || '-'}`,
    `Acceptance: ${task.plan.acceptance.join(' | ') || '-'}`,
    `Open questions: ${task.plan.open_questions.join(' | ') || '-'}`,
    `Artifacts: ${task.artifacts.map((item) => `${item.kind}:${item.path}`).join(' | ') || '-'}`,
    `History incomplete: ${historyIncomplete ? 'yes' : 'no'}`,
    ...eventLog.warnings.map((warning) => `Warning: ${warning}`),
  ]
  if (task.blocked) {
    lines.push(`Blocked: ${task.blocked.reason}`)
    lines.push(`Waiting for: ${task.blocked.waiting_for}`)
  }
  if (group) {
    lines.push(`Group members: ${group.member_count}`)
    for (const sibling of group.siblings) {
      const blocked = sibling.blocked ? ' blocked' : ''
      const paths = sibling.path_hints.length > 0
        ? ` paths: ${sibling.path_hints.join(', ')}`
        : ''
      lines.push(
        `Sibling: ${sibling.task_id} ${sibling.phase}${blocked} ${sibling.title}${paths}`,
      )
    }
    if (group.truncated) lines.push('Group siblings: truncated')
  }
  return lines.join('\n')
}
