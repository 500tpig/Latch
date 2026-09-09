import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync as readDirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  readTaskEventLogV3,
  readTaskEventLogV5,
  readTaskEventsV2,
} from '../notes-events.js'
import { discoverWorkspaceRoot, pathsForWorkspace } from '../paths.js'
import type { LatchPathsV2 } from '../paths.js'
import type { LatchStateV2, TaskEvent, TaskV2 } from '../types.js'
import { now, readJsonFile, writeJsonAtomic } from '../utils.js'
import type { ContextTaskReadV2, TaskStoreV2 } from './contracts.js'
import {
  V2_SCHEMA_VERSION,
  V5_SCHEMA_VERSION,
  assertGroupIdV3,
  assertStateV2,
  assertTaskV2,
  isStructuredTaskSchema,
} from './validation.js'

const STALE_LOCK_MILLISECONDS = 60_000

export function assertTaskIdToken(id: string) {
  if (!id.trim() || id.includes('/') || id.includes('\\') || id.includes('..'))
    throw new Error(`Invalid task id: ${id}`)
}

export function taskDirectoryV2(store: TaskStoreV2, id: string) {
  assertTaskIdToken(id)
  return join(store.paths.tasksDir, id)
}

export function taskJsonPathV2(store: TaskStoreV2, id: string) {
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
export function withV2Lock<T>(path: string, fn: () => T): T {
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

export function writeStateV2(store: TaskStoreV2, value: LatchStateV2) {
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

function resolveOpenTaskPrefixIfExistsV2(store: TaskStoreV2, id: string) {
  const matches = openTaskIdsV2(store).filter((taskId) => taskId.startsWith(id))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1)
    throw new Error(`Task id is ambiguous: ${id}. Matches: ${matches.join(', ')}`)
  return undefined
}

export function resolveOpenTaskIdV2(store: TaskStoreV2, id: string) {
  assertTaskIdToken(id)
  if (existsSync(taskJsonPathV2(store, id))) return id
  const canonicalId = resolveOpenTaskPrefixIfExistsV2(store, id)
  if (canonicalId !== undefined) return canonicalId
  throw new Error(`Task not found: ${id}`)
}

export function readTaskFromDirectory(
  store: TaskStoreV2,
  canonicalId: string,
  directory: string,
) {
  const path = join(directory, 'task.json')
  const value = readJsonFile<unknown>(path)
  assertTaskV2(value, path)
  if (value.id !== canonicalId)
    throw new Error(`Task id does not match its directory in ${path}.`)
  if (value.workspace_root !== store.paths.workspaceRoot)
    throw new Error(`Task workspace_root does not match ${store.paths.workspaceRoot}: ${path}.`)
  value.provenance ??= 'clean'
  return value
}

export function readCanonicalTaskV2(store: TaskStoreV2, canonicalId: string): TaskV2 {
  return readTaskFromDirectory(
    store,
    canonicalId,
    taskDirectoryV2(store, canonicalId),
  )
}

export function archivedTaskDirectoryV2(store: TaskStoreV2, id: string) {
  if (!existsSync(store.paths.archiveDir)) return undefined
  for (const month of readDirSync(store.paths.archiveDir, { withFileTypes: true })) {
    if (!month.isDirectory() || !/^\d{4}-\d{2}$/.test(month.name)) continue
    const directory = join(store.paths.archiveDir, month.name, id)
    if (existsSync(join(directory, 'task.json'))) return directory
  }
  return undefined
}

export function readTaskV2(store: TaskStoreV2, id: string): TaskV2 {
  return readCanonicalTaskV2(store, resolveOpenTaskIdV2(store, id))
}

export function readArchivedTaskV2(
  store: TaskStoreV2,
  id: string,
): TaskV2 | undefined {
  assertTaskIdToken(id)
  const directory = archivedTaskDirectoryV2(store, id)
  return directory ? readTaskFromDirectory(store, id, directory) : undefined
}

export function readTaskEventLogFromDirectory(task: TaskV2, directory: string) {
  if (task.schema_version === V5_SCHEMA_VERSION)
    return readTaskEventLogV5(directory)
  if (isStructuredTaskSchema(task.schema_version)) return readTaskEventLogV3(directory)
  return { events: readTaskEventsV2(directory), warnings: [] }
}

function readContextTaskFromDirectory(
  store: TaskStoreV2,
  id: string,
  directory: string,
  archived: boolean,
): ContextTaskReadV2 {
  const task = readTaskFromDirectory(store, id, directory)
  if (archived && task.outcome === undefined)
    throw new Error(`Archived task is missing outcome: ${id}`)
  return {
    task,
    archived,
    eventLog: readTaskEventLogFromDirectory(task, directory),
  }
}

export function readOpenContextTaskV2(
  store: TaskStoreV2,
  id: string,
): ContextTaskReadV2 {
  const canonicalId = resolveOpenTaskIdV2(store, id)
  return readContextTaskFromDirectory(
    store,
    canonicalId,
    taskDirectoryV2(store, canonicalId),
    false,
  )
}

export function readContextTaskV2(
  store: TaskStoreV2,
  id: string,
): ContextTaskReadV2 {
  assertTaskIdToken(id)
  if (existsSync(taskJsonPathV2(store, id)))
    return readContextTaskFromDirectory(
      store,
      id,
      taskDirectoryV2(store, id),
      false,
    )

  const directory = archivedTaskDirectoryV2(store, id)
  if (directory) return readContextTaskFromDirectory(store, id, directory, true)

  const openId = resolveOpenTaskPrefixIfExistsV2(store, id)
  if (openId !== undefined)
    return readContextTaskFromDirectory(
      store,
      openId,
      taskDirectoryV2(store, openId),
      false,
    )
  throw new Error(`Task not found: ${id}`)
}

export function readTaskEventLogForTask(store: TaskStoreV2, task: TaskV2) {
  const directory = taskDirectoryV2(store, task.id)
  return readTaskEventLogFromDirectory(task, directory)
}

export function taskEventLogV2(store: TaskStoreV2, id: string) {
  const task = readTaskV2(store, id)
  return readTaskEventLogForTask(store, task)
}

export function taskHistoryIncompleteV2(
  store: TaskStoreV2,
  id: string,
  events = taskEventLogV2(store, id).events,
) {
  const task = readTaskV2(store, id)
  return taskHistoryIncompleteForTaskV2(task, events)
}

export function taskHistoryIncompleteForTaskV2(
  task: TaskV2,
  events: TaskEvent[],
) {
  const revisions = new Set(events.map((entry) => entry.revision))
  for (let revision = 1; revision <= task.revision; revision += 1)
    if (!revisions.has(revision)) return true
  return false
}

export function taskEventsV2(store: TaskStoreV2, id: string) {
  return taskEventLogV2(store, id).events
}

export function listTasksV2(store: TaskStoreV2): TaskV2[] {
  return openTaskIdsV2(store)
    .map((id) => readCanonicalTaskV2(store, id))
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
}

export function archivedTaskIdsV2(store: TaskStoreV2) {
  if (!existsSync(store.paths.archiveDir)) return []
  const ids = new Set<string>()
  for (const month of readDirSync(store.paths.archiveDir, { withFileTypes: true })) {
    if (!month.isDirectory() || !/^\d{4}-\d{2}$/.test(month.name)) continue
    const monthPath = join(store.paths.archiveDir, month.name)
    for (const entry of readDirSync(monthPath, { withFileTypes: true }))
      if (
        entry.isDirectory() &&
        existsSync(join(monthPath, entry.name, 'task.json'))
      )
        ids.add(entry.name)
  }
  return [...ids].sort()
}

export function listArchivedTasksV2(store: TaskStoreV2): TaskV2[] {
  return archivedTaskIdsV2(store)
    .map((id) => readArchivedTaskV2(store, id))
    .filter((task): task is TaskV2 => task !== undefined)
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
}

export function listGroupTasksV3(
  store: TaskStoreV2,
  groupId: string,
  includeArchive = false,
) {
  assertGroupIdV3(groupId, 'group query')
  return {
    open: listTasksV2(store).filter((task) => task.group_id === groupId),
    archived: includeArchive
      ? listArchivedTasksV2(store).filter((task) => task.group_id === groupId)
      : [],
  }
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
