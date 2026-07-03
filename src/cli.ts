#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  latchDir,
  repoRoot as root,
  statePath,
} from './core/paths.js'
import { commandEnv, die, now } from './core/utils.js'
import { claimTask, ensureTaskOwnedByActor } from './core/ownership.js'
import {
  archiveTask,
  createTask,
  currentTask,
  currentTaskId,
  ensureInit,
  knowledgeCardArtifact,
  openTaskIds,
  readTask,
  runLocked,
  saveTask,
  taskPath,
  writeCurrentTaskId,
} from './core/task-store.js'
import { appendNotes, event } from './core/notes-events.js'
import {
  TASK_FIELDS,
  advanceBlockers,
  defaultNext,
  ensureDoneReady,
  scaffoldForStage,
} from './core/progress.js'
import {
  commandUsage,
  knowledgeUsage,
  printContext,
  printList,
  printResume,
} from './core/task-view.js'
import {
  buildKnowledgeMeta,
  ensureKnowledgeDirs,
  knowledgeTaskCardPath,
  recallKnowledge,
  verifyKnowledgeCards,
  writeKnowledgeCard,
  writeModuleCards,
} from './core/knowledge.js'
import type { Stage, Task } from './core/types.js'

const command = process.argv[2]
const args = process.argv.slice(3)
const usage =
  'Usage: latch <init|start|checkpoint|save|finish|next|verify|resume|list|log|done|abandon|use|context|knowledge>'

function wantsForce() {
  return args.includes('--force')
}

function targetTask(options: { write?: boolean } = {}): Task {
  const id = option('--task')
  const task = id ? readTask(id) : currentTask()
  if (options.write) claimTask(task, wantsForce())
  else if (!id) ensureTaskOwnedByActor(task)
  return task
}

function orDie<T>(fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    die(error instanceof Error ? error.message : String(error))
  }
}

const KNOWLEDGE_DECISIONS = new Set(['generate', 'skip'])
const DEFAULT_KNOWLEDGE_SKIP_REASON = '默认跳过；如有可复用规则再显式生成知识卡'

// 把命令行上给到的 goal/scope/acceptance/next 写进 task，返回本次实际改动的字段名
function applyFieldOptions(task: Task): string[] {
  const changed: string[] = []
  for (const field of TASK_FIELDS) {
    const value = option(`--${field}`)
    if (value) {
      task[field] = value
      changed.push(field)
    }
  }
  const knowledgeDecision = option('--knowledge')
  if (knowledgeDecision) {
    if (!KNOWLEDGE_DECISIONS.has(knowledgeDecision))
      throw new Error('`--knowledge` must be `generate` or `skip`.')
    task.knowledge_decision = knowledgeDecision as 'generate' | 'skip'
    task.knowledge_decided_at = now()
    changed.push('knowledge_decision')
  }
  const knowledgeReason = option('--knowledge-reason')
  if (knowledgeReason) {
    task.knowledge_reason = knowledgeReason
    changed.push('knowledge_reason')
  }
  if (knowledgeDecision === 'skip' && !knowledgeReason)
    throw new Error('`--knowledge skip` requires `--knowledge-reason`.')
  if (knowledgeDecision === 'generate') {
    // 重新生成知识卡前先清掉旧卡指针，避免 artifacts 里残留过期路径
    if (task.artifacts) {
      task.artifacts = task.artifacts.filter((a) => a.kind !== 'knowledge_card')
      if (task.artifacts.length === 0) delete task.artifacts
    }
  }
  // --artifact 可重复传，每个值形如 "<kind>:<path>"，以第一个冒号切分；kind 必填、path 必填
  for (const raw of optionAll('--artifact')) {
    const sep = raw.indexOf(':')
    if (sep <= 0) throw new Error(`\`--artifact\` must be "<kind>:<path>", got: ${raw}`)
    const kind = raw.slice(0, sep).trim()
    const path = raw.slice(sep + 1).trim()
    if (!kind || !path) throw new Error(`\`--artifact\` kind and path are required, got: ${raw}`)
    if (!task.artifacts) task.artifacts = []
    task.artifacts.push({ kind, path })
    changed.push('artifacts')
  }
  return changed
}

function option(name: string) {
  const index = args.indexOf(name)
  // 值缺失或撞上下一个 flag 名时视为无值，避免把 "--xxx" 当成字段值写进 task.json
  const value = index >= 0 ? args[index + 1] : undefined
  return value && !value.startsWith('--') ? value : undefined
}

// 收集可重复 flag 的所有值，比如 --artifact a --artifact b
function optionAll(name: string) {
  const values: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== name) continue
    const next = args[i + 1]
    if (next && !next.startsWith('--')) values.push(next)
  }
  return values
}

const booleanFlags = new Set(['--all', '--brief', '--draft', '--force', '--help', '--json', '--new', '--yes', '-h'])

function firstPositionalArg(values: string[]) {
  let skipValue = false
  for (const value of values) {
    if (skipValue) {
      skipValue = false
      continue
    }
    if (value.startsWith('--') || value === '-h') {
      // 默认把未知 long flag 当成“带值”处理，避免新加字段 flag 时把它的值误认成 title
      skipValue = !booleanFlags.has(value)
      continue
    }
    return value
  }
}

function checkpointTitleArg() {
  return firstPositionalArg(args)
}

function finishClosureFields() {
  return {
    changes: option('--changes'),
    verified: option('--verified'),
    unverified: option('--unverified'),
    followup: option('--followup'),
  }
}

function hasFinishClosure(closure: ReturnType<typeof finishClosureFields>) {
  return Boolean(closure.changes || closure.verified || closure.unverified || closure.followup)
}

function enterFinishForFinishCommand(task: Task) {
  if (task.stage === 'finish') return null
  if (task.stage !== 'check') throw new Error('Task must be in finish stage.')
  const blockers = advanceBlockers(task, 'finish')
  if (blockers.length > 0)
    throw new Error(`Cannot advance ${task.stage} -> finish: ${blockers.join('; ')}.`)
  const from = task.stage
  task.stage = 'finish'
  return from
}

function applyFinishDefaults(task: Task, changed: string[], followup?: string) {
  if (followup && !option('--next')) {
    task.next = followup
    changed.push('next')
  }
  if (!task.knowledge_decision) {
    task.knowledge_decision = 'skip'
    task.knowledge_reason = DEFAULT_KNOWLEDGE_SKIP_REASON
    task.knowledge_decided_at = now()
    changed.push('knowledge_decision', 'knowledge_reason')
  } else if (task.knowledge_decision === 'skip' && !task.knowledge_reason) {
    task.knowledge_reason = DEFAULT_KNOWLEDGE_SKIP_REASON
    changed.push('knowledge_reason')
  }
}

function help(message: string) {
  console.log(message)
  process.exit(0)
}

function wantsCommandHelp(name?: string) {
  if (!name) return false
  if (name === 'verify' || name === 'knowledge') {
    const separator = args.indexOf('--')
    const commandArgs = separator >= 0 ? args.slice(0, separator) : args
    return commandArgs.includes('--help') || commandArgs.includes('-h')
  }
  return args.includes('--help') || args.includes('-h')
}

// 已知阶段集合，用于校验 --to 的值，给出明确报错而不是依赖 canAdvance 隐式拒绝
const validStages = new Set<Stage>([
  'triage',
  'brainstorm',
  'grill',
  'plan',
  'dev',
  'check',
  'finish',
  'done',
  'blocked',
  'abandoned',
])

if (command === undefined || command === '--help' || command === '-h')
  help(usage)
if (commandUsage(command) && wantsCommandHelp(command))
  help(commandUsage(command))

switch (command) {
  case 'init': {
    ensureInit()
    console.log('Initialized .latch')
    break
  }
  case 'start': {
    runLocked(() => {
      const title = args.filter((arg) => arg !== '--use').join(' ').trim()
      if (!title) throw new Error('Usage: latch start <title>')
      const task = createTask(title)
      event(task, 'started')
      const current = currentTaskId()
      if (!current || args.includes('--use'))
        writeCurrentTaskId(task.id)
      console.log(`Started ${task.id}`)
      if (current && !args.includes('--use')) {
        console.log(`Current task is still: ${current}`)
        console.log(`To switch: latch use ${task.id}`)
      }
    })
    break
  }
  case 'use': {
    runLocked(() => {
      const id = args[0]
      if (!id) throw new Error('Usage: latch use <task-id>')
      const task = readTask(id)
      if (wantsForce()) {
        if (claimTask(task, true)) saveTask(task)
      } else {
        ensureTaskOwnedByActor(task)
      }
      writeCurrentTaskId(id)
      console.log(`Switched to ${id}`)
    })
    break
  }
  case 'checkpoint': {
    runLocked(() => {
      const createNew = args.includes('--new')
      const current = currentTaskId()
      const title = checkpointTitleArg()
      let task: Task
      let created = false
      if (!current || createNew) {
        // 没任务就开一个,降低中途补记的进入成本
        if (!title)
          throw new Error(
            'Usage: latch checkpoint <title> [--goal ...] [--scope ...] [--acceptance ...] [--next ...] [--task <task-id>] [--new] [--force]',
          )
        task = createTask(title)
        writeCurrentTaskId(task.id)
        created = true
      } else {
        if (title && !option('--task'))
          throw new Error(
            'Current task exists. Use `latch checkpoint --new "<title>" ...` for a different task, or drop the title to update the current task.',
          )
        task = targetTask({ write: true })
      }
      const changed = applyFieldOptions(task)
      saveTask(task)
      event(task, 'checkpoint', { created, fields: changed })
      console.log(
        created
          ? `Started and checkpointed ${task.id}`
          : `Checkpointed ${task.id}`,
      )
    })
    break
  }
  case 'save': {
    runLocked(() => {
      const task = targetTask({ write: true })
      const changed = applyFieldOptions(task)
      saveTask(task)
      event(task, 'saved', { fields: changed })
      console.log('Saved')
    })
    break
  }
  case 'finish': {
    runLocked(() => {
      const task = targetTask({ write: true })
      const advancedFrom = enterFinishForFinishCommand(task)
      const closure = finishClosureFields()
      const changed = applyFieldOptions(task)
      const hasClosure = hasFinishClosure(closure)
      if (!hasClosure && changed.length === 0)
        throw new Error(commandUsage('finish'))
      if (advancedFrom && !hasClosure)
        throw new Error('Finish closure is required when finishing from check.')
      applyFinishDefaults(task, changed, closure.followup)
      if (hasClosure) {
        appendNotes(task, 'Finish closure', [
          `改了什么：${closure.changes ?? ''}`,
          `验证了什么：${closure.verified ?? ''}`,
          `没验证什么：${closure.unverified ?? ''}`,
          `下次接什么：${closure.followup ?? ''}`,
        ])
      }
      saveTask(task)
      if (advancedFrom)
        event(task, 'stage_changed', {
          from: advancedFrom,
          to: 'finish',
          reason: 'finish command after passing verification',
        })
      event(task, 'finish_saved', {
        closure: hasClosure,
        fields: changed,
      })
      console.log('Saved finish closure')
    })
    break
  }
  case 'next': {
    runLocked(() => {
      const task = targetTask({ write: true })
      const toRaw = option('--to')
      if (toRaw && !validStages.has(toRaw as Stage))
        throw new Error(`Unknown stage: ${toRaw}`)
      const to = (toRaw ?? defaultNext(task.stage)) as Stage
      if (task.stage === 'finish' && to === 'done')
        throw new Error('Use latch done after user asks to finish/archive.')
      const blockers = advanceBlockers(task, to)
      if (blockers.length > 0)
        throw new Error(
          `Cannot advance ${task.stage} -> ${to}: ${blockers.join('; ')}.`,
        )
      const from = task.stage
      task.stage = to
      if (to === 'blocked') task.status = 'blocked'
      saveTask(task)
      event(task, 'stage_changed', { from, to, reason: option('--reason') })
      scaffoldForStage(task, to)
      console.log(`${from} -> ${to}`)
    })
    break
  }
  case 'verify': {
    const separator = args.indexOf('--')
    const verifyArgs = separator >= 0 ? args.slice(separator + 1) : args
    if (verifyArgs.length === 0) die('Usage: latch verify -- <command>')
    runLocked(() => {
      const task = targetTask({ write: true })
      saveTask(task)
    })
    const verifyResult = spawnSync(verifyArgs[0], verifyArgs.slice(1), {
      cwd: root,
      env: commandEnv(root),
      stdio: 'inherit',
      shell: false,
    })
    const result = runLocked(() => {
      const task = targetTask({ write: true })
      task.latest_verify = {
        command: verifyArgs.join(' '),
        status: verifyResult.status === 0 ? 'pass' : 'fail',
        exit_code: verifyResult.status ?? 1,
        created_at: now(),
      }
      saveTask(task)
      event(task, 'verified', task.latest_verify)
      return task.latest_verify.exit_code
    })
    process.exit(result)
    break
  }
  case 'resume': {
    const id = option('--task')
    const current = id ?? currentTaskId()
    if (!current) {
      console.log('No current task.')
      break
    }
    const task = orDie(() => (id ? readTask(id) : targetTask()))
    printResume(task, { brief: args.includes('--brief'), json: args.includes('--json') })
    break
  }
  case 'context': {
    const id = args.find((arg) => !arg.startsWith('--'))
    const task = orDie(() => (id ? readTask(id) : targetTask()))
    const current = existsSync(statePath) ? currentTaskId() : undefined
    printContext(task, {
      brief: args.includes('--brief'),
      json: args.includes('--json'),
      current: task.id === current,
    })
    break
  }
  case 'knowledge': {
    const subcommand = args[0]
    if (!subcommand) help(knowledgeUsage())
    runLocked(() => {
      switch (subcommand) {
        case 'generate': {
          const task = targetTask({ write: true })
          saveTask(task)
          if (!args.includes('--draft')) {
            if (task.stage !== 'finish') throw new Error('Knowledge generate requires finish stage unless --draft is used.')
            if (task.latest_verify?.status !== 'pass')
              throw new Error('Knowledge generate requires latest verify pass unless --draft is used.')
          }
          ensureKnowledgeDirs()
          const meta = buildKnowledgeMeta(task, {
            module: option('--module'),
            keyword: option('--keyword'),
            path: option('--path'),
            symbol: option('--symbol'),
            line: option('--line'),
            draft: args.includes('--draft'),
          })
          const body = [
            '# 任务知识卡',
            '',
            `- 任务：${task.title}`,
            `- goal：${task.goal ?? '无'}`,
            `- scope：${task.scope ?? '无'}`,
            `- acceptance：${task.acceptance ?? '无'}`,
            `- next：${task.next ?? '无'}`,
          ].join('\n')
          const path = knowledgeTaskCardPath(task)
          writeKnowledgeCard(path, meta, body)
          task.knowledge_decision = 'generate'
          task.knowledge_reason ??= '生成知识卡'
          task.knowledge_decided_at = now()
          // 知识卡路径改由 artifacts 数组里 kind="knowledge_card" 的一项表达，统一外部产物指针
          if (!task.artifacts) task.artifacts = []
          task.artifacts = task.artifacts.filter((a) => a.kind !== 'knowledge_card')
          task.artifacts.push({ kind: 'knowledge_card', path })
          saveTask(task)
          console.log(`Generated ${path}`)
          break
        }
        case 'recall':
          recallKnowledge({
            file: option('--file'),
            keyword: option('--keyword'),
            module: option('--module'),
          })
          break
        case 'refresh-modules':
          writeModuleCards()
          console.log('Refreshed module cards')
          break
        case 'verify':
          verifyKnowledgeCards(args.includes('--all') ? undefined : option('--task'))
          break
        default:
          throw new Error(knowledgeUsage())
      }
    })
    break
  }
  case 'list': {
    const current = existsSync(statePath) ? currentTaskId() : undefined
    const tasks = openTaskIds().map((id) => readTask(id))
    printList(tasks, current, { json: args.includes('--json'), brief: args.includes('--brief') })
    break
  }
  case 'log': {
    ensureInit()
    // log 是纯留痕,不进状态机。多任务模式下 open task 可以长期存在,log 仍可记录独立小事。
    const summary = args.find(
      (a, index) => !a.startsWith('--') && args[index - 1] !== '--files',
    )
    if (!summary) die('Usage: latch log <summary> [--files a,b,c]')
    const filesRaw = option('--files')
    const files = filesRaw
      ? filesRaw
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean)
      : []
    const entry = { timestamp: now(), summary, files }
    writeFileSync(join(latchDir, 'log.jsonl'), `${JSON.stringify(entry)}\n`, {
      flag: 'a',
    })
    console.log(`Logged: ${summary}`)
    break
  }
  case 'done': {
    runLocked(() => {
      if (args.includes('--all') && option('--task'))
        throw new Error('Use either `latch done --task <task-id>` or `latch done --all --yes`.')
      if (args.includes('--all')) {
        if (!args.includes('--yes'))
          throw new Error('`latch done --all` requires `--yes`.')
        const ready: Task[] = []
        const blocked: string[] = []
        for (const id of openTaskIds()) {
          const task = readTask(id)
          if (task.stage !== 'finish') continue
          try {
            ensureDoneReady(task)
            claimTask(task, wantsForce())
            ready.push(task)
          } catch (error) {
            blocked.push(
              `${task.id}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        if (ready.length === 0) {
          if (blocked.length > 0)
            throw new Error(
              `No finish tasks ready to archive.\n${blocked.join('\n')}`,
            )
          throw new Error('No finish tasks ready to archive.')
        }
        for (const task of ready) {
          task.stage = 'done'
          task.status = 'done'
          saveTask(task)
          event(task, 'done')
          archiveTask(task)
          console.log(`Archived ${task.id}`)
        }
        if (blocked.length > 0) {
          console.log('Skipped finish tasks:')
          for (const message of blocked) console.log(`- ${message}`)
        }
        return
      }
      const task = targetTask({ write: true })
      ensureDoneReady(task)
      task.stage = 'done'
      task.status = 'done'
      saveTask(task)
      event(task, 'done')
      archiveTask(task)
      console.log(`Archived ${task.id}`)
    })
    break
  }
  case 'abandon': {
    runLocked(() => {
      const task = targetTask({ write: true })
      const reason = option('--reason')
      task.stage = 'abandoned'
      task.status = 'abandoned'
      saveTask(task)
      event(task, 'abandoned', reason ? { reason } : {})
      if (reason) appendNotes(task, 'Abandoned', [`reason: ${reason}`])
      archiveTask(task)
      console.log(`Abandoned ${task.id}`)
    })
    break
  }
  default:
    console.log(usage)
}
