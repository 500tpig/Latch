import {
  existsSync,
  mkdirSync,
  readdirSync as readDirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { archiveDir, lockDir, statePath, tasksDir } from './paths.js'
import { die, now, readJson, slug, writeJson } from './utils.js'
import { actorId } from './ownership.js'
import type { Artifact, State, Task } from './types.js'

export function ensureInit() {
  mkdirSync(tasksDir, { recursive: true })
  mkdirSync(archiveDir, { recursive: true })
  if (!existsSync(statePath)) writeJson(statePath, {})
}

export function withLock<T>(fn: () => T): T {
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

export function runLocked<T>(fn: () => T): T {
  try {
    return withLock(fn)
  } catch (error) {
    die(error instanceof Error ? error.message : String(error))
  }
}

export function state(): State {
  ensureInit()
  return readJson<State>(statePath, {})
}

export function taskPath(id: string) {
  return join(tasksDir, id)
}

function hasActorState(current: State) {
  return Boolean(current.actors && Object.keys(current.actors).length > 0)
}

export function currentTaskId() {
  const current = state()
  const actorCurrent = current.actors?.[actorId()]?.current_task_id
  if (actorCurrent) return actorCurrent
  if (hasActorState(current)) return undefined
  return current.current_task_id ?? current.active_task_id
}

export function writeCurrentTaskId(id?: string) {
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

export function clearTaskFromState(id: string) {
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

function resolveOpenTaskId(id: string) {
  const exactPath = join(taskPath(id), 'task.json')
  if (existsSync(exactPath)) return id
  const matches = openTaskIds().filter((taskId) => taskId.startsWith(id))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1)
    throw new Error(`Task id is ambiguous: ${id}. Matches: ${matches.join(', ')}`)
  throw new Error(`Task not found: ${id}`)
}

export function readTask(id: string): Task {
  const path = join(taskPath(resolveOpenTaskId(id)), 'task.json')
  return readJson<Task>(path, undefined as never)
}

export function currentTask(): Task {
  const current = currentTaskId()
  if (!current) throw new Error('No current task.')
  return readTask(current)
}

export function saveTask(task: Task) {
  task.updated_at = now()
  writeJson(join(taskPath(task.id), 'task.json'), task)
}

export function createTask(title: string): Task {
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

export function archiveTask(task: Task) {
  const month = new Date().toISOString().slice(0, 7)
  const targetDir = join(archiveDir, month)
  mkdirSync(targetDir, { recursive: true })
  renameSync(taskPath(task.id), join(targetDir, basename(task.id)))
  clearTaskFromState(task.id)
}

export function openTaskIds() {
  ensureInit()
  return readDirSync(tasksDir).filter((id) =>
    existsSync(join(taskPath(id), 'task.json')),
  )
}

// task 指向 .latch/ 外部产物里 kind="knowledge_card" 的那一项；ensureDoneReady 用它代替旧的 knowledge_card_path
export function knowledgeCardArtifact(task: Task): Artifact | undefined {
  return task.artifacts?.find((a) => a.kind === 'knowledge_card')
}
