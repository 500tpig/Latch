import type {
  ContextTaskReadV2,
  TaskStoreV2,
} from './task-store.js'
import { isWritableActor } from './actor.js'
import {
  artifactDelivery,
  artifactWarnings,
} from './artifact-status.js'
import {
  currentTaskIdV2,
  listGroupTasksV3,
  listTasksV2,
  taskHistoryIncompleteForTaskV2,
} from './task-store.js'
import type { TaskEvent, TaskV2 } from './types.js'
import { now } from './utils.js'
import {
  captureWorkspaceSnapshot,
  compareWorkspaceSnapshots,
  readWorkspaceEvidence,
} from './workspace-evidence.js'
import type { WorkspaceSnapshot } from './types.js'
import { join } from 'node:path'

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

function schema5UnverifiedItems(task: TaskV2) {
  if (task.schema_version !== 5) return []
  return task.closure?.unverified_items ?? task.submission?.unverified_items ?? []
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

function briefSubmission(task: TaskV2) {
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
    ...(submission.knowledge_impact
      ? { knowledge_impact: submission.knowledge_impact }
      : {}),
    ...(submission.no_verify ? { no_verify: submission.no_verify } : {}),
    submitted_at: submission.submitted_at,
  }
}

function briefClosure(task: TaskV2) {
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
    accepted_at: closure.accepted_at,
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

function briefVerificationPlan(
  task: TaskV2,
  liveStatus?: 'match' | 'mismatch' | 'unknown',
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

function workspaceProofView(
  store: TaskStoreV2,
  task: TaskV2,
  archived: boolean,
) {
  if (!task.workspace_proof) return undefined
  let liveStatus: 'match' | 'mismatch' | 'unknown' = 'unknown'
  if (!archived && task.plan.workspace_scope) {
    const live = captureWorkspaceSnapshot(
      store.paths.workspaceRoot,
      task.plan.workspace_scope,
      task.artifacts,
    )
    if (live.complete) {
      try {
        const baseline = readWorkspaceEvidence<WorkspaceSnapshot>(
          join(store.paths.tasksDir, task.id),
          task.workspace_proof.baseline_ref,
        )
        const directory = join(store.paths.tasksDir, task.id)
        for (const gate of task.plan.verification_plan.filter(
          (item) => item.kind === 'gate',
        )) {
          const result = task.verification.gate[gate.name]
          if (
            result?.status !== 'pass' ||
            result.work_revision !== task.work_revision ||
            result.proof?.ended_generation !== task.workspace_proof.generation
          )
            continue
          if (!result.proof)
            throw new Error(`Gate ${gate.name} has no workspace proof.`)
          readWorkspaceEvidence(directory, result.proof.before_ref)
          readWorkspaceEvidence(directory, result.proof.after_ref)
          readWorkspaceEvidence(directory, result.proof.delta_ref)
        }
        liveStatus =
          compareWorkspaceSnapshots(
            baseline,
            live,
            task.plan.workspace_scope,
          ).status === 'unchanged'
            ? 'match'
            : 'mismatch'
      } catch {
        liveStatus = 'unknown'
      }
    }
  }
  return {
    generation: task.workspace_proof.generation,
    baseline_dirty:
      task.workspace_proof.baseline_counts.tracked_dirty +
      task.workspace_proof.baseline_counts.untracked +
      task.workspace_proof.baseline_counts.explicit_ignored,
    baseline_out_of_scope: task.workspace_proof.baseline_counts.out_of_scope,
    live_status: liveStatus,
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
  liveStatus?: 'match' | 'mismatch' | 'unknown',
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

type TimelineEvent = {
  revision: number
  created_at: string
  event_type: string
  title: string
  summary: string
  impact: string
  next_action?: string
  details: Record<string, unknown>
}

export type ContextHistoryView = 'timeline' | 'events' | 'both'

function concise(value: string, limit = 160) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= limit) return compact
  return `${compact.slice(0, limit - 1).trimEnd()}…`
}

function detailValue(
  event: TaskEvent,
  key: string,
): string | number | boolean | string[] | undefined {
  const value = (event as Record<string, unknown>)[key]
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string')
  )
    return value
  return undefined
}

function details(
  event: TaskEvent,
  keys: string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = { event_type: event.type }
  for (const key of keys) {
    const value = detailValue(event, key)
    if (value !== undefined) output[key] = value
  }
  return output
}

function readableSummary(value: string) {
  return concise(value
    .replace(/\bsubmission knowledge_impact\b/g, '提交记录里的知识影响标记')
    .replace(/\bknowledge_impact\b/g, '知识影响标记')
    .replace(/\bartifact_refs\b/g, '关联交付文件')
    .replace(/\bfrontmatter\b/g, '文档元数据')
    .replace(/\bkind=none\b/g, '无知识影响')
    .replace(/\bkind=updated\b/g, '知识已更新')
    .replace(/\bimplementation_correction\b/g, '实现修正')
    .replace(/\bnon_implementation_correction\b/g, '非实现修正')
    .replace(/\bplan_revision\b/g, '计划版本')
    .replace(/\bwork_revision\b/g, '工作版本'))
}

function feedbackText(event: TaskEvent) {
  if (event.type !== 'review_feedback') return undefined
  const summary = event.summary
  const mentionsKnowledgeImpact =
    /\bknowledge_impact\b/.test(summary) ||
    /\bartifact_refs\b/.test(summary) ||
    /\bkind=none\b/.test(summary)

  if (mentionsKnowledgeImpact) {
    return {
      title: '反馈：修正提交记录',
      summary: '修正提交记录里的知识影响标记。',
      impact:
        event.classification === 'non_implementation_correction'
          ? '实现快照不变，现有验证和提交记录继续有效。'
          : '这类反馈通常不需要重做实现，但当前事件会开启新一轮工作并要求重新提交验收。',
      next_action:
        event.classification === 'non_implementation_correction'
          ? '查看修正后的提交说明。'
          : '按反馈重新提交验收记录。',
    }
  }

  if (event.classification === 'implementation_correction')
    return {
      title: '反馈：需要修正实现',
      summary: readableSummary(summary),
      impact: '任务回到实施阶段，旧提交记录失效。',
      next_action: '完成修正后重新验证并提交验收。',
    }
  if (event.classification === 'non_implementation_correction')
    return {
      title: '反馈：修正说明',
      summary: readableSummary(summary),
      impact: '实现快照不变，现有验证和提交记录继续有效。',
      next_action: '查看更新后的说明。',
    }
  if (event.classification === 'plan_change')
    return {
      title: '反馈：调整计划',
      summary: readableSummary(summary),
      impact: '计划回到待批准状态，旧批准、验证和提交记录失效。',
      next_action: '重新确认计划后再实施。',
    }
  return {
    title: '反馈：记录评价',
    summary: readableSummary(summary),
    impact: '这条记录不直接改变实施状态。',
  }
}

function timelineEvent(task: TaskV2, event: TaskEvent): TimelineEvent {
  const base = {
    revision: event.revision,
    created_at: event.created_at,
    event_type: event.type,
  }
  const technicalDetails = details(event, [
    'plan_revision',
    'work_revision',
    'classification',
    'name',
    'kind',
    'status',
    'exit_code',
    'no_verify',
    'knowledge_impact_kind',
    'unverified_item_ids',
    'unverified_count',
    'resolved_count',
    'accepted_risk_count',
    'followup_count',
    'from',
    'to',
    'reason',
    'generation',
    'from_generation',
    'to_generation',
    'failure_reason',
    'workspace_effect',
    'changed_count',
    'resolution',
    'violation_ids',
  ])

  if (event.type === 'task_created')
    return {
      ...base,
      title: '创建任务',
      summary: `创建「${task.title}」。`,
      impact: '任务进入计划阶段，等待明确批准后实施。',
      next_action: '确认计划。',
      details: technicalDetails,
    }
  if (event.type === 'decision_recorded')
    return {
      ...base,
      title: '记录决定',
      summary: readableSummary(event.conclusion),
      impact: '这条决定会作为后续计划或实施依据。',
      details: details(event, ['plan_revision', 'question', 'answer']),
    }
  if (event.type === 'plan_updated')
    return {
      ...base,
      title: '更新计划',
      summary: '任务计划已更新。',
      impact: '任务回到待批准状态，旧批准、验证和提交记录失效。',
      next_action: '重新确认计划。',
      details: technicalDetails,
    }
  if (event.type === 'implementation_approved')
    return {
      ...base,
      title: '批准实施',
      summary: '用户已批准当前计划。',
      impact: '任务可以开始实施。',
      next_action: '开始实施。',
      details: technicalDetails,
    }
  if (event.type === 'implementation_authorized')
    return {
      ...base,
      title: '授权实施',
      summary: '用户请求已作为本轮实施授权。',
      impact: '任务可以按授权范围实施。',
      next_action: '开始实施。',
      details: technicalDetails,
    }
  if (event.type === 'work_started')
    return {
      ...base,
      title: '开始实施',
      summary: '进入一轮新的实施。',
      impact: '后续检查和提交会绑定这一轮工作。',
      details: technicalDetails,
    }
  if (event.type === 'verification_run') {
    const name = String(detailValue(event, 'name') ?? '检查')
    const status = detailValue(event, 'status') === 'pass' ? '已通过' : '未通过'
    return {
      ...base,
      title: `检查${status}`,
      summary: `${name} ${status}。`,
      impact:
        status === '已通过'
          ? '这项检查可作为当前工作验收依据。'
          : '需要先处理失败原因，再继续提交验收。',
      next_action: status === '已通过' ? undefined : '查看失败输出并修正。',
      details: technicalDetails,
    }
  }
  if (event.type === 'proof_generation_started')
    return {
      ...base,
      title: '建立工作区证明版本',
      summary: `工作区 proof generation ${detailValue(event, 'generation') ?? '-'} 已建立。`,
      impact: 'named gate 只有绑定这个 generation 才能参与提交。',
      details: technicalDetails,
    }
  if (event.type === 'proof_invalidated')
    return {
      ...base,
      title: '工作区证明失效',
      summary: '检测到 covered workspace 与 active baseline 不一致。',
      impact: '旧 named gate proof 已 stale，需要按新 baseline 重新验证。',
      next_action: '重新运行全部 named gate。',
      details: technicalDetails,
    }
  if (event.type === 'workspace_violation_resolved')
    return {
      ...base,
      title: '解决工作区 violation',
      summary: '已通过新 evidence 解决记录的 scope violation。',
      impact: '旧 gate proof 不会自动恢复，仍需重新验证。',
      next_action: '重新运行全部 named gate。',
      details: technicalDetails,
    }
  if (event.type === 'review_feedback') {
    const feedback = feedbackText(event)!
    return {
      ...base,
      ...feedback,
      details: technicalDetails,
    }
  }
  if (event.type === 'submitted')
    return {
      ...base,
      title: '提交验收',
      summary: '本轮工作已提交验收。',
      impact: '任务进入 review，不会自动归档。',
      next_action: '等待用户确认、反馈或归档授权。',
      details: technicalDetails,
    }
  if (event.type === 'submission_knowledge_impact_patched')
    return {
      ...base,
      title: '修正提交记录',
      summary:
        event.operation === 'backfill'
          ? '已补齐提交记录里的知识影响标记。'
          : '已修正提交记录里的知识影响标记。',
      impact: '实现和验证结果不因此改变。',
      details: technicalDetails,
    }
  if (event.type === 'done')
    return {
      ...base,
      title: '完成归档',
      summary: '任务已按用户授权完成并归档。',
      impact: '后续只作为历史记录读取。',
      details: technicalDetails,
    }
  if (event.type === 'abandoned')
    return {
      ...base,
      title: '放弃任务',
      summary: '任务已按用户授权放弃。',
      impact: '后续只作为历史记录读取。',
      details: technicalDetails,
    }
  if (event.type === 'blocked')
    return {
      ...base,
      title: '任务阻塞',
      summary: '任务暂时无法继续。',
      impact: '需要先解除阻塞再实施、验证或提交。',
      next_action: '处理阻塞原因。',
      details: technicalDetails,
    }
  if (event.type === 'unblocked')
    return {
      ...base,
      title: '解除阻塞',
      summary: '任务阻塞已解除。',
      impact: '可以继续按当前阶段推进。',
      details: technicalDetails,
    }
  if (event.type === 'writer_claimed')
    return {
      ...base,
      title: '取得写入权',
      summary: '当前会话取得这张任务的写入权。',
      impact: '后续写入由当前会话负责。',
      details: technicalDetails,
    }
  if (event.type === 'writer_taken_over')
    return {
      ...base,
      title: '转交写入权',
      summary: '任务写入权已转交到当前会话。',
      impact: '旧会话不应继续写这张任务。',
      details: technicalDetails,
    }
  if (event.type === 'artifact_updated')
    return {
      ...base,
      title: '更新交付物',
      summary: '任务关联的交付文件已更新。',
      impact: '后续 review 应按新的交付文件核对。',
      details: details(event, ['added', 'removed']),
    }

  return {
    ...base,
    title: '记录任务事件',
    summary: '任务状态有一条新记录。',
    impact: '可展开查看技术详情。',
    details: technicalDetails,
  }
}

function timelineEvents(
  task: TaskV2,
  events: TaskEvent[],
  includeDetails = true,
) {
  const timeline = events.map((event) => timelineEvent(task, event))
  if (includeDetails) return timeline
  return timeline.map(({ details: _, ...event }) => event)
}

function nextAction(
  task: TaskV2,
  actor: string,
  liveStatus?: 'match' | 'mismatch' | 'unknown',
) {
  const writer = writerState(task, actor)
  if (writer.caller_capability === 'read_only') return 'read_only'
  if (writer.task_status === 'legacy_unclaimed') return 'claim'
  if (writer.task_status === 'schema_upgrade_required')
    return writer.status === 'primary_writer' ? 'upgrade_v4' : 'read_only'
  if (writer.status === 'writer_mismatch') return 'takeover'
  if (task.blocked) return 'unblock'
  if (task.phase === 'plan')
    return task.plan.open_questions.length > 0
      ? 'resolve_open_questions'
      : 'approve'
  if (task.phase === 'review')
    return schema5UnverifiedItems(task).length > 0
      ? 'prepare_closeout'
      : 'review_or_archive'
  const gates = gateSummary(task, liveStatus)
  return gates.total > 0 && gates.pass !== gates.total ? 'verify' : 'submit'
}

function statusTask(
  store: TaskStoreV2,
  task: TaskV2,
  actor: string,
  archived = false,
) {
  const workspaceProof = workspaceProofView(store, task, archived)
  const unverifiedItems = schema5UnverifiedItems(task)
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
    writer: writerState(task, actor),
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
    updated_at: task.updated_at,
  }
}

function briefTask(store: TaskStoreV2, task: TaskV2, archived = false) {
  const workspaceProof = workspaceProofView(store, task, archived)
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

type ContextJsonOptions = {
  brief?: boolean
  status?: boolean
  sinceRevision?: number
  history?: ContextHistoryView
}

function archivedContextMetadata(context: ContextTaskReadV2) {
  return context.archived
    ? {
        archived: true as const,
        outcome: context.task.outcome!,
        last_open_phase: context.task.phase,
      }
    : {}
}

export function contextJsonV2(
  store: TaskStoreV2,
  context: ContextTaskReadV2,
  actor: string,
  input: boolean | ContextJsonOptions,
) {
  const { task, eventLog } = context
  const options = typeof input === 'boolean' ? { brief: input } : input
  const events = eventLog.events
  const group = groupContext(store, task)
  const delivery = artifactDelivery(store.paths.workspaceRoot, task.artifacts)
  const deliveryWarnings = artifactWarnings(delivery)
  const current = currentTaskIdV2(store, actor) === task.id
  const includeRawEvents = options.history !== 'timeline'
  const includeTimeline = options.history !== 'events'
  const includeTimelineDetails = options.history !== 'timeline'
  const historyView = options.history
  if (options.sinceRevision !== undefined) {
    const deltaEvents = events.filter((event) => event.revision > options.sinceRevision!)
    return {
      ...jsonEnvelopeV2(),
      ...archivedContextMetadata(context),
      view: 'delta',
      current,
      task: statusTask(store, task, actor, context.archived),
      from_revision: options.sinceRevision,
      to_revision: task.revision,
      requires_baseline: true,
      ...(includeRawEvents ? { events: deltaEvents } : {}),
      ...(includeTimeline
        ? { timeline: timelineEvents(task, deltaEvents, includeTimelineDetails) }
        : {}),
      ...(historyView ? { history_view: historyView } : {}),
      history_incomplete: taskHistoryIncompleteForTaskV2(task, events),
      artifact_delivery: delivery,
      ...([...eventLog.warnings, ...deliveryWarnings].length > 0
        ? { warnings: [...eventLog.warnings, ...deliveryWarnings] }
        : {}),
    }
  }
  return {
    ...jsonEnvelopeV2(),
    ...archivedContextMetadata(context),
    view: options.status ? 'status' : options.brief ? 'brief' : 'full',
    current,
    task: options.status
      ? statusTask(store, task, actor, context.archived)
      : options.brief
        ? briefTask(store, task, context.archived)
        : task,
    ...(!options.status && includeRawEvents
      ? { recent_events: options.brief ? events.slice(-5) : events }
      : {}),
    ...(!options.status && includeTimeline
      ? {
          timeline: timelineEvents(
            task,
            options.brief ? events.slice(-5) : events,
            includeTimelineDetails,
          ),
        }
      : {}),
    ...(!options.status && historyView ? { history_view: historyView } : {}),
    history_incomplete: taskHistoryIncompleteForTaskV2(task, events),
    artifact_delivery: delivery,
    ...([...eventLog.warnings, ...deliveryWarnings].length > 0
      ? { warnings: [...eventLog.warnings, ...deliveryWarnings] }
      : {}),
    ...(!options.status && group ? { group } : {}),
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
  context: ContextTaskReadV2,
  actor: string,
) {
  const { task, eventLog } = context
  const current = currentTaskIdV2(store, actor) === task.id
  const historyIncomplete = taskHistoryIncompleteForTaskV2(task, eventLog.events)
  const group = groupContext(store, task)
  const workspaceProof = workspaceProofView(store, task, context.archived)
  const unverifiedItems = schema5UnverifiedItems(task)
  const closeoutCounts = schema5CloseoutCounts(task)
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
    ...(task.schema_version === 5
      ? [
          `Unverified items: ${unverifiedItems.length}`,
          `Pending closeout resolutions: ${task.closure ? 0 : unverifiedItems.length}`,
          ...(task.closure
            ? [
                `Closeout outcomes: resolved=${closeoutCounts.resolved}, accepted_risk=${closeoutCounts.accepted_risk}, followup=${closeoutCounts.followup}`,
              ]
            : []),
        ]
      : []),
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
