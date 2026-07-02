import { appendNotes } from './notes-events.js'
import { knowledgeCardArtifact } from './task-store.js'
import type { Stage, Task } from './types.js'

export const TASK_FIELDS = ['goal', 'scope', 'acceptance', 'next'] as const

export function advanceBlockers(task: Task, to: Stage): string[] {
  if (to === 'brainstorm' || to === 'grill' || to === 'blocked') return []
  // 无 verify 意义的纯文档/commit 任务可从规划阶段跳级到 finish，跳过 dev/check；
  // 门禁为关键字段填齐。dev 及之后不跳，要走 check 让 verify 把关。
  if (
    to === 'finish' &&
    (task.stage === 'triage' ||
      task.stage === 'brainstorm' ||
      task.stage === 'grill' ||
      task.stage === 'plan')
  ) {
    return TASK_FIELDS.filter(field => !task[field]).map(field => `missing ${field}`)
  }
  if (task.stage === 'triage' && to === 'plan') {
    return task.goal || task.next ? [] : ['missing goal or next']
  }
  if (task.stage === 'brainstorm' && to === 'plan') {
    return ['goal', 'next'].filter(field => !task[field as keyof Task]).map(field => `missing ${field}`)
  }
  if (task.stage === 'grill' && to === 'plan') {
    return ['goal', 'scope', 'acceptance']
      .filter(field => !task[field as keyof Task])
      .map(field => `missing ${field}`)
  }
  if (task.stage === 'plan' && to === 'dev') return task.next ? [] : ['missing next']
  if (task.stage === 'dev' && to === 'check') return []
  if (task.stage === 'check' && to === 'finish') {
    if (!task.latest_verify) return ['missing latest verify']
    if (task.latest_verify.status !== 'pass')
      return [`latest verify is ${task.latest_verify.status}`]
    return []
  }
  return [`transition ${task.stage} -> ${to} is not allowed`]
}

export function canAdvance(task: Task, to: Stage) {
  return advanceBlockers(task, to).length === 0
}

export function defaultNext(stage: Stage): Stage {
  return (
    (
      {
        triage: 'plan',
        brainstorm: 'plan',
        grill: 'plan',
        plan: 'dev',
        dev: 'check',
        check: 'finish',
        finish: 'done',
      } as Partial<Record<Stage, Stage>>
    )[stage] ?? 'blocked'
  )
}

export function ensureDoneReady(task: Task) {
  if (task.stage !== 'finish') throw new Error('Task must be in finish stage.')
  if (task.latest_verify?.status !== 'pass')
    throw new Error('Latest verification must pass.')
  if (!task.knowledge_decision)
    throw new Error(
      'Knowledge decision is required. Run `latch save --knowledge generate|skip --knowledge-reason "..."` first.',
    )
  if (!task.knowledge_reason)
    throw new Error('Knowledge decision requires `knowledge_reason`.')
  if (task.knowledge_decision === 'generate' && !knowledgeCardArtifact(task))
    throw new Error(
      'Knowledge decision is generate, but no knowledge card exists. Run `latch knowledge generate` first.',
    )
}

// 进入需要记录结论的阶段时，铺一个空模板，逼 AI 按格子填，不让它自由发挥写散
// Latch 只负责铺格子，不检查填没填——不当裁判，只让流程不被跳过
export function scaffoldForStage(task: Task, stage: Stage) {
  const templates: Partial<Record<Stage, string[]>> = {
    brainstorm: ['目标：', '保留：', '不做：', '风险：', '下一步：'],
    grill: ['目标：', '范围：', '不做：', '验收：', '仍未确认的问题：'],
    finish: [
      '改了什么：',
      '验证了什么：',
      '没验证什么：(有未覆盖范围必须写;没有写「无」)',
      '知识记忆：用 `latch save --knowledge generate|skip --knowledge-reason "..."` 记录',
      '产出 artifact：用 `latch save --artifact <kind>:<path>` 记录 brief/prd/knowledge_card 等',
      '下次接什么：',
    ],
  }
  const lines = templates[stage]
  if (lines) appendNotes(task, `Scaffold: ${stage}`, lines)
}
