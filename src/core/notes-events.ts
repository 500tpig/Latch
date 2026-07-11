import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { TASK_EVENT_TYPES } from './types.js'
import type { TaskEvent } from './types.js'

const taskEventTypes = new Set<string>(TASK_EVENT_TYPES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateTaskEventV2(
  value: unknown,
  path: string,
): asserts value is TaskEvent {
  if (!isRecord(value) || !taskEventTypes.has(value.type as string))
    throw new Error(`Invalid event type in ${path}.`)
  if (typeof value.actor !== 'string' || !value.actor.trim())
    throw new Error(`Invalid event actor in ${path}.`)
  if (typeof value.task_id !== 'string' || !value.task_id.trim())
    throw new Error(`Invalid event task_id in ${path}.`)
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1)
    throw new Error(`Invalid event revision in ${path}.`)
  if (typeof value.created_at !== 'string' || !value.created_at.trim())
    throw new Error(`Invalid event created_at in ${path}.`)

  if (value.type === 'decision_recorded') {
    if (!Number.isInteger(value.plan_revision) || (value.plan_revision as number) < 1)
      throw new Error(`Invalid decision plan_revision in ${path}.`)
    if (typeof value.conclusion !== 'string' || !value.conclusion.trim())
      throw new Error(`Invalid decision conclusion in ${path}.`)
    if (value.question !== undefined && typeof value.question !== 'string')
      throw new Error(`Invalid decision question in ${path}.`)
    if (value.answer !== undefined && typeof value.answer !== 'string')
      throw new Error(`Invalid decision answer in ${path}.`)
  }
  if (value.type === 'review_feedback') {
    if (!Number.isInteger(value.plan_revision) || (value.plan_revision as number) < 1)
      throw new Error(`Invalid feedback plan_revision in ${path}.`)
    if (!Number.isInteger(value.work_revision) || (value.work_revision as number) < 0)
      throw new Error(`Invalid feedback work_revision in ${path}.`)
    if (
      value.classification !== 'implementation_correction' &&
      value.classification !== 'evaluative' &&
      value.classification !== 'plan_change'
    )
      throw new Error(`Invalid feedback classification in ${path}.`)
    if (typeof value.summary !== 'string' || !value.summary.trim())
      throw new Error(`Invalid feedback summary in ${path}.`)
  }
}

export function appendTaskEventV2(taskDirectory: string, eventEntry: TaskEvent) {
  const eventsPath = join(taskDirectory, 'events.jsonl')
  validateTaskEventV2(eventEntry, eventsPath)
  const fileDescriptor = openSync(eventsPath, 'a', 0o600)
  try {
    writeFileSync(fileDescriptor, `${JSON.stringify(eventEntry)}\n`)
    fsyncSync(fileDescriptor)
  } finally {
    closeSync(fileDescriptor)
  }
}

// v2 不再生成 notes.md；当前状态读 task.json，历史只从 events.jsonl 读取。
export function readTaskEventsV2(taskDirectory: string): TaskEvent[] {
  const eventsPath = join(taskDirectory, 'events.jsonl')
  if (!existsSync(eventsPath)) return []
  const lines = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean)
  return lines.map((line, index) => {
    const entryPath = `${eventsPath}:${index + 1}`
    try {
      const entry: unknown = JSON.parse(line)
      validateTaskEventV2(entry, entryPath)
      return entry
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Cannot read JSON ${entryPath}: ${message}`)
    }
  })
}
