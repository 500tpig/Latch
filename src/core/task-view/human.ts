import type { ContextTaskReadV2, TaskStoreV2 } from '../task-store.js'
import { currentTaskIdV2, listGroupTasksV3, listTasksV2, taskHistoryIncompleteForTaskV2 } from '../task-store.js'
import type { TaskV2 } from '../types.js'
import type { WorkspaceLiveStatus } from '../progress/shared.js'
import { schema5DetailView } from './closeout.js'
import { groupContext, workspaceProofView } from './list-status.js'
import type { GroupListOptions } from './list-status.js'
import { concise } from './shared.js'

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

function schema5HumanLines(task: TaskV2, liveStatus?: WorkspaceLiveStatus) {
  const view = schema5DetailView(task, liveStatus)
  if (!view) return []
  const lines = [
    `Unverified items: ${view.unverified_items.total} ` +
      `(sample_limit=${view.unverified_items.sample_limit}, ` +
      `sample_count=${view.unverified_items.sample.length}, ` +
      `truncated=${view.unverified_items.truncated ? 'yes' : 'no'})`,
    `Pending closeout resolutions: ${task.closure ? 0 : view.unverified_items.total}`,
    `Reviewer next action: ${view.reviewer_next_action}`,
  ]
  for (const item of view.unverified_items.sample)
    lines.push(`Unverified item: ${item.item_id} ${concise(item.summary)}`)
  const closeout = view.closeout
  if (closeout) {
    lines.push(
      `Closeout outcomes: resolved=${closeout.resolution_counts.resolved}, ` +
        `accepted_risk=${closeout.resolution_counts.accepted_risk}, ` +
        `followup=${closeout.resolution_counts.followup}`,
    )
    lines.push(
      `Closeout resolutions: ${closeout.resolutions.total} ` +
        `(sample_limit=${closeout.resolutions.sample_limit}, ` +
        `sample_count=${closeout.resolutions.sample.length}, ` +
        `truncated=${closeout.resolutions.truncated ? 'yes' : 'no'})`,
    )
    for (const resolution of closeout.resolutions.sample)
      lines.push(
        `Closeout resolution: ${resolution.item_id} ${resolution.outcome} ` +
          `${resolution.summary}`,
      )
    if ('followup_next_action' in closeout)
      lines.push(`Follow-up next action: ${closeout.followup_next_action}`)
    if ('no_followup_reason' in closeout)
      lines.push(`No follow-up reason: ${closeout.no_followup_reason}`)
  }
  return lines
}

export function contextHumanV2(
  store: TaskStoreV2,
  context: ContextTaskReadV2,
  actor: string,
) {
  const { task, eventLog } = context
  const current = currentTaskIdV2(store, actor) === task.id
  const historyIncomplete = taskHistoryIncompleteForTaskV2(task, eventLog.events)
  const group = groupContext(store, task)
  const workspaceProof = workspaceProofView(store, task, context.archived)
  const lines = [
    `Task: ${task.id}`,
    `Title: ${task.title}`,
    ...(context.archived
      ? [
          'Archived: yes',
          `Outcome: ${task.outcome}`,
          `Last open phase: ${task.phase}`,
        ]
      : []),
    `Phase: ${task.phase}`,
    `Revision: ${task.revision}`,
    `Plan revision: ${task.plan_revision}`,
    `Work revision: ${task.work_revision}`,
    `Task schema: ${task.schema_version}`,
    ...(context.archived && task.schema_version < 5
      ? ['Historical schema: yes']
      : []),
    `Minimum writer: ${task.min_writer_version ?? '-'}`,
    `Schema upgrade required: ${task.schema_version === 3 ? 'yes' : 'no'}`,
    `Profile: ${task.profile ?? 'standard'}`,
    ...(task.group_id !== undefined ? [`Group: ${task.group_id}`] : []),
    ...(task.source_record !== undefined
      ? [`Source Record: ${task.source_record.record_id} r${task.source_record.revision}`]
      : []),
    `Current: ${current ? 'yes' : 'no'}`,
    `Goal: ${task.plan.goal}`,
    `Scope: ${task.plan.scope.join(' | ') || '-'}`,
    `Workspace scope: ${task.plan.workspace_scope?.paths.join(' | ') || '-'}`,
    `Acceptance: ${task.plan.acceptance.join(' | ') || '-'}`,
    `Open questions: ${task.plan.open_questions.join(' | ') || '-'}`,
    ...schema5HumanLines(task, workspaceProof?.live_status),
    `Artifacts: ${task.artifacts.map((item) => `${item.kind}:${item.path}`).join(' | ') || '-'}`,
    `History incomplete: ${historyIncomplete ? 'yes' : 'no'}`,
    ...(workspaceProof
      ? [
          `Proof generation: ${workspaceProof.generation}`,
          `Workspace live status: ${workspaceProof.live_status}`,
          `Unresolved workspace violations: ${workspaceProof.unresolved_violations}`,
        ]
      : []),
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
