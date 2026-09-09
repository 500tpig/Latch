import type { TaskEvent, TaskV2 } from '../types.js'
import { concise, SCHEMA5_VIEW_SAMPLE_LIMIT } from './shared.js'

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

function detailNumber(event: TaskEvent, key: string) {
  const value = detailValue(event, key)
  return typeof value === 'number' ? value : undefined
}

function details(
  event: TaskEvent,
  keys: string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = { event_type: event.type }
  for (const key of keys) {
    const value = detailValue(event, key)
    if (Array.isArray(value)) {
      output[key] = value.slice(0, SCHEMA5_VIEW_SAMPLE_LIMIT)
      output[`${key}_total`] = value.length
      output[`${key}_sample_limit`] = SCHEMA5_VIEW_SAMPLE_LIMIT
      output[`${key}_truncated`] = value.length > SCHEMA5_VIEW_SAMPLE_LIMIT
    } else if (value !== undefined) output[key] = value
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
    'change',
    'appended_paths',
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
    const kind = detailValue(event, 'kind') === 'diagnostic'
      ? 'diagnostic'
      : 'gate'
    if (kind === 'diagnostic')
      return {
        ...base,
        title: '记录 diagnostic 结果',
        summary: `${name} diagnostic 结果已记录：${status}。`,
        impact:
          status === '已通过'
            ? '这项 diagnostic 结果仅作记录，不构成验收 gate 证明。'
            : '这项 diagnostic 未通过，但结果仅作记录，不构成验收 gate 证明，也不阻塞提交。',
        details: technicalDetails,
      }
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
  if (event.type === 'submitted') {
    const unverifiedCount = detailNumber(event, 'unverified_count') ?? 0
    return {
      ...base,
      title:
        unverifiedCount > 0
          ? `提交验收：${unverifiedCount} 项待处理`
          : '提交验收：无未验证项',
      summary:
        unverifiedCount > 0
          ? `本轮工作已提交验收，包含 ${unverifiedCount} 项未验证说明。`
          : '本轮工作已提交验收，没有未验证说明。',
      impact: '任务进入 review，不会自动归档。',
      next_action:
        unverifiedCount > 0
          ? '为每个未验证项准备 closeout resolution。'
          : '等待用户确认、反馈或归档授权。',
      details: technicalDetails,
    }
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
  if (event.type === 'done') {
    const resolved = detailNumber(event, 'resolved_count') ?? 0
    const acceptedRisk = detailNumber(event, 'accepted_risk_count') ?? 0
    const followup = detailNumber(event, 'followup_count') ?? 0
    return {
      ...base,
      title: `完成归档：${resolved + acceptedRisk + followup} 项 closeout`,
      summary:
        `任务已按用户授权完成并归档；` +
        `resolved=${resolved}，accepted_risk=${acceptedRisk}，followup=${followup}。`,
      impact:
        followup > 0
          ? '后续只作为历史记录读取；closeout 中仍有 follow-up 动作。'
          : '后续只作为历史记录读取；没有额外 follow-up。',
      ...(followup > 0
        ? { next_action: '跟进 closeout 中标记的 follow-up。' }
        : {}),
      details: technicalDetails,
    }
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

export function timelineEvents(
  task: TaskV2,
  events: TaskEvent[],
  includeDetails = true,
) {
  const timeline = events.map((event) => timelineEvent(task, event))
  if (includeDetails) return timeline
  return timeline.map(({ details: _, ...event }) => event)
}
