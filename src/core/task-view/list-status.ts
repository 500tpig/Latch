import { isWritableActor } from '../actor.js'
import {
  currentWorkspaceLiveAssessment,
  submissionProofStatus,
  type WorkspaceLiveStatus,
} from '../progress/shared.js'
import type { ContextTaskReadV2, TaskStoreV2 } from '../task-store.js'
import { currentTaskIdV2, listGroupTasksV3, listTasksV2 } from '../task-store.js'
import type { TaskV2 } from '../types.js'
import { briefClosure, briefSubmission, schema5DetailView, schema5UnverifiedItems } from './closeout.js'
import { jsonEnvelopeV2 } from './shared.js'
import type { ContextHistoryView } from './timeline.js'

function taskSummary(task: TaskV2, brief: boolean, grouped = false) {
  if (brief)
    return {
      id: task.id,
      title: task.title,
      task_schema_version: task.schema_version,
      ...(task.min_writer_version
        ? { min_writer_version: task.min_writer_version }
        : {}),
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
    task_schema_version: task.schema_version,
    ...(task.min_writer_version
      ? { min_writer_version: task.min_writer_version }
      : {}),
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

export type GroupListOptions = {
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

export function briefVerificationPlan(
  task: TaskV2,
  liveStatus?: WorkspaceLiveStatus,
) {
  return task.plan.verification_plan.map((item) => {
    const result = task.verification[item.kind][item.name]
    let staleReason: VerifyStaleReason | undefined
    const status = !result
      ? 'pending'
      : result.work_revision !== task.work_revision
        ? ((staleReason = 'work_revision_changed'), 'stale')
        : item.kind === 'gate' &&
            result.proof?.ended_generation !== task.workspace_proof?.generation
          ? ((staleReason = 'proof_generation_changed'), 'stale')
          : item.kind === 'gate' &&
              result.status === 'pass' &&
              liveStatus === 'mismatch'
            ? ((staleReason = 'workspace_baseline_mismatch'), 'stale')
            : item.kind === 'gate' &&
                result.status === 'pass' &&
                liveStatus === 'unknown'
              ? ((staleReason = 'workspace_baseline_mismatch'), 'stale')
            : item.kind === 'gate' &&
                result.status === 'pass' &&
                (task.workspace_proof?.unresolved_violations.length ?? 0) > 0
              ? ((staleReason = 'unresolved_scope_violation'), 'stale')
          : result.status

    return {
      ...item,
      status,
      ...(staleReason ? { stale_reason: staleReason } : {}),
    }
  })
}

type VerifyStaleReason =
  | 'work_revision_changed'
  | 'proof_generation_changed'
  | 'workspace_baseline_mismatch'
  | 'unresolved_scope_violation'

export function workspaceProofView(
  store: TaskStoreV2,
  task: TaskV2,
  archived: boolean,
) {
  if (!task.workspace_proof) return undefined
  const liveAssessment = archived
    ? undefined
    : currentWorkspaceLiveAssessment(store, task)
  const liveStatus = archived ? 'unknown' : (liveAssessment?.status ?? 'unknown')
  return {
    generation: task.workspace_proof.generation,
    baseline_dirty:
      task.workspace_proof.baseline_counts.tracked_dirty +
      task.workspace_proof.baseline_counts.untracked +
      task.workspace_proof.baseline_counts.explicit_ignored,
    baseline_out_of_scope: task.workspace_proof.baseline_counts.out_of_scope,
    live_status: liveStatus,
    ...(liveAssessment ? { live_changes: liveAssessment.changes } : {}),
    unresolved_violations:
      task.workspace_proof.unresolved_violations.length,
  }
}

function authorizationState(task: TaskV2) {
  if (task.work_basis) {
    const valid =
      task.work_basis.plan_revision === task.plan_revision &&
      (task.work_basis.kind === 'implementation_authorization' ||
        task.work_basis.work_revision === task.work_revision)
    return {
      kind: task.work_basis.kind,
      status: valid ? 'valid' : 'stale',
      source:
        task.work_basis.kind === 'implementation_authorization'
          ? task.work_basis.source
          : 'retrospective',
      reason: task.work_basis.reason,
    }
  }
  if (task.implementation_approval) {
    return {
      kind: 'legacy_approval',
      status:
        task.implementation_approval.approved_plan_revision === task.plan_revision
          ? 'valid'
          : 'stale',
      source: task.implementation_approval.source,
      reason: task.implementation_approval.reason,
    }
  }
  return { kind: 'none', status: 'missing' }
}

function writerState(task: TaskV2, actor: string) {
  const callerCapability = isWritableActor(actor) ? 'writable' : 'read_only'
  const taskStatus = task.schema_version === 3
    ? 'schema_upgrade_required'
    : task.primary_writer
      ? 'assigned'
      : 'legacy_unclaimed'
  const status =
    callerCapability === 'read_only'
      ? 'read_only_actor'
      : taskStatus === 'legacy_unclaimed'
        ? 'legacy_unclaimed'
        : task.primary_writer === actor
          ? 'primary_writer'
          : 'writer_mismatch'
  return {
    ...(task.primary_writer ? { primary_writer: task.primary_writer } : {}),
    task_status: taskStatus,
    caller: actor,
    caller_capability: callerCapability,
    status,
  }
}

function gateSummary(
  task: TaskV2,
  liveStatus?: WorkspaceLiveStatus,
) {
  const statuses = briefVerificationPlan(task, liveStatus)
    .filter((item) => item.kind === 'gate')
    .map((item) => item.status)
  return {
    total: statuses.length,
    pending: statuses.filter((status) => status === 'pending').length,
    stale: statuses.filter((status) => status === 'stale').length,
    pass: statuses.filter((status) => status === 'pass').length,
    fail: statuses.filter((status) => status === 'fail').length,
  }
}

function ownedNextAction(task: TaskV2, liveStatus?: WorkspaceLiveStatus) {
  if (task.blocked) return 'unblock'
  if (task.phase === 'plan')
    return task.plan.open_questions.length > 0
      ? 'resolve_open_questions'
      : 'approve'
  if (task.phase === 'review') {
    if (submissionProofStatus(task, liveStatus) === 'stale')
      return 'reopen_review'
    return schema5UnverifiedItems(task).length > 0
      ? 'prepare_closeout'
      : 'review_or_archive'
  }
  const gates = gateSummary(task, liveStatus)
  return gates.total > 0 && gates.pass !== gates.total ? 'verify' : 'submit'
}

function nextAction(
  task: TaskV2,
  actor: string,
  liveStatus?: WorkspaceLiveStatus,
) {
  const writer = writerState(task, actor)
  if (writer.caller_capability === 'read_only') return 'read_only'
  if (writer.task_status === 'legacy_unclaimed') return 'claim'
  if (writer.task_status === 'schema_upgrade_required')
    return writer.status === 'primary_writer' ? 'upgrade_v4' : 'read_only'
  if (writer.status === 'writer_mismatch') return 'takeover'
  return ownedNextAction(task, liveStatus)
}

export function statusTask(
  store: TaskStoreV2,
  task: TaskV2,
  actor: string,
  archived = false,
) {
  const workspaceProof = workspaceProofView(store, task, archived)
  const unverifiedItems = schema5UnverifiedItems(task)
  const writer = writerState(task, actor)
  return {
    id: task.id,
    title: task.title,
    task_schema_version: task.schema_version,
    ...(task.min_writer_version
      ? { min_writer_version: task.min_writer_version }
      : {}),
    ...(task.schema_version === 3 ? { upgrade_required: true } : {}),
    phase: task.phase,
    revision: task.revision,
    plan_revision: task.plan_revision,
    work_revision: task.work_revision,
    profile: task.profile ?? 'standard',
    provenance: task.provenance ?? 'clean',
    ...(task.blocked ? { blocked: task.blocked } : {}),
    authorization: authorizationState(task),
    writer,
    ...(workspaceProof ? { workspace_proof: workspaceProof } : {}),
    gates: gateSummary(
      task,
      archived ? undefined : workspaceProof?.live_status,
    ),
    ...(task.schema_version === 5
      ? {
          unverified_count: unverifiedItems.length,
          resolution_pending_count: task.closure ? 0 : unverifiedItems.length,
        }
      : {}),
    next_action: archived
      ? 'read_only'
      : nextAction(task, actor, workspaceProof?.live_status),
    ...(!archived &&
    task.schema_version === 5 &&
    writer.status === 'writer_mismatch' &&
    task.phase === 'review' &&
    submissionProofStatus(task, workspaceProof?.live_status) === 'stale'
      ? {
          after_takeover_next_action: 'reopen_review',
        }
      : {}),
    updated_at: task.updated_at,
  }
}

export function fullTask(task: TaskV2, liveStatus?: WorkspaceLiveStatus) {
  const schema5View = schema5DetailView(task, liveStatus)
  return schema5View
    ? {
        ...task,
        schema5_view: schema5View,
      }
    : task
}

export function briefTask(store: TaskStoreV2, task: TaskV2, archived = false) {
  const workspaceProof = workspaceProofView(store, task, archived)
  const schema5View = schema5DetailView(task, workspaceProof?.live_status)
  return {
    id: task.id,
    title: task.title,
    task_schema_version: task.schema_version,
    ...(task.min_writer_version
      ? { min_writer_version: task.min_writer_version }
      : {}),
    ...(task.schema_version === 3 ? { upgrade_required: true } : {}),
    phase: task.phase,
    revision: task.revision,
    plan_revision: task.plan_revision,
    work_revision: task.work_revision,
    profile: task.profile ?? 'standard',
    provenance: task.provenance ?? 'clean',
    ...(task.group_id !== undefined ? { group_id: task.group_id } : {}),
    ...(task.source_record !== undefined
      ? {
          source_record: {
            record_id: task.source_record.record_id,
            revision: task.source_record.revision,
          },
        }
      : {}),
    goal: task.plan.goal,
    ...(task.plan.workspace_scope
      ? { workspace_scope: task.plan.workspace_scope }
      : {}),
    scope: task.plan.scope,
    acceptance: task.plan.acceptance,
    open_questions: task.plan.open_questions,
    ...(task.implementation_approval
      ? { implementation_approval: task.implementation_approval }
      : {}),
    ...(task.work_basis ? { work_basis: task.work_basis } : {}),
    ...(task.blocked ? { blocked: task.blocked } : {}),
    verification_plan: briefVerificationPlan(
      task,
      archived ? undefined : workspaceProof?.live_status,
    ),
    verification: task.verification,
    ...(workspaceProof ? { workspace_proof: workspaceProof } : {}),
    ...(task.submission ? { submission: briefSubmission(task) } : {}),
    ...(task.closure ? { closure: briefClosure(task) } : {}),
    ...(schema5View ? { schema5_view: schema5View } : {}),
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

export function groupContext(store: TaskStoreV2, task: TaskV2) {
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

export type ContextJsonOptions = {
  brief?: boolean
  review?: boolean
  status?: boolean
  sinceRevision?: number
  history?: ContextHistoryView
}

export function archivedContextMetadata(context: ContextTaskReadV2) {
  return context.archived
    ? {
        archived: true as const,
        outcome: context.task.outcome!,
        last_open_phase: context.task.phase,
        ...(context.task.schema_version < 5 ? { historical_schema: true } : {}),
      }
    : {}
}
