import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import {
  listArchivedTasksV2,
  listTasksV2,
  openTaskStoreV2,
  withV2Lock,
  type TaskStoreV2,
} from './task-store.js'
import { now, readJsonFile, writeJsonAtomic, writeTextAtomic } from './utils.js'

export const RECORD_STORE_SCHEMA_VERSION = 1 as const
export const RECORD_BODY_MAX_BYTES = 16 * 1024
export const RECORD_TITLE_MAX_CHARS = 160
export const RECORD_TAG_MAX_COUNT = 10
export const RECORD_TAG_MAX_CHARS = 48
export const RECORD_LIST_MAX_LIMIT = 5

const RECORD_ID =
  /^rec_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const BODY_HASH = /^[a-f0-9]{64}$/

export type ProjectRecordStatusV1 = 'active' | 'archived'

export type ProjectRecordRelationsV1 = {
  task_ids: string[]
  group_ids: string[]
}

export type ProjectRecordEntryV1 = {
  id: string
  revision: number
  title: string
  body_ref: string
  body_sha256: string
  tags: string[]
  status: ProjectRecordStatusV1
  relations: ProjectRecordRelationsV1
  created_at: string
  updated_at: string
  archived_at?: string
}

export type ProjectRecordBriefV1 = Pick<
  ProjectRecordEntryV1,
  'id' | 'revision' | 'title' | 'tags' | 'status' | 'updated_at'
>

export type ProjectRecordWithBodyV1 = {
  record: ProjectRecordEntryV1
  body: string
}

type ProjectRecordIndexV1 = {
  schema_version: typeof RECORD_STORE_SCHEMA_VERSION
  records: ProjectRecordEntryV1[]
}

export type RecordStoreV1 = {
  taskStore: TaskStoreV2
}

export type CreateProjectRecordInputV1 = {
  title: string
  body: string
  tags?: string[]
  taskIds?: string[]
  groupIds?: string[]
}

export type EditProjectRecordInputV1 = {
  expectRevision: number
  title?: string
  body?: string
  tags?: string[]
  taskIds?: string[]
  groupIds?: string[]
}

export type ListProjectRecordsInputV1 = {
  status?: ProjectRecordStatusV1 | 'all'
  query?: string
  tags?: string[]
  taskId?: string
  groupId?: string
  limit?: number
}

export type ProjectRecordMutationResultV1<T> = {
  value: T
  warnings: string[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  path: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Invalid ${field} in ${path}.`)
}

function requirePositiveInteger(
  value: unknown,
  field: string,
  path: string,
): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1)
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

function assertRecordId(id: string) {
  if (!RECORD_ID.test(id)) throw new Error(`Invalid Record ID: ${id}`)
}

function charCount(value: string) {
  return [...value].length
}

function normalizedTitle(value: string) {
  const title = value.trim()
  if (!title) throw new Error('Record title must be non-empty.')
  if (charCount(title) > RECORD_TITLE_MAX_CHARS)
    throw new Error(`Record title exceeds ${RECORD_TITLE_MAX_CHARS} characters.`)
  return title
}

function normalizedBody(value: string) {
  if (!value.trim()) throw new Error('Record body must be non-empty.')
  if (Buffer.byteLength(value, 'utf8') > RECORD_BODY_MAX_BYTES)
    throw new Error(`Record body exceeds ${RECORD_BODY_MAX_BYTES} UTF-8 bytes.`)
  return value
}

function normalizedTags(values: string[] = []) {
  if (values.length > RECORD_TAG_MAX_COUNT)
    throw new Error(`Record tags exceed the maximum count of ${RECORD_TAG_MAX_COUNT}.`)
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const tag = raw.trim()
    if (!tag) throw new Error('Record tags must be non-empty.')
    if (charCount(tag) > RECORD_TAG_MAX_CHARS)
      throw new Error(`Record tag exceeds ${RECORD_TAG_MAX_CHARS} characters: ${tag}`)
    const key = tag.toLocaleLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(tag)
    }
  }
  return result
}

function normalizedRelationIds(values: string[] = [], field: string) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    if (!value) throw new Error(`${field} entries must be non-empty.`)
    if (!seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

function bodyHash(body: string) {
  return createHash('sha256').update(body).digest('hex')
}

function expectedBodyRef(id: string, revision: number) {
  return `bodies/${id}/${revision}.md`
}

function assertEntry(value: unknown, path: string): asserts value is ProjectRecordEntryV1 {
  if (!isObject(value)) throw new Error(`Invalid Record entry in ${path}.`)
  requireNonEmptyString(value.id, 'record.id', path)
  assertRecordId(value.id)
  requirePositiveInteger(value.revision, 'record.revision', path)
  requireNonEmptyString(value.title, 'record.title', path)
  normalizedTitle(value.title)
  requireNonEmptyString(value.body_ref, 'record.body_ref', path)
  if (
    isAbsolute(value.body_ref) ||
    normalize(value.body_ref) !== value.body_ref ||
    !value.body_ref.startsWith(`bodies/${value.id}/`) ||
    !/^bodies\/rec_[^/]+\/[1-9]\d*\.md$/.test(value.body_ref)
  )
    throw new Error(`Invalid record.body_ref in ${path}.`)
  const bodyRevision = Number(value.body_ref.slice(value.body_ref.lastIndexOf('/') + 1, -3))
  if (!Number.isInteger(bodyRevision) || bodyRevision > value.revision)
    throw new Error(`Invalid record.body_ref revision in ${path}.`)
  requireNonEmptyString(value.body_sha256, 'record.body_sha256', path)
  if (!BODY_HASH.test(value.body_sha256))
    throw new Error(`Invalid record.body_sha256 in ${path}.`)
  requireStringArray(value.tags, 'record.tags', path)
  if (normalizedTags(value.tags).length !== value.tags.length)
    throw new Error(`Duplicate record.tags in ${path}.`)
  if (value.status !== 'active' && value.status !== 'archived')
    throw new Error(`Invalid record.status in ${path}.`)
  if (!isObject(value.relations))
    throw new Error(`Invalid record.relations in ${path}.`)
  requireStringArray(value.relations.task_ids, 'record.relations.task_ids', path)
  requireStringArray(value.relations.group_ids, 'record.relations.group_ids', path)
  if (
    normalizedRelationIds(
      value.relations.task_ids,
      'record.relations.task_ids',
    ).length !== value.relations.task_ids.length
  )
    throw new Error(`Duplicate record.relations.task_ids in ${path}.`)
  if (
    normalizedRelationIds(
      value.relations.group_ids,
      'record.relations.group_ids',
    ).length !== value.relations.group_ids.length
  )
    throw new Error(`Duplicate record.relations.group_ids in ${path}.`)
  requireNonEmptyString(value.created_at, 'record.created_at', path)
  requireNonEmptyString(value.updated_at, 'record.updated_at', path)
  if (value.status === 'archived')
    requireNonEmptyString(value.archived_at, 'record.archived_at', path)
  else if (Object.hasOwn(value, 'archived_at'))
    throw new Error(`Active Record cannot have archived_at in ${path}.`)
}

function assertIndex(value: unknown, path: string): asserts value is ProjectRecordIndexV1 {
  if (!isObject(value) || value.schema_version !== RECORD_STORE_SCHEMA_VERSION)
    throw new Error(`Unsupported or invalid Record store schema in ${path}.`)
  if (!Array.isArray(value.records))
    throw new Error(`Invalid Record index records in ${path}.`)
  const ids = new Set<string>()
  for (const entry of value.records) {
    assertEntry(entry, path)
    if (ids.has(entry.id)) throw new Error(`Duplicate Record ID in ${path}: ${entry.id}`)
    ids.add(entry.id)
  }
}

function assertNotSymlink(path: string, label: string) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink())
    throw new Error(`${label} must not be a symbolic link: ${path}`)
}

function assertStorePaths(store: RecordStoreV1) {
  const { recordsDir, recordBodiesDir, recordIndexPath } = store.taskStore.paths
  assertNotSymlink(recordsDir, 'Record directory')
  assertNotSymlink(recordBodiesDir, 'Record bodies directory')
  assertNotSymlink(recordIndexPath, 'Record index')
}

function emptyIndex(): ProjectRecordIndexV1 {
  return { schema_version: RECORD_STORE_SCHEMA_VERSION, records: [] }
}

function readIndex(store: RecordStoreV1) {
  assertStorePaths(store)
  const { recordsDir, recordIndexPath } = store.taskStore.paths
  if (!existsSync(recordsDir)) return emptyIndex()
  if (!existsSync(recordIndexPath))
    throw new Error(`Record index is missing: ${recordIndexPath}`)
  const value = readJsonFile<unknown>(recordIndexPath)
  assertIndex(value, recordIndexPath)
  return value
}

function writeIndex(store: RecordStoreV1, index: ProjectRecordIndexV1) {
  assertIndex(index, store.taskStore.paths.recordIndexPath)
  writeJsonAtomic(store.taskStore.paths.recordIndexPath, index)
}

function ensureStoreForWrite(store: RecordStoreV1) {
  assertStorePaths(store)
  const { recordsDir, recordBodiesDir, recordIndexPath } = store.taskStore.paths
  if (!existsSync(recordsDir)) {
    mkdirSync(recordBodiesDir, { recursive: true })
    writeJsonAtomic(recordIndexPath, emptyIndex())
    return
  }
  if (!existsSync(recordIndexPath))
    throw new Error(`Record index is missing: ${recordIndexPath}`)
  if (!existsSync(recordBodiesDir)) mkdirSync(recordBodiesDir)
}

function cloneEntry(entry: ProjectRecordEntryV1) {
  return structuredClone(entry)
}

function findEntry(index: ProjectRecordIndexV1, id: string) {
  assertRecordId(id)
  const entry = index.records.find((record) => record.id === id)
  if (!entry) throw new Error(`Record not found: ${id}`)
  return entry
}

function assertExpectedRevision(entry: ProjectRecordEntryV1, expected: number) {
  if (!Number.isInteger(expected) || expected < 1)
    throw new Error('--expect-revision must be a positive integer.')
  if (entry.revision !== expected)
    throw new Error(
      `Record revision conflict for ${entry.id}: expected ${expected}, current ${entry.revision}.`,
    )
}

function allProjectTasks(store: RecordStoreV1) {
  return [
    ...listTasksV2(store.taskStore),
    ...listArchivedTasksV2(store.taskStore),
  ]
}

function validateRelations(
  store: RecordStoreV1,
  taskIds: string[],
  groupIds: string[],
) {
  if (taskIds.length === 0 && groupIds.length === 0) return
  const tasks = allProjectTasks(store)
  const knownTaskIds = new Set(tasks.map((task) => task.id))
  for (const id of taskIds)
    if (!knownTaskIds.has(id))
      throw new Error(`Related task does not exist in the current project: ${id}`)
  const knownGroupIds = new Set(
    tasks.map((task) => task.group_id).filter((id): id is string => Boolean(id)),
  )
  for (const id of groupIds)
    if (!knownGroupIds.has(id))
      throw new Error(`Related group does not exist in the current project: ${id}`)
}

function resolvedBodyPath(store: RecordStoreV1, entry: ProjectRecordEntryV1) {
  const recordsRoot = resolve(store.taskStore.paths.recordsDir)
  const bodyPath = resolve(recordsRoot, entry.body_ref)
  const relativePath = relative(recordsRoot, bodyPath)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  )
    throw new Error(`Record body_ref escapes the current project: ${entry.body_ref}`)
  if (!existsSync(bodyPath)) throw new Error(`Record body is missing: ${bodyPath}`)
  assertNotSymlink(bodyPath, 'Record body')
  const canonicalRoot = realpathSync.native(recordsRoot)
  const canonicalBody = realpathSync.native(bodyPath)
  const canonicalRelative = relative(canonicalRoot, canonicalBody)
  if (
    canonicalRelative === '..' ||
    canonicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(canonicalRelative)
  )
    throw new Error(`Record body resolves outside the current project: ${entry.body_ref}`)
  return bodyPath
}

function readBody(store: RecordStoreV1, entry: ProjectRecordEntryV1) {
  const body = readFileSync(resolvedBodyPath(store, entry), 'utf8')
  if (Buffer.byteLength(body, 'utf8') > RECORD_BODY_MAX_BYTES)
    throw new Error(`Record body exceeds ${RECORD_BODY_MAX_BYTES} UTF-8 bytes: ${entry.id}`)
  if (bodyHash(body) !== entry.body_sha256)
    throw new Error(`Record body hash mismatch: ${entry.id}`)
  return body
}

function bodyPathForWrite(
  store: RecordStoreV1,
  id: string,
  revision: number,
) {
  return join(store.taskStore.paths.recordsDir, expectedBodyRef(id, revision))
}

function writeBodyRevision(
  store: RecordStoreV1,
  id: string,
  revision: number,
  body: string,
) {
  const directory = join(store.taskStore.paths.recordBodiesDir, id)
  assertNotSymlink(directory, 'Record body revision directory')
  mkdirSync(directory, { recursive: true })
  const path = bodyPathForWrite(store, id, revision)
  if (existsSync(path))
    throw new Error(`Record body revision already exists: ${path}`)
  writeTextAtomic(path, body)
  return path
}

function recordLock<T>(store: RecordStoreV1, fn: () => T) {
  return withV2Lock(store.taskStore.paths.recordLockPath, fn)
}

export function openRecordStoreV1(cwd: string): RecordStoreV1 {
  return { taskStore: openTaskStoreV2(cwd) }
}

export function listProjectRecordsV1(
  store: RecordStoreV1,
  input: ListProjectRecordsInputV1 = {},
): ProjectRecordBriefV1[] {
  const status = input.status ?? 'active'
  if (status !== 'active' && status !== 'archived' && status !== 'all')
    throw new Error('Record status must be active, archived, or all.')
  const limit = input.limit ?? RECORD_LIST_MAX_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > RECORD_LIST_MAX_LIMIT)
    throw new Error(`Record list limit must be between 1 and ${RECORD_LIST_MAX_LIMIT}.`)
  const query = input.query?.trim().toLocaleLowerCase()
  const tags = normalizedTags(input.tags).map((tag) => tag.toLocaleLowerCase())
  return readIndex(store).records
    .filter((entry) => status === 'all' || entry.status === status)
    .filter((entry) =>
      !query ||
      entry.title.toLocaleLowerCase().includes(query) ||
      entry.tags.some((tag) => tag.toLocaleLowerCase().includes(query)),
    )
    .filter((entry) => {
      const entryTags = new Set(entry.tags.map((tag) => tag.toLocaleLowerCase()))
      return tags.every((tag) => entryTags.has(tag))
    })
    .filter((entry) =>
      !input.taskId || entry.relations.task_ids.includes(input.taskId),
    )
    .filter((entry) =>
      !input.groupId || entry.relations.group_ids.includes(input.groupId),
    )
    .sort(
      (left, right) =>
        right.updated_at.localeCompare(left.updated_at) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, limit)
    .map(({ id, revision, title, tags: entryTags, status: entryStatus, updated_at }) => ({
      id,
      revision,
      title,
      tags: structuredClone(entryTags),
      status: entryStatus,
      updated_at,
    }))
}

export function showProjectRecordV1(
  store: RecordStoreV1,
  id: string,
): ProjectRecordWithBodyV1 {
  const entry = findEntry(readIndex(store), id)
  return { record: cloneEntry(entry), body: readBody(store, entry) }
}

export function createProjectRecordV1(
  store: RecordStoreV1,
  input: CreateProjectRecordInputV1,
): ProjectRecordMutationResultV1<ProjectRecordWithBodyV1> {
  const title = normalizedTitle(input.title)
  const body = normalizedBody(input.body)
  const tags = normalizedTags(input.tags)
  const taskIds = normalizedRelationIds(input.taskIds, 'task_ids')
  const groupIds = normalizedRelationIds(input.groupIds, 'group_ids')
  validateRelations(store, taskIds, groupIds)
  return recordLock(store, () => {
    ensureStoreForWrite(store)
    const index = readIndex(store)
    const id = `rec_${randomUUID()}`
    const timestamp = now()
    const entry: ProjectRecordEntryV1 = {
      id,
      revision: 1,
      title,
      body_ref: expectedBodyRef(id, 1),
      body_sha256: bodyHash(body),
      tags,
      status: 'active',
      relations: { task_ids: taskIds, group_ids: groupIds },
      created_at: timestamp,
      updated_at: timestamp,
    }
    const path = writeBodyRevision(store, id, 1, body)
    try {
      writeIndex(store, {
        ...index,
        records: [...index.records, entry],
      })
    } catch (error) {
      rmSync(join(store.taskStore.paths.recordBodiesDir, id), {
        recursive: true,
        force: true,
      })
      throw error
    }
    return {
      value: { record: cloneEntry(entry), body },
      warnings: existsSync(path) ? [] : [`Record body could not be verified after write: ${path}`],
    }
  })
}

export function editProjectRecordV1(
  store: RecordStoreV1,
  id: string,
  input: EditProjectRecordInputV1,
): ProjectRecordMutationResultV1<ProjectRecordWithBodyV1> {
  assertRecordId(id)
  if (
    input.title === undefined &&
    input.body === undefined &&
    input.tags === undefined &&
    input.taskIds === undefined &&
    input.groupIds === undefined
  )
    throw new Error('Record edit requires at least one change.')
  const title = input.title === undefined ? undefined : normalizedTitle(input.title)
  const body = input.body === undefined ? undefined : normalizedBody(input.body)
  const tags = input.tags === undefined ? undefined : normalizedTags(input.tags)
  const taskIds = input.taskIds === undefined
    ? undefined
    : normalizedRelationIds(input.taskIds, 'task_ids')
  const groupIds = input.groupIds === undefined
    ? undefined
    : normalizedRelationIds(input.groupIds, 'group_ids')
  if (taskIds !== undefined || groupIds !== undefined) {
    const current = findEntry(readIndex(store), id)
    validateRelations(
      store,
      taskIds ?? current.relations.task_ids,
      groupIds ?? current.relations.group_ids,
    )
  }
  return recordLock(store, () => {
    const index = readIndex(store)
    const current = findEntry(index, id)
    if (current.status !== 'active')
      throw new Error(`Archived Record must be restored before editing: ${id}`)
    assertExpectedRevision(current, input.expectRevision)
    const nextRevision = current.revision + 1
    const nextBody = body ?? readBody(store, current)
    const next: ProjectRecordEntryV1 = {
      ...current,
      revision: nextRevision,
      title: title ?? current.title,
      ...(body === undefined
        ? {}
        : {
            body_ref: expectedBodyRef(id, nextRevision),
            body_sha256: bodyHash(body),
          }),
      tags: tags ?? current.tags,
      relations: {
        task_ids: taskIds ?? current.relations.task_ids,
        group_ids: groupIds ?? current.relations.group_ids,
      },
      updated_at: now(),
    }
    let newBodyPath: string | undefined
    if (body !== undefined)
      newBodyPath = writeBodyRevision(store, id, nextRevision, body)
    try {
      writeIndex(store, {
        ...index,
        records: index.records.map((entry) => entry.id === id ? next : entry),
      })
    } catch (error) {
      if (newBodyPath) rmSync(newBodyPath, { force: true })
      throw error
    }
    const warnings: string[] = []
    if (body !== undefined) {
      try {
        rmSync(resolvedBodyPath(store, current), { force: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        warnings.push(`Record ${id} was updated, but the old body was not removed: ${message}`)
      }
    }
    return {
      value: { record: cloneEntry(next), body: nextBody },
      warnings,
    }
  })
}

function changeRecordStatusV1(
  store: RecordStoreV1,
  id: string,
  expectRevision: number,
  status: ProjectRecordStatusV1,
) {
  assertRecordId(id)
  return recordLock(store, () => {
    const index = readIndex(store)
    const current = findEntry(index, id)
    assertExpectedRevision(current, expectRevision)
    if (current.status === status)
      throw new Error(`Record ${id} is already ${status}.`)
    const timestamp = now()
    const next: ProjectRecordEntryV1 = {
      ...current,
      revision: current.revision + 1,
      status,
      updated_at: timestamp,
      ...(status === 'archived' ? { archived_at: timestamp } : {}),
    }
    if (status === 'active') delete next.archived_at
    writeIndex(store, {
      ...index,
      records: index.records.map((entry) => entry.id === id ? next : entry),
    })
    return { value: cloneEntry(next), warnings: [] }
  })
}

export function archiveProjectRecordV1(
  store: RecordStoreV1,
  id: string,
  expectRevision: number,
) {
  return changeRecordStatusV1(store, id, expectRevision, 'archived')
}

export function restoreProjectRecordV1(
  store: RecordStoreV1,
  id: string,
  expectRevision: number,
) {
  return changeRecordStatusV1(store, id, expectRevision, 'active')
}

export function deleteProjectRecordV1(
  store: RecordStoreV1,
  id: string,
  expectRevision: number,
  confirmLinked: boolean,
): ProjectRecordMutationResultV1<{ id: string; previous_revision: number }> {
  assertRecordId(id)
  return recordLock(store, () => {
    const index = readIndex(store)
    const current = findEntry(index, id)
    assertExpectedRevision(current, expectRevision)
    if (
      !confirmLinked &&
      (current.relations.task_ids.length > 0 || current.relations.group_ids.length > 0)
    )
      throw new Error(
        `Record ${id} has task or group relations; repeat with --confirm-linked after explicit confirmation.`,
      )
    writeIndex(store, {
      ...index,
      records: index.records.filter((entry) => entry.id !== id),
    })
    const warnings: string[] = []
    try {
      rmSync(join(store.taskStore.paths.recordBodiesDir, id), {
        recursive: true,
        force: true,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`Record ${id} was deleted from the index, but body cleanup failed: ${message}`)
    }
    return {
      value: { id, previous_revision: current.revision },
      warnings,
    }
  })
}

export function linkProjectRecordTaskV1(
  store: RecordStoreV1,
  id: string,
  expectRevision: number,
  taskId: string,
) {
  validateRelations(store, [taskId], [])
  return recordLock(store, () => {
    const index = readIndex(store)
    const current = findEntry(index, id)
    if (current.status !== 'active')
      throw new Error(`Archived Record must be restored before linking a task: ${id}`)
    assertExpectedRevision(current, expectRevision)
    if (current.relations.task_ids.includes(taskId))
      return { value: cloneEntry(current), warnings: [] }
    const next: ProjectRecordEntryV1 = {
      ...current,
      revision: current.revision + 1,
      relations: {
        ...current.relations,
        task_ids: [...current.relations.task_ids, taskId],
      },
      updated_at: now(),
    }
    writeIndex(store, {
      ...index,
      records: index.records.map((entry) => entry.id === id ? next : entry),
    })
    return { value: cloneEntry(next), warnings: [] }
  })
}
