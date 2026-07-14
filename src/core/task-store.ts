import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync as readDirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { discoverWorkspaceRoot, pathsForWorkspace } from './paths.js'
import type { LatchPathsV2 } from './paths.js'
import { now, readJsonFile, slug, writeJsonAtomic } from './utils.js'
import {
  appendTaskEventV2,
  readTaskEventsV2,
  validateTaskEventV2,
} from './notes-events.js'
import { TASK_EVENT_TYPES } from './types.js'
import type {
  LatchStateV2,
  TaskArtifact,
  TaskEvent,
  TaskEventType,
  TaskPlan,
  TaskV2,
} from './types.js'

const V2_SCHEMA_VERSION = 2 as const
const STALE_LOCK_MILLISECONDS = 60_000
const CANONICAL_TASK_ID =
  /^\d{17}-[a-z0-9\u4e00-\u9fa5]+(?:-[a-z0-9\u4e00-\u9fa5]+)*-[a-f0-9]{6}$/
const taskEventTypes = new Set<TaskEventType>(TASK_EVENT_TYPES)

export type TaskStoreV2 = {
  paths: LatchPathsV2
}

export type CreateTaskV2Input = {
  title: string
  plan: TaskPlan
  artifacts?: TaskArtifact[]
}

export type TaskWriteResultV2 = {
  task: TaskV2
  warnings: string[]
}

export type TaskEventInputV2 = {
  type: TaskEventType
  fields?: Record<string, unknown>
}

export type UpdateTaskV2Options = {
  expectRevision: number
  actor: string
  events: TaskEventInputV2[]
  update: (task: TaskV2) => void
}

export type ArchiveTaskV2Options = {
  expectRevision: number
  actor: string
  outcome: 'done' | 'abandoned'
  update?: (task: TaskV2) => void
  eventFields?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(
  value: unknown,
  field: string,
  path: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Invalid ${field} in ${path}.`)
}

function requireInteger(value: unknown, field: string, path: string, minimum: number) {
  if (!Number.isInteger(value) || (value as number) < minimum)
    throw new Error(`Invalid ${field} in ${path}.`)
}

function requireStringArray(
  value: unknown,
  field: string,
  path: string,
): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    throw new Error(`Invalid ${field} in ${path}.`)
}

function assertTaskPlan(plan: unknown, path: string): asserts plan is TaskPlan {
  if (!isRecord(plan)) throw new Error(`Invalid plan in ${path}.`)
  requireString(plan.goal, 'plan.goal', path)
  for (const field of [
    'scope',
    'acceptance',
    'approach',
    'api_assumptions',
    'permission_assumptions',
    'data_assumptions',
    'user_flow',
    'out_of_scope',
    'open_questions',
  ])
    requireStringArray(plan[field], `plan.${field}`, path)

  if (!Array.isArray(plan.verification_plan))
    throw new Error(`Invalid plan.verification_plan in ${path}.`)
  const verificationNames = new Set<string>()
  for (const verification of plan.verification_plan) {
    if (!isRecord(verification))
      throw new Error(`Invalid plan.verification_plan in ${path}.`)
    requireString(verification.name, 'verification_plan.name', path)
    requireStringArray(verification.command, 'verification_plan.command', path)
    if (verification.command.length === 0)
      throw new Error(`Invalid empty verification_plan.command in ${path}.`)
    if (verificationNames.has(verification.name))
      throw new Error(`Duplicate verification_plan.name in ${path}: ${verification.name}.`)
    verificationNames.add(verification.name)
    if (verification.kind !== 'gate' && verification.kind !== 'diagnostic')
      throw new Error(`Invalid verification_plan.kind in ${path}.`)
  }
}

function assertStateV2(value: unknown, path: string): asserts value is LatchStateV2 {
  if (!isRecord(value) || value.schema_version !== V2_SCHEMA_VERSION)
    throw new Error(`Unsupported or invalid Latch schema in ${path}.`)
  const unknownKeys = Object.keys(value).filter(
    (key) => key !== 'schema_version' && key !== 'actors',
  )
  if (unknownKeys.length > 0)
    throw new Error(`Invalid state fields in ${path}: ${unknownKeys.join(', ')}.`)
  if (!isRecord(value.actors)) throw new Error(`Invalid actors in ${path}.`)
  for (const [actor, actorState] of Object.entries(value.actors)) {
    requireString(actor, 'actor', path)
    if (!isRecord(actorState)) throw new Error(`Invalid actor state in ${path}.`)
    const actorKeys = Object.keys(actorState).filter(
      (key) => key !== 'current_task_id',
    )
    if (actorKeys.length > 0)
      throw new Error(`Invalid actor state fields in ${path}: ${actorKeys.join(', ')}.`)
    if (
      actorState.current_task_id !== undefined &&
      (typeof actorState.current_task_id !== 'string' ||
        !CANONICAL_TASK_ID.test(actorState.current_task_id))
    )
      throw new Error(`Invalid current_task_id in ${path}.`)
  }
}

function assertVerificationMap(
  value: unknown,
  field: string,
  expectedKind: 'gate' | 'diagnostic',
  path: string,
) {
  if (!isRecord(value)) throw new Error(`Invalid ${field} in ${path}.`)
  for (const [name, result] of Object.entries(value)) {
    if (!isRecord(result)) throw new Error(`Invalid ${field}.${name} in ${path}.`)
    requireString(result.name, `${field}.${name}.name`, path)
    if (result.name !== name)
      throw new Error(`Verification name does not match key ${field}.${name} in ${path}.`)
    requireStringArray(result.command, `${field}.${name}.command`, path)
    requireInteger(result.exit_code, `${field}.${name}.exit_code`, path, 0)
    requireInteger(result.work_revision, `${field}.${name}.work_revision`, path, 0)
    requireString(result.created_at, `${field}.${name}.created_at`, path)
    if (result.kind !== expectedKind)
      throw new Error(`Invalid ${field}.${name}.kind in ${path}.`)
    if (result.status !== 'pass' && result.status !== 'fail')
      throw new Error(`Invalid ${field}.${name}.status in ${path}.`)
  }
}

// 读盘后和写盘前复用同一份 schema 校验，避免把无效中间状态写进 task.json。
function assertTaskV2(value: unknown, path: string): asserts value is TaskV2 {
  if (!isRecord(value) || value.schema_version !== V2_SCHEMA_VERSION)
    throw new Error(`Unsupported or invalid Latch task schema in ${path}.`)
  requireString(value.id, 'id', path)
  if (!CANONICAL_TASK_ID.test(value.id as string))
    throw new Error(`Invalid canonical task id in ${path}.`)
  requireString(value.title, 'title', path)
  requireString(value.workspace_root, 'workspace_root', path)
  requireString(value.created_at, 'created_at', path)
  requireString(value.updated_at, 'updated_at', path)
  if (!['plan', 'dev', 'check', 'review'].includes(value.phase as string))
    throw new Error(`Invalid phase in ${path}.`)
  if (
    value.outcome !== undefined &&
    value.outcome !== 'done' &&
    value.outcome !== 'abandoned'
  )
    throw new Error(`Invalid outcome in ${path}.`)
  requireInteger(value.revision, 'revision', path, 1)
  requireInteger(value.plan_revision, 'plan_revision', path, 1)
  requireInteger(value.work_revision, 'work_revision', path, 0)
  assertTaskPlan(value.plan, path)
  if (!isRecord(value.verification))
    throw new Error(`Invalid verification in ${path}.`)
  assertVerificationMap(
    value.verification.gate,
    'verification.gate',
    'gate',
    path,
  )
  assertVerificationMap(
    value.verification.diagnostic,
    'verification.diagnostic',
    'diagnostic',
    path,
  )
  if (value.implementation_approval !== undefined) {
    const approval = value.implementation_approval
    if (!isRecord(approval))
      throw new Error(`Invalid implementation_approval in ${path}.`)
    requireInteger(
      approval.approved_plan_revision,
      'implementation_approval.approved_plan_revision',
      path,
      1,
    )
    requireString(
      approval.approved_at,
      'implementation_approval.approved_at',
      path,
    )
    requireString(approval.reason, 'implementation_approval.reason', path)
    if (approval.source !== 'user')
      throw new Error(`Invalid implementation_approval.source in ${path}.`)
  }
  if (value.blocked !== undefined) {
    if (!isRecord(value.blocked)) throw new Error(`Invalid blocked in ${path}.`)
    requireString(value.blocked.reason, 'blocked.reason', path)
    requireString(value.blocked.waiting_for, 'blocked.waiting_for', path)
    requireString(value.blocked.blocked_at, 'blocked.blocked_at', path)
  }
  if (value.submission !== undefined) {
    if (!isRecord(value.submission))
      throw new Error(`Invalid submission in ${path}.`)
    requireInteger(
      value.submission.work_revision,
      'submission.work_revision',
      path,
      0,
    )
    requireString(value.submission.changes, 'submission.changes', path)
    if (typeof value.submission.verified !== 'string')
      throw new Error(`Invalid submission.verified in ${path}.`)
    if (typeof value.submission.unverified !== 'string')
      throw new Error(`Invalid submission.unverified in ${path}.`)
    requireString(value.submission.submitted_at, 'submission.submitted_at', path)
    if (value.submission.no_verify !== undefined) {
      if (!isRecord(value.submission.no_verify))
        throw new Error(`Invalid submission.no_verify in ${path}.`)
      requireString(
        value.submission.no_verify.reason,
        'submission.no_verify.reason',
        path,
      )
    }
  }
  if (value.closure !== undefined) {
    if (!isRecord(value.closure)) throw new Error(`Invalid closure in ${path}.`)
    requireString(value.closure.changes, 'closure.changes', path)
    if (typeof value.closure.verified !== 'string')
      throw new Error(`Invalid closure.verified in ${path}.`)
    if (typeof value.closure.unverified !== 'string')
      throw new Error(`Invalid closure.unverified in ${path}.`)
    if (typeof value.closure.followup !== 'string')
      throw new Error(`Invalid closure.followup in ${path}.`)
    requireString(value.closure.accepted_at, 'closure.accepted_at', path)
  }
  if (!Array.isArray(value.artifacts))
    throw new Error(`Invalid artifacts in ${path}.`)
  for (const artifact of value.artifacts) {
    if (!isRecord(artifact)) throw new Error(`Invalid artifact in ${path}.`)
    requireString(artifact.kind, 'artifact.kind', path)
    requireString(artifact.path, 'artifact.path', path)
  }
}

function assertActor(actor: string) {
  if (!actor.trim()) throw new Error('Actor is required.')
}

function assertExpectedRevision(revision: number) {
  if (!Number.isInteger(revision) || revision < 1)
    throw new Error('expectRevision must be a positive integer.')
}

function assertTaskIdToken(id: string) {
  if (!id.trim() || id.includes('/') || id.includes('\\') || id.includes('..'))
    throw new Error(`Invalid task id: ${id}`)
}

function taskDirectoryV2(store: TaskStoreV2, id: string) {
  assertTaskIdToken(id)
  return join(store.paths.tasksDir, id)
}

function taskJsonPathV2(store: TaskStoreV2, id: string) {
  return join(taskDirectoryV2(store, id), 'task.json')
}

function lockMetadataIsStale(path: string) {
  try {
    const metadata = readJsonFile<{ pid: number; created_at: string }>(path)
    if (!Number.isInteger(metadata.pid) || !metadata.created_at) return false
    const age = Date.now() - Date.parse(metadata.created_at)
    if (!Number.isFinite(age) || age <= STALE_LOCK_MILLISECONDS) return false
    try {
      process.kill(metadata.pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  } catch {
    return false
  }
}

function createLockFile(path: string) {
  let fileDescriptor: number | undefined
  let created = false
  try {
    fileDescriptor = openSync(path, 'wx', 0o600)
    created = true
    writeFileSync(
      fileDescriptor,
      `${JSON.stringify({ pid: process.pid, created_at: now() }, null, 2)}\n`,
    )
    fsyncSync(fileDescriptor)
    const descriptor = fileDescriptor
    fileDescriptor = undefined
    closeSync(descriptor)
  } catch (error) {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor)
    if (created) rmSync(path, { force: true })
    throw error
  }
}

// 锁只覆盖一次读取、revision 校验和原子写；不同 task 与 state 使用不同锁文件。
function withV2Lock<T>(path: string, fn: () => T): T {
  let acquired = false
  try {
    try {
      createLockFile(path)
      acquired = true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST' && lockMetadataIsStale(path)) {
        rmSync(path, { force: true })
        createLockFile(path)
        acquired = true
      } else if (code === 'EEXIST') {
        throw new Error(`Latch lock is busy: ${path}`)
      } else {
        throw error
      }
    }
    return fn()
  } finally {
    if (acquired) rmSync(path, { force: true })
  }
}

export function withTaskLockV2<T>(
  store: TaskStoreV2,
  id: string,
  fn: () => T,
): T {
  assertTaskIdToken(id)
  return withV2Lock(join(store.paths.taskLocksDir, `${id}.lock`), fn)
}

export function withStateLockV2<T>(store: TaskStoreV2, fn: () => T): T {
  return withV2Lock(store.paths.stateLockPath, fn)
}

function ensureV2Directories(paths: LatchPathsV2) {
  mkdirSync(paths.tasksDir, { recursive: true })
  mkdirSync(paths.archiveDir, { recursive: true })
  mkdirSync(paths.taskLocksDir, { recursive: true })
}

// 初始化只接受空目录或既有 v2；遇到 v1 时不迁移、不覆盖。
export function initTaskStoreV2(cwd: string): TaskStoreV2 {
  const workspaceRoot = discoverWorkspaceRoot(cwd, { forInit: true })
  const paths = pathsForWorkspace(workspaceRoot)

  if (existsSync(paths.latchDir)) {
    if (!existsSync(paths.statePath))
      throw new Error(
        `Existing Latch data is not schema v2: ${paths.latchDir}. Back it up before initializing v2.`,
      )
    const existingState = readJsonFile<unknown>(paths.statePath)
    assertStateV2(existingState, paths.statePath)
    ensureV2Directories(paths)
    return { paths }
  }

  ensureV2Directories(paths)
  const initialState: LatchStateV2 = {
    schema_version: V2_SCHEMA_VERSION,
    actors: {},
  }
  writeJsonAtomic(paths.statePath, initialState)
  return { paths }
}

// 只读打开不得创建目录；v1 或损坏的 state 会直接带路径报错。
export function openTaskStoreV2(cwd: string): TaskStoreV2 {
  const workspaceRoot = discoverWorkspaceRoot(cwd)
  const paths = pathsForWorkspace(workspaceRoot)
  if (!existsSync(paths.statePath))
    throw new Error(`Latch is not initialized: ${paths.latchDir}`)
  const currentState = readJsonFile<unknown>(paths.statePath)
  assertStateV2(currentState, paths.statePath)
  return { paths }
}

export function readStateV2(store: TaskStoreV2): LatchStateV2 {
  const value = readJsonFile<unknown>(store.paths.statePath)
  assertStateV2(value, store.paths.statePath)
  return value
}

function writeStateV2(store: TaskStoreV2, value: LatchStateV2) {
  assertStateV2(value, store.paths.statePath)
  writeJsonAtomic(store.paths.statePath, value)
}

export function openTaskIdsV2(store: TaskStoreV2) {
  if (!existsSync(store.paths.tasksDir)) return []
  return readDirSync(store.paths.tasksDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(store.paths.tasksDir, entry.name, 'task.json')),
    )
    .map((entry) => entry.name)
    .sort()
}

export function resolveOpenTaskIdV2(store: TaskStoreV2, id: string) {
  assertTaskIdToken(id)
  if (existsSync(taskJsonPathV2(store, id))) return id
  const matches = openTaskIdsV2(store).filter((taskId) => taskId.startsWith(id))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1)
    throw new Error(`Task id is ambiguous: ${id}. Matches: ${matches.join(', ')}`)
  throw new Error(`Task not found: ${id}`)
}

function readCanonicalTaskV2(store: TaskStoreV2, canonicalId: string): TaskV2 {
  const path = taskJsonPathV2(store, canonicalId)
  const value = readJsonFile<unknown>(path)
  assertTaskV2(value, path)
  if (value.id !== canonicalId)
    throw new Error(`Task id does not match its directory in ${path}.`)
  if (value.workspace_root !== store.paths.workspaceRoot)
    throw new Error(`Task workspace_root does not match ${store.paths.workspaceRoot}: ${path}.`)
  return value
}

export function readTaskV2(store: TaskStoreV2, id: string): TaskV2 {
  return readCanonicalTaskV2(store, resolveOpenTaskIdV2(store, id))
}

export function readArchivedTaskV2(
  store: TaskStoreV2,
  id: string,
): TaskV2 | undefined {
  assertTaskIdToken(id)
  if (!existsSync(store.paths.archiveDir)) return undefined
  for (const month of readDirSync(store.paths.archiveDir, { withFileTypes: true })) {
    if (!month.isDirectory()) continue
    const path = join(store.paths.archiveDir, month.name, id, 'task.json')
    if (!existsSync(path)) continue
    const value = readJsonFile<unknown>(path)
    assertTaskV2(value, path)
    if (value.id !== id)
      throw new Error(`Task id does not match its archive directory in ${path}.`)
    if (value.workspace_root !== store.paths.workspaceRoot)
      throw new Error(`Task workspace_root does not match ${store.paths.workspaceRoot}: ${path}.`)
    return value
  }
  return undefined
}

export function taskHistoryIncompleteV2(store: TaskStoreV2, id: string) {
  const task = readTaskV2(store, id)
  const revisions = new Set(
    readTaskEventsV2(taskDirectoryV2(store, task.id)).map((entry) => entry.revision),
  )
  for (let revision = 1; revision <= task.revision; revision += 1)
    if (!revisions.has(revision)) return true
  return false
}

export function taskEventsV2(store: TaskStoreV2, id: string) {
  const task = readTaskV2(store, id)
  return readTaskEventsV2(taskDirectoryV2(store, task.id))
}

export function listTasksV2(store: TaskStoreV2): TaskV2[] {
  return openTaskIdsV2(store)
    .map((id) => readCanonicalTaskV2(store, id))
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
}

export function worktreeOccupantV2(
  store: TaskStoreV2,
  exceptTaskId?: string,
): TaskV2 | undefined {
  return listTasksV2(store).find(
    (task) =>
      task.id !== exceptTaskId &&
      (task.phase === 'dev' || task.phase === 'check' || task.phase === 'review'),
  )
}

function makeTaskId(title: string) {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17)
  return `${timestamp}-${slug(title)}-${randomBytes(3).toString('hex')}`
}

function makeTaskEvent(
  task: TaskV2,
  type: TaskEventType,
  actor: string,
  fields: Record<string, unknown> = {},
): TaskEvent {
  return {
    ...fields,
    type,
    task_id: task.id,
    actor,
    revision: task.revision,
    created_at: now(),
  } as TaskEvent
}

function eventWriteWarning(task: TaskV2, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return `Task ${task.id} revision ${task.revision} was committed, but its event was not recorded: ${message}`
}

// 创建前完成输入与 schema 校验，成功后把 canonical ID 写入当前 actor state。
export function createTaskV2(
  store: TaskStoreV2,
  input: CreateTaskV2Input,
  actor: string,
): TaskWriteResultV2 {
  assertActor(actor)
  requireString(input.title, 'title', 'checkpoint input')
  assertTaskPlan(input.plan, 'checkpoint input')
  const artifacts = structuredClone(input.artifacts ?? [])
  for (const artifact of artifacts) {
    requireString(artifact.kind, 'artifact.kind', 'checkpoint input')
    requireString(artifact.path, 'artifact.path', 'checkpoint input')
  }

  let id = makeTaskId(input.title)
  while (existsSync(taskDirectoryV2(store, id))) id = makeTaskId(input.title)
  const timestamp = now()
  const task: TaskV2 = {
    schema_version: V2_SCHEMA_VERSION,
    id,
    title: input.title.trim(),
    phase: 'plan',
    revision: 1,
    plan_revision: 1,
    work_revision: 0,
    workspace_root: store.paths.workspaceRoot,
    plan: structuredClone(input.plan),
    verification: {
      gate: {},
      diagnostic: {},
    },
    artifacts,
    created_at: timestamp,
    updated_at: timestamp,
  }
  const taskDirectory = taskDirectoryV2(store, id)
  const taskPath = taskJsonPathV2(store, id)
  assertTaskV2(task, taskPath)
  const creationEvent = makeTaskEvent(task, 'task_created', actor)
  validateTaskEventV2(creationEvent, join(taskDirectory, 'events.jsonl'))

  const warnings: string[] = []
  withTaskLockV2(store, id, () => {
    let taskCommitted = false
    try {
      mkdirSync(taskDirectory)
      writeJsonAtomic(taskPath, task)
      taskCommitted = true
    } catch (error) {
      if (!taskCommitted) rmSync(taskDirectory, { recursive: true, force: true })
      throw error
    }
    try {
      appendTaskEventV2(taskDirectory, creationEvent)
    } catch (error) {
      warnings.push(eventWriteWarning(task, error))
    }
  })
  try {
    selectCurrentTaskV2(store, actor, id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(
      `Task ${id} was created, but it was not selected as current: ${message}`,
    )
  }
  return { task, warnings }
}

export function currentTaskIdV2(store: TaskStoreV2, actor: string) {
  assertActor(actor)
  const id = readStateV2(store).actors[actor]?.current_task_id
  if (!id || !existsSync(taskJsonPathV2(store, id))) return undefined
  return id
}

// ID 前缀只用于查找，state 始终保存 canonical 完整 ID；use 不修改 task 历史。
export function selectCurrentTaskV2(
  store: TaskStoreV2,
  actor: string,
  id: string,
) {
  assertActor(actor)
  const canonicalId = resolveOpenTaskIdV2(store, id)
  withTaskLockV2(store, canonicalId, () => {
    readCanonicalTaskV2(store, canonicalId)
    withStateLockV2(store, () => {
      const current = readStateV2(store)
      const next: LatchStateV2 = {
        schema_version: V2_SCHEMA_VERSION,
        actors: {
          ...current.actors,
          [actor]: { current_task_id: canonicalId },
        },
      }
      writeStateV2(store, next)
    })
  })
  return canonicalId
}

function lastTaskActor(store: TaskStoreV2, task: TaskV2) {
  const events = readTaskEventsV2(taskDirectoryV2(store, task.id))
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.revision === task.revision) return event.actor
  }
  return 'unknown'
}

function assertImmutableTaskFields(current: TaskV2, next: TaskV2) {
  const changed = [
    next.schema_version !== current.schema_version && 'schema_version',
    next.id !== current.id && 'id',
    next.revision !== current.revision && 'revision',
    next.workspace_root !== current.workspace_root && 'workspace_root',
    next.created_at !== current.created_at && 'created_at',
    next.updated_at !== current.updated_at && 'updated_at',
  ].filter(Boolean)
  if (changed.length > 0)
    throw new Error(`Task update changed immutable fields: ${changed.join(', ')}.`)
}

function assertRevisionMatches(
  store: TaskStoreV2,
  task: TaskV2,
  expectedRevision: number,
) {
  if (task.revision === expectedRevision) return
  throw new Error(
    `Task changed: expected revision ${expectedRevision}, current revision ${task.revision}.\n` +
      `Changed by: ${lastTaskActor(store, task)}.\n` +
      `Run latch context ${task.id} --json --brief and retry.`,
  )
}

// task.json 是提交点；event 失败不会把已提交更新伪装成完全失败。
export function updateTaskV2(
  store: TaskStoreV2,
  id: string,
  options: UpdateTaskV2Options,
): TaskWriteResultV2 {
  assertExpectedRevision(options.expectRevision)
  assertActor(options.actor)
  if (options.events.length === 0)
    throw new Error('Task update requires at least one event.')
  for (const event of options.events)
    if (!taskEventTypes.has(event.type))
      throw new Error(`Unknown task event type: ${event.type}`)
  const canonicalId = resolveOpenTaskIdV2(store, id)

  return withTaskLockV2(store, canonicalId, () => {
    const current = readCanonicalTaskV2(store, canonicalId)
    assertRevisionMatches(store, current, options.expectRevision)
    const next = structuredClone(current)
    options.update(next)
    assertImmutableTaskFields(current, next)
    next.revision = current.revision + 1
    next.updated_at = now()
    const path = taskJsonPathV2(store, canonicalId)
    assertTaskV2(next, path)
    const events = options.events.map((event) =>
      makeTaskEvent(next, event.type, options.actor, event.fields),
    )
    for (const event of events)
      validateTaskEventV2(
        event,
        join(taskDirectoryV2(store, canonicalId), 'events.jsonl'),
      )
    writeJsonAtomic(path, next)
    const warnings: string[] = []
    for (const event of events) {
      try {
        appendTaskEventV2(taskDirectoryV2(store, canonicalId), event)
      } catch (error) {
        warnings.push(eventWriteWarning(next, error))
      }
    }
    return { task: next, warnings }
  })
}

function clearTaskFromStateV2(store: TaskStoreV2, id: string) {
  withStateLockV2(store, () => {
    const current = readStateV2(store)
    const actors = Object.fromEntries(
      Object.entries(current.actors).filter(
        ([, actorState]) => actorState.current_task_id !== id,
      ),
    )
    writeStateV2(store, {
      schema_version: V2_SCHEMA_VERSION,
      actors,
    })
  })
}

// 先提交归档目录，再清理所有 actor current；state 失败只返回 warning。
export function archiveTaskV2(
  store: TaskStoreV2,
  id: string,
  options: ArchiveTaskV2Options,
): TaskWriteResultV2 {
  assertExpectedRevision(options.expectRevision)
  assertActor(options.actor)
  const canonicalId = resolveOpenTaskIdV2(store, id)

  const archivedTask = withTaskLockV2(store, canonicalId, () => {
    const current = readCanonicalTaskV2(store, canonicalId)
    assertRevisionMatches(store, current, options.expectRevision)
    const next = structuredClone(current)
    options.update?.(next)
    assertImmutableTaskFields(current, next)
    next.outcome = options.outcome
    next.revision = current.revision + 1
    next.updated_at = now()
    const path = taskJsonPathV2(store, canonicalId)
    assertTaskV2(next, path)
    const event = makeTaskEvent(
      next,
      options.outcome,
      options.actor,
      options.eventFields,
    )
    validateTaskEventV2(
      event,
      join(taskDirectoryV2(store, canonicalId), 'events.jsonl'),
    )

    const month = next.updated_at.slice(0, 7)
    const targetParent = join(store.paths.archiveDir, month)
    const target = join(targetParent, canonicalId)
    if (existsSync(target)) throw new Error(`Archived task already exists: ${target}`)
    mkdirSync(targetParent, { recursive: true })
    writeJsonAtomic(path, next)
    const warnings: string[] = []
    try {
      appendTaskEventV2(taskDirectoryV2(store, canonicalId), event)
    } catch (error) {
      warnings.push(eventWriteWarning(next, error))
    }

    // 目录进入 archive 是归档提交点；state 只是可修复的 current 索引。
    renameSync(taskDirectoryV2(store, canonicalId), target)
    try {
      clearTaskFromStateV2(store, canonicalId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(
        `Task ${canonicalId} was archived, but current task state was not cleaned: ${message}`,
      )
    }
    return { task: next, warnings }
  })
  return archivedTask
}
