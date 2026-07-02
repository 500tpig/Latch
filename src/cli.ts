#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync as readDirSync,
  readFileSync,
  renameSync,
  rmSync,
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
  owner?: string
  goal?: string
  scope?: string
  acceptance?: string
  next?: string
  knowledge_decision?: 'generate' | 'skip'
  knowledge_reason?: string
  knowledge_decided_at?: string
  knowledge_card_path?: string
  latest_verify?: Verify
  created_at: string
  updated_at: string
}
type State = {
  current_task_id?: string
  active_task_id?: string
  actors?: Record<string, { current_task_id?: string }>
}
type Citation = {
  path: string
  symbol: string
  line?: number
  source_task: string
  unverified?: boolean
}
type KnowledgeCardMeta = {
  title: string
  source_task: string
  source_task_path: string
  source_notes_path: string
  modules: string[]
  keywords: string[]
  citations: Citation[]
  created_at: string
  draft: boolean
}
type KnowledgeCard = {
  meta: KnowledgeCardMeta
  body: string
  path: string
}
type ModuleCardMeta = {
  module: string
  task_cards: string[]
  source_tasks: string[]
  updated_at: string
}

const root = process.cwd()
const latchDir = join(root, '.latch')
const tasksDir = join(latchDir, 'tasks')
const archiveDir = join(latchDir, 'archive')
const knowledgeDir = join(latchDir, 'knowledge')
const knowledgeTasksDir = join(knowledgeDir, 'tasks')
const knowledgeModulesDir = join(knowledgeDir, 'modules')
const statePath = join(latchDir, 'state.json')
const lockDir = join(latchDir, '.lock')

const command = process.argv[2]
const args = process.argv.slice(3)
const usage =
  'Usage: latch <init|start|checkpoint|save|next|verify|resume|list|log|done|abandon|use|context|knowledge>'

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

function ensureKnowledgeDirs() {
  ensureInit()
  mkdirSync(knowledgeTasksDir, { recursive: true })
  mkdirSync(knowledgeModulesDir, { recursive: true })
}

function withLock<T>(fn: () => T): T {
  ensureInit()
  try {
    mkdirSync(lockDir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    die(`Latch is busy: ${message}`)
  }
  try {
    return fn()
  } finally {
    rmSync(lockDir, { recursive: true, force: true })
  }
}

function runLocked<T>(fn: () => T): T {
  try {
    return withLock(fn)
  } catch (error) {
    die(error instanceof Error ? error.message : String(error))
  }
}

function state(): State {
  ensureInit()
  return readJson<State>(statePath, {})
}

function actorId() {
  return process.env.LATCH_ACTOR || process.env.CODEX_THREAD_ID || 'default'
}

function taskPath(id: string) {
  return join(tasksDir, id)
}

function hasActorState(current: State) {
  return Boolean(current.actors && Object.keys(current.actors).length > 0)
}

function currentTaskId() {
  const current = state()
  const actorCurrent = current.actors?.[actorId()]?.current_task_id
  if (actorCurrent) return actorCurrent
  if (hasActorState(current)) return undefined
  return current.current_task_id ?? current.active_task_id
}

function writeCurrentTaskId(id?: string) {
  const current = state()
  const actor = actorId()
  const next: State = {
    ...current,
    current_task_id: id,
    actors: {
      ...(current.actors ?? {}),
      [actor]: id ? { current_task_id: id } : {},
    },
  }
  if (!id) {
    if (next.actors) delete next.actors[actor]
    if (next.actors && Object.keys(next.actors).length === 0) delete next.actors
    delete next.current_task_id
    delete next.active_task_id
  }
  writeJson(statePath, next)
}

function clearTaskFromState(id: string) {
  const current = state()
  const actors = Object.fromEntries(
    Object.entries(current.actors ?? {}).filter(
      ([, value]) => value.current_task_id !== id,
    ),
  )
  const next: State = {
    ...current,
    ...(current.current_task_id === id ? { current_task_id: undefined } : {}),
    ...(current.active_task_id === id ? { active_task_id: undefined } : {}),
  }
  if (Object.keys(actors).length > 0) next.actors = actors
  else delete next.actors
  if (!next.current_task_id) delete next.current_task_id
  if (!next.active_task_id) delete next.active_task_id
  writeJson(statePath, next)
}

function taskOwnedByAnotherActor(task: Task) {
  return Boolean(task.owner && task.owner !== actorId())
}

function wantsForce() {
  return args.includes('--force')
}

function claimTask(task: Task) {
  if (!task.owner) {
    task.owner = actorId()
    return true
  }
  if (task.owner === actorId()) return false
  if (wantsForce()) {
    task.owner = actorId()
    return true
  }
  throw new Error(
    `Task ${task.id} is owned by ${task.owner}. Re-run with --force to take ownership.`,
  )
}

function ensureTaskOwnedByActor(task: Task) {
  if (taskOwnedByAnotherActor(task))
    throw new Error(
      `Task ${task.id} is owned by ${task.owner}. Re-run with --force to take ownership.`,
    )
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

function targetTask(options: { write?: boolean } = {}): Task {
  const id = option('--task')
  const task = id ? readTask(id) : currentTask()
  if (options.write) claimTask(task)
  else if (!id) ensureTaskOwnedByActor(task)
  return task
}

function saveTask(task: Task) {
  task.updated_at = now()
  writeJson(join(taskPath(task.id), 'task.json'), task)
}

function createTask(title: string): Task {
  const id = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${slug(title)}`
  mkdirSync(taskPath(id), { recursive: true })
  const task: Task = {
    id,
    title,
    status: 'active',
    stage: 'triage',
    owner: actorId(),
    created_at: now(),
    updated_at: now(),
  }
  writeJson(join(taskPath(id), 'task.json'), task)
  writeFileSync(join(taskPath(id), 'notes.md'), `# ${title}\n`)
  return task
}

const TASK_FIELDS = ['goal', 'scope', 'acceptance', 'next'] as const
const KNOWLEDGE_DECISIONS = new Set(['generate', 'skip'])

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
  if (knowledgeDecision === 'generate') delete task.knowledge_card_path
  return changed
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

function ensureDoneReady(task: Task) {
  if (task.stage !== 'finish') throw new Error('Task must be in finish stage.')
  if (task.latest_verify?.status !== 'pass')
    throw new Error('Latest verification must pass.')
  if (!task.knowledge_decision)
    throw new Error(
      'Knowledge decision is required. Run `latch save --knowledge generate|skip --knowledge-reason "..."` first.',
    )
  if (!task.knowledge_reason)
    throw new Error('Knowledge decision requires `knowledge_reason`.')
  if (task.knowledge_decision === 'generate' && !task.knowledge_card_path)
    throw new Error(
      'Knowledge decision is generate, but no knowledge card exists. Run `latch knowledge generate` first.',
    )
}

function archiveTask(task: Task) {
  const month = new Date().toISOString().slice(0, 7)
  const targetDir = join(archiveDir, month)
  mkdirSync(targetDir, { recursive: true })
  renameSync(taskPath(task.id), join(targetDir, basename(task.id)))
  clearTaskFromState(task.id)
}

function openTaskIds() {
  ensureInit()
  return readDirSync(tasksDir).filter((id) =>
    existsSync(join(taskPath(id), 'task.json')),
  )
}

function openKnowledgeTaskCards() {
  ensureKnowledgeDirs()
  return readDirSync(knowledgeTasksDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(knowledgeTasksDir, name))
}

function taskContext(task: Task) {
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
    knowledge_card_path: task.knowledge_card_path ?? null,
    latest_verify: task.latest_verify ?? null,
    progress: progressSummary(task),
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
      '知识记忆：用 `latch save --knowledge generate|skip --knowledge-reason "..."` 记录',
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

function checkpointTitleArg() {
  return args.find(
    (a, index) =>
      !a.startsWith('--') &&
      args[index - 1] !== '--task' &&
      args[index - 1] !== '--goal' &&
      args[index - 1] !== '--scope' &&
      args[index - 1] !== '--acceptance' &&
      args[index - 1] !== '--next',
  )
}

function die(message: string): never {
  console.error(message)
  process.exit(1)
}

function help(message: string) {
  console.log(message)
  process.exit(0)
}

function commandEnv(cwd: string) {
  return { ...process.env, PWD: cwd }
}

function knowledgeUsage() {
  return [
    'Usage: latch knowledge <generate|recall|refresh-modules|verify> [options]',
    '  latch knowledge generate [--task <task-id>] [--draft] [--module a,b] [--keyword a,b] [--path <file>] [--symbol <name>] [--line <n>]',
    '  latch knowledge recall [--file <path>] [--keyword <term>] [--module <name>]',
    '  latch knowledge refresh-modules',
    '  latch knowledge verify [--task <task-id>|--all]',
  ].join('\n')
}

function splitCsv(value?: string) {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

function yamlScalar(value: string | number | boolean) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function yamlList(values: (string | number)[]) {
  return values.length ? `[${values.map((value) => yamlScalar(value)).join(', ')}]` : '[]'
}

function slugFile(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-|-$/g, '') || 'card'
  )
}

function knowledgeTaskCardPath(task: Task) {
  return join(knowledgeTasksDir, `${task.id}-${slugFile(task.title)}.md`)
}

function moduleCardPath(moduleName: string) {
  return join(knowledgeModulesDir, `${slugFile(moduleName)}.md`)
}

function parseFrontmatter(raw: string) {
  if (!raw.startsWith('---\n')) return { meta: {}, body: raw }
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) return { meta: {}, body: raw }
  const metaLines = raw.slice(4, end).split('\n')
  const meta: Record<string, unknown> = {}
  for (const line of metaLines) {
    const index = line.indexOf(':')
    if (index < 0) continue
    const key = line.slice(0, index).trim()
    const rawValue = line.slice(index + 1).trim()
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const items = rawValue
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => JSON.parse(item))
      meta[key] = items
      continue
    }
    if (rawValue === 'true' || rawValue === 'false') {
      meta[key] = rawValue === 'true'
      continue
    }
    if (/^\d+$/.test(rawValue)) {
      meta[key] = Number(rawValue)
      continue
    }
    meta[key] = JSON.parse(rawValue)
  }
  return { meta, body: raw.slice(end + 5) }
}

function readKnowledgeCard(path: string): KnowledgeCard {
  const raw = readFileSync(path, 'utf8')
  const parsed = parseFrontmatter(raw)
  const meta = parsed.meta as Record<string, unknown>
  const citationsRaw =
    typeof meta.citations === 'string'
      ? (JSON.parse(meta.citations) as Citation[])
      : Array.isArray(meta.citations)
        ? (meta.citations as string[]).map((item) => JSON.parse(item) as Citation)
        : []
  return {
    path,
    body: parsed.body.trim(),
    meta: {
      title: String(meta.title ?? ''),
      source_task: String(meta.source_task ?? ''),
      source_task_path: String(meta.source_task_path ?? ''),
      source_notes_path: String(meta.source_notes_path ?? ''),
      modules: Array.isArray(meta.modules) ? (meta.modules as string[]).map(String) : [],
      keywords: Array.isArray(meta.keywords) ? (meta.keywords as string[]).map(String) : [],
      citations: citationsRaw,
      created_at: String(meta.created_at ?? ''),
      draft: Boolean(meta.draft),
    },
  }
}

function writeKnowledgeCard(path: string, meta: KnowledgeCardMeta, body: string) {
  const lines = [
    '---',
    `title: ${yamlScalar(meta.title)}`,
    `source_task: ${yamlScalar(meta.source_task)}`,
    `source_task_path: ${yamlScalar(meta.source_task_path)}`,
    `source_notes_path: ${yamlScalar(meta.source_notes_path)}`,
    `modules: ${yamlList(meta.modules)}`,
    `keywords: ${yamlList(meta.keywords)}`,
    `citations: ${yamlScalar(JSON.stringify(meta.citations))}`,
    `created_at: ${yamlScalar(meta.created_at)}`,
    `draft: ${yamlScalar(meta.draft)}`,
    '---',
    '',
    body.trim(),
    '',
  ]
  writeFileSync(path, lines.join('\n'))
}

function firstNonFlag(values: string[]) {
  return values.find((value, index) => {
    if (value.startsWith('--')) return false
    const prev = values[index - 1]
    return prev !== '--task' && prev !== '--line'
  })
}

function buildKnowledgeMeta(task: Task) {
  const modules = splitCsv(option('--module'))
  const keywords = splitCsv(option('--keyword'))
  const path = option('--path')
  const symbol = option('--symbol')
  const line = option('--line')
  const citations: Citation[] = path
    ? [
        {
          path,
          symbol: symbol ?? 'unknown',
          ...(line ? { line: Number(line) } : {}),
          source_task: task.id,
        },
      ]
    : []
  return {
    title: task.title,
    source_task: task.id,
    source_task_path: join(taskPath(task.id), 'task.json'),
    source_notes_path: join(taskPath(task.id), 'notes.md'),
    modules,
    keywords,
    citations,
    created_at: now(),
    draft: args.includes('--draft'),
  } satisfies KnowledgeCardMeta
}

function writeModuleCards() {
  ensureKnowledgeDirs()
  const grouped = new Map<
    string,
    { taskCards: string[]; sourceTasks: string[]; titles: string[] }
  >()
  for (const cardPath of openKnowledgeTaskCards()) {
    const card = readKnowledgeCard(cardPath)
    for (const moduleName of card.meta.modules) {
      const group = grouped.get(moduleName) ?? {
        taskCards: [],
        sourceTasks: [],
        titles: [],
      }
      group.taskCards.push(cardPath)
      group.sourceTasks.push(card.meta.source_task)
      group.titles.push(card.meta.title)
      grouped.set(moduleName, group)
    }
  }
  for (const name of readDirSync(knowledgeModulesDir).filter((item) => item.endsWith('.md')))
    rmSync(join(knowledgeModulesDir, name), { force: true })
  for (const [moduleName, group] of grouped) {
    const meta: ModuleCardMeta = {
      module: moduleName,
      task_cards: group.taskCards,
      source_tasks: group.sourceTasks,
      updated_at: now(),
    }
    const body = ['# 模块知识卡', '', ...group.titles.map((title) => `- ${title}`)].join('\n')
    const lines = [
      '---',
      `module: ${yamlScalar(meta.module)}`,
      `task_cards: ${yamlList(meta.task_cards)}`,
      `source_tasks: ${yamlList(meta.source_tasks)}`,
      `updated_at: ${yamlScalar(meta.updated_at)}`,
      '---',
      '',
      body,
      '',
    ]
    writeFileSync(moduleCardPath(moduleName), lines.join('\n'))
  }
}

function recallKnowledge() {
  ensureKnowledgeDirs()
  const file = option('--file')
  const keyword = option('--keyword')
  const moduleName = option('--module')
  const cards = openKnowledgeTaskCards().map(readKnowledgeCard)
  const pathMatches = file
    ? cards.filter((card) => card.meta.citations.some((item) => item.path === file))
    : []
  if (pathMatches.length) {
    for (const card of pathMatches) console.log(`${card.meta.source_task}\tpath\t${card.path}`)
    return
  }
  const keywordMatches = keyword
    ? cards.filter(
        (card) =>
          card.meta.keywords.includes(keyword) ||
          card.body.includes(keyword) ||
          card.meta.title.includes(keyword),
      )
    : []
  if (keywordMatches.length) {
    for (const card of keywordMatches)
      console.log(`${card.meta.source_task}\tkeyword\t${card.path}`)
    return
  }
  if (moduleName) {
    const path = moduleCardPath(moduleName)
    if (existsSync(path)) {
      console.log(`module\t${moduleName}\t${path}`)
      return
    }
  }
  const taskId = firstNonFlag(args.slice(1))
  if (taskId) {
    const task = readTask(taskId)
    console.log(`${task.id}\ttask\t${join(taskPath(task.id), 'notes.md')}`)
    return
  }
  console.log('No knowledge match.')
}

function verifyKnowledgeCards(taskId?: string) {
  ensureKnowledgeDirs()
  const cards = openKnowledgeTaskCards()
    .map(readKnowledgeCard)
    .filter((card) => !taskId || card.meta.source_task === taskId)
  let changed = 0
  for (const card of cards) {
    const citations = card.meta.citations.map((item) => {
      const exists = existsSync(join(root, item.path))
      const symbolOk = item.symbol === 'unknown' ? false : spawnSync('rg', ['-n', item.symbol, join(root, item.path)], {
        encoding: 'utf8',
        env: commandEnv(root),
      }).status === 0
      const unverified = !(exists && symbolOk)
      if (unverified !== Boolean(item.unverified)) changed += 1
      return unverified ? { ...item, unverified: true } : { path: item.path, symbol: item.symbol, ...(item.line ? { line: item.line } : {}), source_task: item.source_task }
    })
    writeKnowledgeCard(card.path, { ...card.meta, citations }, card.body)
  }
  console.log(`Verified ${cards.length} knowledge card(s), updated ${changed} citation(s)`)
}

function commandUsage(name: string) {
  return (
    {
      init: 'Usage: latch init',
      start: 'Usage: latch start <title> [--use]',
      checkpoint:
        'Usage: latch checkpoint <title> [--goal ...] [--scope ...] [--acceptance ...] [--next ...] [--task <task-id>] [--new] [--force]',
      save: 'Usage: latch save [--goal ...] [--scope ...] [--acceptance ...] [--next ...] [--knowledge generate|skip] [--knowledge-reason "..."] [--task <task-id>]',
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

function wantsCommandHelp(name?: string) {
  if (!name) return false
  if (name === 'verify' || name === 'knowledge') {
    const separator = args.indexOf('--')
    const commandArgs = separator >= 0 ? args.slice(0, separator) : args
    return commandArgs.includes('--help') || commandArgs.includes('-h')
  }
  return args.includes('--help') || args.includes('-h')
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

function advanceBlockers(task: Task, to: Stage): string[] {
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

function canAdvance(task: Task, to: Stage) {
  return advanceBlockers(task, to).length === 0
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

function progressSummary(task: Task) {
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
        if (claimTask(task)) saveTask(task)
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
    const task = id ? readTask(id) : targetTask()
    if (args.includes('--json')) {
      console.log(JSON.stringify(taskContext(task), null, 2))
      break
    }
    const brief = args.includes('--brief')
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
      if (context.owner) console.log(`Owner: ${context.owner}`)
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
      if (context.progress.advance_to)
        console.log(`Advance target: ${context.progress.advance_to}`)
      console.log(`Can advance: ${context.progress.can_advance ? 'yes' : 'no'}`)
      console.log(`Next action: ${context.progress.next_action}`)
      if (context.progress.blocked_reasons.length > 0)
        console.log(`Blocked by: ${context.progress.blocked_reasons.join('; ')}`)
      console.log(`Notes: ${context.notes_path}`)
    }
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
          const meta = buildKnowledgeMeta(task)
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
          task.knowledge_card_path = path
          saveTask(task)
          console.log(`Generated ${path}`)
          break
        }
        case 'recall':
          recallKnowledge()
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
    ensureInit()
    const current = currentTaskId()
    const tasks = openTaskIds().map((id) => readTask(id))
    if (args.includes('--json')) {
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
