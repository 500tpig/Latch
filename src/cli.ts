#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'

type Stage =
  | 'triage'
  | 'brainstorm'
  | 'grill'
  | 'plan'
  | 'dev'
  | 'check'
  | 'finish'
  | 'done'
  | 'blocked'
  | 'abandoned'
type Verify = {
  command: string
  status: 'pass' | 'fail'
  exit_code: number
  created_at: string
}
type Task = {
  id: string
  title: string
  status: 'active' | 'done' | 'blocked' | 'abandoned'
  stage: Stage
  goal?: string
  scope?: string
  acceptance?: string
  next?: string
  latest_verify?: Verify
  created_at: string
  updated_at: string
}
type State = { current_task_id?: string; active_task_id?: string }

const root = process.cwd()
const latchDir = join(root, '.latch')
const tasksDir = join(latchDir, 'tasks')
const archiveDir = join(latchDir, 'archive')
const statePath = join(latchDir, 'state.json')

const command = process.argv[2]
const args = process.argv.slice(3)

function now() {
  return new Date().toISOString()
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as T)
    : fallback
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function ensureInit() {
  mkdirSync(tasksDir, { recursive: true })
  mkdirSync(archiveDir, { recursive: true })
  if (!existsSync(statePath)) writeJson(statePath, {})
}

function state(): State {
  ensureInit()
  return readJson<State>(statePath, {})
}

function taskPath(id: string) {
  return join(tasksDir, id)
}

function currentTaskId() {
  const current = state()
  return current.current_task_id ?? current.active_task_id
}

function readTask(id: string): Task {
  const path = join(taskPath(id), 'task.json')
  if (!existsSync(path)) die(`Task not found: ${id}`)
  return readJson<Task>(path, undefined as never)
}

function currentTask(): Task {
  const current = currentTaskId()
  if (!current) die('No current task.')
  return readTask(current)
}

function targetTask(): Task {
  const id = option('--task')
  return id ? readTask(id) : currentTask()
}

function saveTask(task: Task) {
  task.updated_at = now()
  writeJson(join(taskPath(task.id), 'task.json'), task)
}

function event(task: Task, type: string, fields: Record<string, unknown> = {}) {
  writeFileSync(
    join(taskPath(task.id), 'events.jsonl'),
    `${JSON.stringify({ type, ...fields, created_at: now() })}\n`,
    { flag: 'a' },
  )
}

// 把一条 event 压成一行:type + 关键字段 + 时间。brief 模式替代 notes 全文,让 AI 看到最近动作而不被 markdown 噪音淹没。
function formatEvent(entry: Record<string, unknown>): string {
  const type = entry.type as string
  const time = entry.created_at as string
  let detail = ''
  switch (type) {
    case 'checkpoint':
      detail = `created=${entry.created} fields=${Array.isArray(entry.fields) ? (entry.fields as string[]).join(',') : ''}`
      break
    case 'saved':
      detail = `fields=${Array.isArray(entry.fields) ? (entry.fields as string[]).join(',') : ''}`
      break
    case 'stage_changed':
      detail = `${entry.from}->${entry.to}`
      break
    case 'verified':
      detail = `${entry.status} ${entry.command}`
      break
    default:
      detail = ''
  }
  return `${type}  ${detail}  @ ${time}`.replace(/\s+/g, ' ').trim()
}

// 取 events.jsonl 最后 N 条并格式化成一行。events.jsonl 是追加的 jsonl,tail 即最近。
function recentEvents(task: Task, count: number): string[] {
  const eventsPath = join(taskPath(task.id), 'events.jsonl')
  if (!existsSync(eventsPath)) return []
  const lines = readFileSync(eventsPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
  return lines
    .slice(-count)
    .map((line) => formatEvent(JSON.parse(line) as Record<string, unknown>))
}

function appendNotes(task: Task, heading: string, lines: string[]) {
  writeFileSync(
    join(taskPath(task.id), 'notes.md'),
    `\n## ${heading}\n\n${lines.filter(Boolean).join('\n')}\n`,
    { flag: 'a' },
  )
}

function archiveTask(task: Task) {
  const month = new Date().toISOString().slice(0, 7)
  const targetDir = join(archiveDir, month)
  mkdirSync(targetDir, { recursive: true })
  renameSync(taskPath(task.id), join(targetDir, basename(task.id)))
  if (currentTaskId() === task.id) writeJson(statePath, {})
}

function openTaskIds() {
  ensureInit()
  return readdirSync(tasksDir).filter((id) =>
    existsSync(join(taskPath(id), 'task.json')),
  )
}

function taskContext(task: Task) {
  return {
    task_id: task.id,
    title: task.title,
    status: task.status,
    stage: task.stage,
    goal: task.goal ?? null,
    scope: task.scope ?? null,
    acceptance: task.acceptance ?? null,
    next: task.next ?? null,
    latest_verify: task.latest_verify ?? null,
    notes_path: join(taskPath(task.id), 'notes.md'),
  }
}

// 进入需要记录结论的阶段时，铺一个空模板，逼 AI 按格子填，不让它自由发挥写散
// Latch 只负责铺格子，不检查填没填——不当裁判，只让流程不被跳过
function scaffoldForStage(task: Task, stage: Stage) {
  const templates: Partial<Record<Stage, string[]>> = {
    brainstorm: ['目标：', '保留：', '不做：', '风险：', '下一步：'],
    grill: ['目标：', '范围：', '不做：', '验收：', '仍未确认的问题：'],
    finish: [
      '改了什么：',
      '验证了什么：',
      '没验证什么：(有未覆盖范围必须写;没有写「无」)',
      '下次接什么：',
    ],
  }
  const lines = templates[stage]
  if (lines) appendNotes(task, `Scaffold: ${stage}`, lines)
}

function option(name: string) {
  const index = args.indexOf(name)
  // 值缺失或撞上下一个 flag 名时视为无值，避免把 "--xxx" 当成字段值写进 task.json
  const value = index >= 0 ? args[index + 1] : undefined
  return value && !value.startsWith('--') ? value : undefined
}

function die(message: string): never {
  console.error(message)
  process.exit(1)
}

function slug(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'task'
  )
}

function canAdvance(task: Task, to: Stage) {
  if (to === 'brainstorm' || to === 'grill' || to === 'blocked') return true
  if (task.stage === 'triage' && to === 'plan')
    return Boolean(task.goal || task.next)
  if (task.stage === 'brainstorm' && to === 'plan')
    return Boolean(task.goal && task.next)
  if (task.stage === 'grill' && to === 'plan')
    return Boolean(task.goal && task.scope && task.acceptance)
  if (task.stage === 'plan' && to === 'dev') return Boolean(task.next)
  if (task.stage === 'dev' && to === 'check') return true
  if (task.stage === 'check' && to === 'finish')
    return task.latest_verify?.status === 'pass'
  return false
}

function defaultNext(stage: Stage): Stage {
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

switch (command) {
  case 'init': {
    ensureInit()
    console.log('Initialized .latch')
    break
  }
  case 'start': {
    ensureInit()
    const title = args.filter((arg) => arg !== '--use').join(' ').trim()
    if (!title) die('Usage: latch start <title>')
    const id = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${slug(title)}`
    mkdirSync(taskPath(id), { recursive: true })
    const task: Task = {
      id,
      title,
      status: 'active',
      stage: 'triage',
      created_at: now(),
      updated_at: now(),
    }
    writeJson(join(taskPath(id), 'task.json'), task)
    writeFileSync(join(taskPath(id), 'notes.md'), `# ${title}\n`)
    event(task, 'started')
    const current = currentTaskId()
    if (!current || args.includes('--use')) writeJson(statePath, { current_task_id: id })
    console.log(`Started ${id}`)
    if (current && !args.includes('--use')) {
      console.log(`Current task is still: ${current}`)
      console.log(`To switch: latch use ${id}`)
    }
    break
  }
  case 'use': {
    const id = args[0]
    if (!id) die('Usage: latch use <task-id>')
    readTask(id)
    writeJson(statePath, { current_task_id: id })
    console.log(`Switched to ${id}`)
    break
  }
  case 'checkpoint': {
    ensureInit()
    const current = currentTaskId()
    let task: Task
    let created = false
    if (!current) {
      // 没任务就开一个,降低中途补记的进入成本
      const title = args.find((a) => !a.startsWith('--'))
      if (!title)
        die(
          'Usage: latch checkpoint <title> [--goal ...] [--scope ...] [--acceptance ...] [--next ...]',
        )
      const id = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${slug(title)}`
      mkdirSync(taskPath(id), { recursive: true })
      task = {
        id,
        title,
        status: 'active',
        stage: 'triage',
        created_at: now(),
        updated_at: now(),
      }
      writeJson(join(taskPath(id), 'task.json'), task)
      writeFileSync(join(taskPath(id), 'notes.md'), `# ${title}\n`)
      writeJson(statePath, { current_task_id: id })
      created = true
    } else {
      task = targetTask()
    }
    const fields = ['goal', 'scope', 'acceptance', 'next'] as const
    for (const field of fields) {
      const value = option(`--${field}`)
      if (value) task[field] = value
    }
    saveTask(task)
    event(task, 'checkpoint', {
      created,
      fields: fields.filter((field) => option(`--${field}`)),
    })
    appendNotes(
      task,
      `Checkpoint: ${task.stage}`,
      fields.map((field) => (task[field] ? `${field}: ${task[field]}` : '')),
    )
    console.log(
      created
        ? `Started and checkpointed ${task.id}`
        : `Checkpointed ${task.id}`,
    )
    break
  }
  case 'save': {
    const task = targetTask()
    const fields = ['goal', 'scope', 'acceptance', 'next'] as const
    for (const field of fields) {
      const value = option(`--${field}`)
      if (value) task[field] = value
    }
    saveTask(task)
    event(task, 'saved', {
      fields: fields.filter((field) => option(`--${field}`)),
    })
    appendNotes(
      task,
      `Save: ${task.stage}`,
      fields.map((field) => (task[field] ? `${field}: ${task[field]}` : '')),
    )
    console.log('Saved')
    break
  }
  case 'next': {
    const task = targetTask()
    const toRaw = option('--to')
    if (toRaw && !validStages.has(toRaw as Stage))
      die(`Unknown stage: ${toRaw}`)
    const to = (toRaw ?? defaultNext(task.stage)) as Stage
    if (task.stage === 'finish' && to === 'done')
      die('Use latch done after user asks to finish/archive.')
    if (!canAdvance(task, to))
      die(
        `Cannot advance ${task.stage} -> ${to}; missing required task fields or passing verification.`,
      )
    const from = task.stage
    task.stage = to
    if (to === 'blocked') task.status = 'blocked'
    saveTask(task)
    event(task, 'stage_changed', { from, to, reason: option('--reason') })
    scaffoldForStage(task, to)
    console.log(`${from} -> ${to}`)
    break
  }
  case 'verify': {
    const separator = args.indexOf('--')
    const verifyArgs = separator >= 0 ? args.slice(separator + 1) : args
    if (verifyArgs.length === 0) die('Usage: latch verify -- <command>')
    const task = targetTask()
    const result = spawnSync(verifyArgs[0], verifyArgs.slice(1), {
      cwd: root,
      stdio: 'inherit',
      shell: false,
    })
    task.latest_verify = {
      command: verifyArgs.join(' '),
      status: result.status === 0 ? 'pass' : 'fail',
      exit_code: result.status ?? 1,
      created_at: now(),
    }
    saveTask(task)
    event(task, 'verified', task.latest_verify)
    process.exit(task.latest_verify.exit_code)
    break
  }
  case 'resume': {
    const current = currentTaskId()
    if (!current) {
      console.log('No current task.')
      break
    }
    const task = targetTask()
    const brief = args.includes('--brief')
    console.log(`Task: ${task.title}`)
    console.log(`Stage: ${task.stage}`)
    if (task.goal) console.log(`Goal: ${task.goal}`)
    if (task.next) console.log(`Next: ${task.next}`)
    console.log(
      `Verify: ${task.latest_verify ? `${task.latest_verify.status} ${task.latest_verify.command}` : 'none'}`,
    )
    // verify 已 pass 但 stage 没走到 finish:通常 verify 提前跑了或 next 没推进,工作可能已实际完成却悬挂在中间阶段。提示先推进到 finish 再归档,免得下一轮 resume 看到一个 triage 任务却其实已经做完了。
    if (task.latest_verify?.status === 'pass' && task.stage !== 'finish') {
      console.log(
        `Note: verify passed but stage is ${task.stage}, not finish. Run \`latch next\` to advance, then \`latch done\` to archive.`,
      )
    }
    // 跨会话续接靠 notes.md：上次 grill 结论、plan 取舍、closure 都在里面，省得下一轮重新问一遍
    // brief 模式:砍 notes 全文(任务长时堆积成噪音),改输出最近 5 条 events + notes 路径,AI 想看细节自己读文件。
    if (brief) {
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
    break
  }
  case 'context': {
    const id = args.find((arg) => !arg.startsWith('--'))
    const task = id ? readTask(id) : targetTask()
    const context = taskContext(task)
    if (args.includes('--json')) {
      console.log(JSON.stringify(context, null, 2))
    } else {
      console.log(`Task: ${context.title}`)
      console.log(`Stage: ${context.stage}`)
      if (!args.includes('--brief')) {
        if (context.goal) console.log(`Goal: ${context.goal}`)
        if (context.scope) console.log(`Scope: ${context.scope}`)
        if (context.acceptance) console.log(`Acceptance: ${context.acceptance}`)
      }
      if (context.next) console.log(`Next: ${context.next}`)
      console.log(
        `Verify: ${context.latest_verify ? `${context.latest_verify.status} ${context.latest_verify.command}` : 'none'}`,
      )
      console.log(`Notes: ${context.notes_path}`)
    }
    break
  }
  case 'list': {
    ensureInit()
    const current = currentTaskId()
    const tasks = openTaskIds().map((id) => readTask(id))
    if (args.includes('--json')) {
      console.log(
        JSON.stringify(
          {
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
          `${marker}${task.status}\t${task.stage}\t${task.id}\t${task.title}`,
        )
      }
    }
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
    const task = targetTask()
    if (task.stage !== 'finish') die('Task must be in finish stage.')
    if (task.latest_verify?.status !== 'pass')
      die('Latest verification must pass.')
    task.stage = 'done'
    task.status = 'done'
    saveTask(task)
    event(task, 'done')
    archiveTask(task)
    console.log(`Archived ${task.id}`)
    break
  }
  case 'abandon': {
    const task = targetTask()
    const reason = option('--reason')
    task.stage = 'abandoned'
    task.status = 'abandoned'
    saveTask(task)
    event(task, 'abandoned', reason ? { reason } : {})
    if (reason) appendNotes(task, 'Abandoned', [`reason: ${reason}`])
    archiveTask(task)
    console.log(`Abandoned ${task.id}`)
    break
  }
  default:
    console.log(
      'Usage: latch <init|start|checkpoint|save|next|verify|resume|list|log|done|abandon|use|context>',
    )
}
