import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { taskPath } from './task-store.js'
import { advanceBlockers, defaultNext } from './progress.js'
import { recentEvents } from './notes-events.js'
import { actorId } from './ownership.js'
import type { Task } from './types.js'

// 把阶段规则压成给人和 AI 读的摘要结构：能不能推进、卡在哪、下一步干什么。
// 读状态靠 progress 模块的纯规则函数，这里只负责拼输出形状。
export function progressSummary(task: Task) {
  if (task.stage === 'finish') {
    return {
      advance_to: 'done',
      can_advance: false,
      blocked_reasons: ['wait for user confirmation'],
      next_action: 'wait for user confirmation, then run `latch done`',
    }
  }

  if (task.stage === 'done' || task.stage === 'abandoned') {
    return {
      advance_to: null,
      can_advance: false,
      blocked_reasons: [`task is already ${task.stage}`],
      next_action: 'none',
    }
  }

  if (task.stage === 'blocked') {
    return {
      advance_to: null,
      can_advance: false,
      blocked_reasons: ['task is blocked'],
      next_action: task.next ?? 'resolve the blocking issue first',
    }
  }

  const to = defaultNext(task.stage)
  const blockedReasons = advanceBlockers(task, to)
  return {
    advance_to: to,
    can_advance: blockedReasons.length === 0,
    blocked_reasons: blockedReasons,
    next_action:
      blockedReasons.length === 0
        ? 'run `latch next`'
        : task.stage === 'check'
          ? 'run `latch verify -- <command>`'
          : task.next ?? 'fill the missing task fields first',
  }
}

// 把 artifacts 数组压成一行，方便 resume/context 人读输出展示给 AI 看
export function formatArtifacts(task: Task): string | null {
  if (!task.artifacts || task.artifacts.length === 0) return null
  return task.artifacts.map((a) => `${a.kind}:${a.path}`).join('  ')
}

export function taskContext(task: Task) {
  return {
    task_id: task.id,
    title: task.title,
    owner: task.owner ?? null,
    status: task.status,
    stage: task.stage,
    goal: task.goal ?? null,
    scope: task.scope ?? null,
    acceptance: task.acceptance ?? null,
    next: task.next ?? null,
    knowledge_decision: task.knowledge_decision ?? null,
    knowledge_reason: task.knowledge_reason ?? null,
    knowledge_decided_at: task.knowledge_decided_at ?? null,
    artifacts: task.artifacts ?? [],
    latest_verify: task.latest_verify ?? null,
    progress: progressSummary(task),
    notes_path: join(taskPath(task.id), 'notes.md'),
  }
}

export function knowledgeUsage() {
  return [
    'Usage: latch knowledge <generate|recall|refresh-modules|verify> [options]',
    '  latch knowledge generate [--task <task-id>] [--draft] [--module a,b] [--keyword a,b] [--path <file>] [--symbol <name>] [--line <n>]',
    '  latch knowledge recall [--file <path>] [--keyword <term>] [--module <name>]',
    '  latch knowledge refresh-modules',
    '  latch knowledge verify [--task <task-id>|--all]',
  ].join('\n')
}

export function commandUsage(name: string) {
  return (
    {
      init: 'Usage: latch init',
      start: 'Usage: latch start <title> [--use]',
      checkpoint:
        'Usage: latch checkpoint <title> [--goal ...] [--scope ...] [--acceptance ...] [--next ...] [--task <task-id>] [--new] [--force]',
      save: 'Usage: latch save [--goal ...] [--scope ...] [--acceptance ...] [--next ...] [--knowledge generate|skip] [--knowledge-reason "..."] [--artifact <kind>:<path> ...] [--task <task-id>]',
      next: 'Usage: latch next [--to <stage>] [--reason <reason>] [--task <task-id>]',
      verify: 'Usage: latch verify -- <command>',
      resume: 'Usage: latch resume [--brief] [--json] [--task <task-id>]',
      list: 'Usage: latch list [--json]',
      log: 'Usage: latch log <summary> [--files a,b,c]',
      done: 'Usage: latch done',
      abandon: 'Usage: latch abandon [--reason <reason>] [--task <task-id>]',
      use: 'Usage: latch use <task-id> [--force]',
      context: 'Usage: latch context [<task-id>] [--brief] [--json]',
      knowledge: knowledgeUsage(),
    } as Record<string, string>
  )[name]
}

export function printResume(task: Task, opts: { brief: boolean; json: boolean }) {
  if (opts.json) {
    console.log(JSON.stringify(taskContext(task), null, 2))
    return
  }
  console.log(`Task: ${task.title}`)
  if (task.owner) console.log(`Owner: ${task.owner}`)
  console.log(`Stage: ${task.stage}`)
  if (task.goal) console.log(`Goal: ${task.goal}`)
  if (task.scope) console.log(`Scope: ${task.scope}`)
  if (task.acceptance) console.log(`Acceptance: ${task.acceptance}`)
  if (task.next) console.log(`Next: ${task.next}`)
  console.log(
    `Verify: ${task.latest_verify ? `${task.latest_verify.status} ${task.latest_verify.command}` : 'none'}`,
  )
  const artifactsLine = formatArtifacts(task)
  if (artifactsLine) console.log(`Artifacts: ${artifactsLine}`)
  const progress = progressSummary(task)
  if (progress.advance_to)
    console.log(`Advance target: ${progress.advance_to}`)
  console.log(`Can advance: ${progress.can_advance ? 'yes' : 'no'}`)
  console.log(`Next action: ${progress.next_action}`)
  if (progress.blocked_reasons.length > 0)
    console.log(`Blocked by: ${progress.blocked_reasons.join('; ')}`)
  // verify 已 pass 但 stage 没走到 finish:通常 verify 提前跑了或 next 没推进,工作可能已实际完成却悬挂在中间阶段。提示先推进到 finish 再归档,免得下一轮 resume 看到一个 triage 任务却其实已经做完了。
  if (task.latest_verify?.status === 'pass' && task.stage !== 'finish') {
    console.log(
      `Note: verify passed but stage is ${task.stage}, not finish. Run \`latch next\` to advance, then \`latch done\` to archive.`,
    )
  }
  // 跨会话续接靠 notes.md：上次 grill 结论、plan 取舍、closure 都在里面，省得下一轮重新问一遍
  // brief 模式:砍 notes 全文(任务长时堆积成噪音),改输出最近 5 条 events + notes 路径,AI 想看细节自己读文件。
  if (opts.brief) {
    const events = recentEvents(task, 5)
    if (events.length) {
      console.log('Recent events:')
      for (const line of events) console.log(`  ${line}`)
    }
    console.log(`Notes: ${join(taskPath(task.id), 'notes.md')}`)
  } else {
    const notesPath = join(taskPath(task.id), 'notes.md')
    if (existsSync(notesPath)) {
      const notes = readFileSync(notesPath, 'utf8').trim()
      if (notes) {
        console.log('---')
        console.log(notes)
      }
    }
  }
}

export function printContext(task: Task, opts: { brief: boolean; json: boolean }) {
  const context = taskContext(task)
  if (opts.json) {
    console.log(JSON.stringify(context, null, 2))
    return
  }
  console.log(`Task: ${context.title}`)
  if (context.owner) console.log(`Owner: ${context.owner}`)
  console.log(`Stage: ${context.stage}`)
  if (!opts.brief) {
    if (context.goal) console.log(`Goal: ${context.goal}`)
    if (context.scope) console.log(`Scope: ${context.scope}`)
    if (context.acceptance) console.log(`Acceptance: ${context.acceptance}`)
  }
  if (context.next) console.log(`Next: ${context.next}`)
  console.log(
    `Verify: ${context.latest_verify ? `${context.latest_verify.status} ${context.latest_verify.command}` : 'none'}`,
  )
  if (context.artifacts && context.artifacts.length > 0)
    console.log(`Artifacts: ${context.artifacts.map((a) => `${a.kind}:${a.path}`).join('  ')}`)
  if (context.progress.advance_to)
    console.log(`Advance target: ${context.progress.advance_to}`)
  console.log(`Can advance: ${context.progress.can_advance ? 'yes' : 'no'}`)
  console.log(`Next action: ${context.progress.next_action}`)
  if (context.progress.blocked_reasons.length > 0)
    console.log(`Blocked by: ${context.progress.blocked_reasons.join('; ')}`)
  console.log(`Notes: ${context.notes_path}`)
}

export function printList(tasks: Task[], current: string | undefined, opts: { json: boolean }) {
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          actor: actorId(),
          current_task_id: current,
          tasks: tasks.map((task) => ({
            ...taskContext(task),
            current: task.id === current,
          })),
        },
        null,
        2,
      ),
    )
  } else {
    for (const task of tasks) {
      const marker = task.id === current ? '* ' : '  '
      console.log(
        `${marker}${task.status}\t${task.stage}\t${task.owner ?? '-'}\t${task.id}\t${task.title}`,
      )
    }
  }
}
