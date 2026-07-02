import {
  existsSync,
  mkdirSync,
  readdirSync as readDirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  knowledgeModulesDir,
  knowledgeTasksDir,
  repoRoot as root,
} from './paths.js'
import { now } from './utils.js'
import { ensureInit, taskPath } from './task-store.js'
import type {
  Citation,
  KnowledgeCard,
  KnowledgeCardMeta,
  ModuleCardMeta,
  Task,
} from './types.js'

export function ensureKnowledgeDirs() {
  ensureInit()
  mkdirSync(knowledgeTasksDir, { recursive: true })
  mkdirSync(knowledgeModulesDir, { recursive: true })
}

export function openKnowledgeTaskCards() {
  ensureKnowledgeDirs()
  return readDirSync(knowledgeTasksDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(knowledgeTasksDir, name))
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

export function knowledgeTaskCardPath(task: Task) {
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

export function readKnowledgeCard(path: string): KnowledgeCard {
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

export function writeKnowledgeCard(path: string, meta: KnowledgeCardMeta, body: string) {
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

export type KnowledgeGenerateOptions = {
  module?: string
  keyword?: string
  path?: string
  symbol?: string
  line?: string
  draft: boolean
}

export function buildKnowledgeMeta(task: Task, opts: KnowledgeGenerateOptions) {
  const modules = splitCsv(opts.module)
  const keywords = splitCsv(opts.keyword)
  const path = opts.path
  const symbol = opts.symbol
  const line = opts.line
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
    draft: opts.draft,
  } satisfies KnowledgeCardMeta
}

export function writeModuleCards() {
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

export type KnowledgeRecallOptions = {
  file?: string
  keyword?: string
  module?: string
}

export function recallKnowledge(opts: KnowledgeRecallOptions) {
  ensureKnowledgeDirs()
  const file = opts.file
  const keyword = opts.keyword
  const moduleName = opts.module
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
  console.log('No knowledge match.')
}

export function verifyKnowledgeCards(taskId?: string) {
  ensureKnowledgeDirs()
  const cards = openKnowledgeTaskCards()
    .map(readKnowledgeCard)
    .filter((card) => !taskId || card.meta.source_task === taskId)
  let changed = 0
  for (const card of cards) {
    const citations = card.meta.citations.map((item) => {
      const sourcePath = join(root, item.path)
      const exists = existsSync(sourcePath)
      const symbolOk =
        exists &&
        item.symbol !== 'unknown' &&
        readFileSync(sourcePath, 'utf8').includes(item.symbol)
      const unverified = !(exists && symbolOk)
      if (unverified !== Boolean(item.unverified)) changed += 1
      return unverified ? { ...item, unverified: true } : { path: item.path, symbol: item.symbol, ...(item.line ? { line: item.line } : {}), source_task: item.source_task }
    })
    writeKnowledgeCard(card.path, { ...card.meta, citations }, card.body)
  }
  console.log(`Verified ${cards.length} knowledge card(s), updated ${changed} citation(s)`)
}
