import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { isWritableActor } from './actor.js'
import { TASK_EVENT_TYPES, TASK_EVENT_TYPES_V3 } from './types.js'
import type { TaskEvent } from './types.js'

const taskEventTypes = new Set<string>(TASK_EVENT_TYPES)
const taskEventTypesV3 = new Set<string>(TASK_EVENT_TYPES_V3)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateTaskEvent(
  value: unknown,
  path: string,
  eventTypes: Set<string>,
): asserts value is TaskEvent {
  if (!isRecord(value) || !eventTypes.has(value.type as string))
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
  if (value.type === 'writer_claimed') {
    if (!isWritableActor(value.actor as string))
      throw new Error(`Invalid writer_claimed actor in ${path}.`)
    if (
      value.reason !== undefined &&
      (typeof value.reason !== 'string' || !value.reason.trim())
    )
      throw new Error(`Invalid writer_claimed reason in ${path}.`)
  }
  if (value.type === 'writer_taken_over') {
    if (
      !isWritableActor(value.actor as string) ||
      !isWritableActor(value.from as string) ||
      !isWritableActor(value.to as string) ||
      value.actor !== value.to
    )
      throw new Error(`Invalid writer_taken_over actors in ${path}.`)
    if (typeof value.reason !== 'string' || !value.reason.trim())
      throw new Error(`Invalid writer_taken_over reason in ${path}.`)
  }
  if (value.type === 'implementation_authorized') {
    if (!Number.isInteger(value.plan_revision) || (value.plan_revision as number) < 1)
      throw new Error(`Invalid authorization plan_revision in ${path}.`)
    if (
      value.source !== 'user_request' &&
      value.source !== 'user_approve' &&
      value.source !== 'user_delta'
    )
      throw new Error(`Invalid authorization source in ${path}.`)
    if (typeof value.reason !== 'string' || !value.reason.trim())
      throw new Error(`Invalid authorization reason in ${path}.`)
    if (
      !isRecord(value.scope) ||
      typeof value.scope.summary !== 'string' ||
      !value.scope.summary.trim()
    )
      throw new Error(`Invalid authorization scope in ${path}.`)
  }
  if (value.type === 'retrospective_recorded') {
    if (!Number.isInteger(value.plan_revision) || (value.plan_revision as number) < 1)
      throw new Error(`Invalid retrospective plan_revision in ${path}.`)
    if (!Number.isInteger(value.work_revision) || (value.work_revision as number) < 1)
      throw new Error(`Invalid retrospective work_revision in ${path}.`)
    if (value.implemented_before_task !== true)
      throw new Error(`Invalid retrospective implemented_before_task in ${path}.`)
    if (typeof value.reason !== 'string' || !value.reason.trim())
      throw new Error(`Invalid retrospective reason in ${path}.`)
    if (typeof value.scope_summary !== 'string' || !value.scope_summary.trim())
      throw new Error(`Invalid retrospective scope_summary in ${path}.`)
  }
  if (value.type === 'profile_changed') {
    if (
      (value.from !== 'light' && value.from !== 'standard') ||
      (value.to !== 'light' && value.to !== 'standard') ||
      value.from === value.to
    )
      throw new Error(`Invalid profile change in ${path}.`)
    if (typeof value.reason !== 'string' || !value.reason.trim())
      throw new Error(`Invalid profile change reason in ${path}.`)
  }
  if (value.type === 'submission_knowledge_impact_patched') {
    if (!Number.isInteger(value.plan_revision) || (value.plan_revision as number) < 1)
      throw new Error(`Invalid patch plan_revision in ${path}.`)
    if (!Number.isInteger(value.work_revision) || (value.work_revision as number) < 0)
      throw new Error(`Invalid patch work_revision in ${path}.`)
    if (value.knowledge_impact_kind !== 'none' && value.knowledge_impact_kind !== 'updated')
      throw new Error(`Invalid patch knowledge_impact_kind in ${path}.`)
  }
}

export function validateTaskEventV2(
  value: unknown,
  path: string,
): asserts value is TaskEvent {
  validateTaskEvent(value, path, taskEventTypes)
}

export function validateTaskEventV3(
  value: unknown,
  path: string,
): asserts value is TaskEvent {
  validateTaskEvent(value, path, taskEventTypesV3)
}

type TaskEventValidator = (
  value: unknown,
  path: string,
) => asserts value is TaskEvent

function appendTaskEvent(
  taskDirectory: string,
  eventEntry: TaskEvent,
  validate: TaskEventValidator,
) {
  const eventsPath = join(taskDirectory, 'events.jsonl')
  validate(eventEntry, eventsPath)
  const fileDescriptor = openSync(eventsPath, 'a', 0o600)
  try {
    writeFileSync(fileDescriptor, `${JSON.stringify(eventEntry)}\n`)
    fsyncSync(fileDescriptor)
  } finally {
    closeSync(fileDescriptor)
  }
}

export function appendTaskEventV2(taskDirectory: string, eventEntry: TaskEvent) {
  appendTaskEvent(taskDirectory, eventEntry, validateTaskEventV2)
}

export function appendTaskEventV3(taskDirectory: string, eventEntry: TaskEvent) {
  appendTaskEvent(taskDirectory, eventEntry, validateTaskEventV3)
}

function readTaskEvents(
  taskDirectory: string,
  validate: TaskEventValidator,
): TaskEvent[] {
  const eventsPath = join(taskDirectory, 'events.jsonl')
  if (!existsSync(eventsPath)) return []
  const lines = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean)
  return lines.map((line, index) => {
    const entryPath = `${eventsPath}:${index + 1}`
    try {
      const entry: unknown = JSON.parse(line)
      validate(entry, entryPath)
      return entry
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Cannot read JSON ${entryPath}: ${message}`)
    }
  })
}

// v2 不再生成 notes.md；当前状态读 task.json，历史只从 events.jsonl 读取。
export function readTaskEventsV2(taskDirectory: string): TaskEvent[] {
  return readTaskEvents(taskDirectory, validateTaskEventV2)
}

export function readTaskEventsV3(taskDirectory: string): TaskEvent[] {
  return readTaskEvents(taskDirectory, validateTaskEventV3)
}
