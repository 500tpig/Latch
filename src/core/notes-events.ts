import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { taskPath } from './task-store.js'
import { now } from './utils.js'
import type { Task } from './types.js'

const MAX_EVENT_VALUE_LENGTH = 160

export function event(task: Task, type: string, fields: Record<string, unknown> = {}) {
  writeFileSync(
    join(taskPath(task.id), 'events.jsonl'),
    `${JSON.stringify({ type, ...fields, created_at: now() })}\n`,
    { flag: 'a' },
  )
}

export function truncateEventValue(value: unknown, maxLength = MAX_EVENT_VALUE_LENGTH): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`
}

// 把一条 event 压成一行:type + 关键字段 + 时间。brief 模式替代 notes 全文,让 AI 看到最近动作而不被 markdown 噪音淹没。
type FormatEventOptions = {
  truncateValues?: boolean
}

export function formatEvent(entry: Record<string, unknown>, options: FormatEventOptions = {}): string {
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
      detail = `${entry.status} ${options.truncateValues ? truncateEventValue(entry.command) : entry.command}`
      break
    default:
      detail = ''
  }
  return `${type}  ${detail}  @ ${time}`.replace(/\s+/g, ' ').trim()
}

// 取 events.jsonl 最后 N 条并格式化成一行。events.jsonl 是追加的 jsonl,tail 即最近。
export function recentEvents(task: Task, count: number, options: FormatEventOptions = {}): string[] {
  const eventsPath = join(taskPath(task.id), 'events.jsonl')
  if (!existsSync(eventsPath)) return []
  const lines = readFileSync(eventsPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
  return lines
    .slice(-count)
    .map((line) => formatEvent(JSON.parse(line) as Record<string, unknown>, options))
}

export function appendNotes(task: Task, heading: string, lines: string[]) {
  writeFileSync(
    join(taskPath(task.id), 'notes.md'),
    `\n## ${heading}\n\n${lines.filter(Boolean).join('\n')}\n`,
    { flag: 'a' },
  )
}
