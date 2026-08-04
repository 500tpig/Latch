import {
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, relative, sep } from 'node:path'
import { assertWritableActor, isWritableActor } from '../actor.js'
import { downgradeTaskEvents, downgradeTaskValue } from '../migration.js'
import {
  appendTaskEventV2,
  appendTaskEventV3,
  appendTaskEventV5,
  validateTaskEventV2,
  validateTaskEventV3,
  validateTaskEventV5,
} from '../notes-events.js'
import {
  assertAuthorizableTaskPlan,
  assertTaskPlan,
  assertWritableTaskPlan,
} from '../plan-schema.js'
import {
  SCHEMA_V4_MIN_WRITER_VERSION,
  SCHEMA_V5_MIN_WRITER_VERSION,
  TASK_EVENT_TYPES,
  TASK_EVENT_TYPES_V3,
} from '../types.js'
import type {
  LatchStateV2,
  TaskEvent,
  TaskEventType,
  TaskProvenance,
  TaskV2,
  WorkspaceEvidenceRef,
} from '../types.js'
import { now, slug, writeJsonAtomic, writeTextAtomic } from '../utils.js'
import { readWorkspaceEvidence } from '../workspace-evidence.js'
import {
  ArchiveTaskV2Options,
  ClaimTaskV3Options,
  CreateTaskV2Input,
  CreateTaskV3Input,
  CreateTaskV4Input,
  CreateTaskV5Input,
  DowngradeTaskV2Error,
  type DowngradeTaskV2Result,
  type TaskStoreV2,
  type TaskWriteResultV2,
  TakeoverTaskV3Options,
  UpdateTaskV2Options,
  UpdateTaskV3Options,
  UpgradeTaskV4Options,
} from './contracts.js'
import {
  archivedTaskIdsV2,
  archivedTaskDirectoryV2,
  assertTaskIdToken,
  openTaskIdsV2,
  readCanonicalTaskV2,
  readStateV2,
  readTaskEventLogForTask,
  readTaskEventLogFromDirectory,
  readTaskFromDirectory,
  resolveOpenTaskIdV2,
  taskDirectoryV2,
  taskJsonPathV2,
  withStateLockV2,
  withTaskLockV2,
  writeStateV2,
} from './io.js'
import {
  V2_SCHEMA_VERSION,
  V3_SCHEMA_VERSION,
  V4_SCHEMA_VERSION,
  V5_SCHEMA_VERSION,
  assertGroupIdV3,
  assertTaskV2,
  isRecord,
  isStructuredTaskSchema,
  materializeWorkBasisV3,
  requireString,
} from './validation.js'

const taskEventTypes = new Set<string>(TASK_EVENT_TYPES)
const taskEventTypesV3 = new Set<string>(TASK_EVENT_TYPES_V3)

type TaskEventInput = {
  type: TaskEventType
  fields?: Record<string, unknown>
}

function assertExpectedRevision(revision: number) {
  if (!Number.isInteger(revision) || revision < 1)
    throw new Error('expectRevision must be a positive integer.')
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

function validateTaskEventForTask(task: TaskV2, event: TaskEvent, path: string) {
  if (task.schema_version === V5_SCHEMA_VERSION)
    validateTaskEventV5(event, path)
  else if (isStructuredTaskSchema(task.schema_version))
    validateTaskEventV3(event, path)
  else validateTaskEventV2(event, path)
}

function appendTaskEventForTask(
  taskDirectory: string,
  task: TaskV2,
  event: TaskEvent,
) {
  if (task.schema_version === V5_SCHEMA_VERSION)
    appendTaskEventV5(taskDirectory, event)
  else if (isStructuredTaskSchema(task.schema_version))
    appendTaskEventV3(taskDirectory, event)
  else appendTaskEventV2(taskDirectory, event)
}

function eventWriteWarning(task: TaskV2, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return `Task ${task.id} revision ${task.revision} was committed, but its event was not recorded: ${message}`
}

function createTask(
  store: TaskStoreV2,
  input: CreateTaskV2Input | CreateTaskV3Input | CreateTaskV4Input | CreateTaskV5Input,
  actor: string,
  schemaVersion: 2 | 3 | 4 | 5,
): TaskWriteResultV2 {
  assertWritableActor(actor)
  requireString(input.title, 'title', 'checkpoint input')
  if (isStructuredTaskSchema(schemaVersion))
    assertWritableTaskPlan(input.plan, 'checkpoint input')
  else assertTaskPlan(input.plan, 'checkpoint input')
  const artifacts = structuredClone(input.artifacts ?? [])
  for (const artifact of artifacts) {
    requireString(artifact.kind, 'artifact.kind', 'checkpoint input')
    requireString(artifact.path, 'artifact.path', 'checkpoint input')
  }

  let id = makeTaskId(input.title)
  while (existsSync(taskDirectoryV2(store, id))) id = makeTaskId(input.title)
  const timestamp = now()
  const profile = isStructuredTaskSchema(schemaVersion)
    ? (input as CreateTaskV3Input).profile
    : undefined
  if (isStructuredTaskSchema(schemaVersion) && !profile)
    throw new Error('profile is required for structured task creation.')
  const workBasisInput = isStructuredTaskSchema(schemaVersion)
    ? (input as CreateTaskV3Input).workBasis
    : undefined
  const groupId = isStructuredTaskSchema(schemaVersion)
    ? (input as CreateTaskV3Input).groupId
    : undefined
  const sourceRecord = isStructuredTaskSchema(schemaVersion)
    ? (input as CreateTaskV3Input).sourceRecord
    : undefined
  if (groupId !== undefined) assertGroupIdV3(groupId, 'checkpoint input')
  if (workBasisInput) {
    if (
      schemaVersion === V4_SCHEMA_VERSION ||
      schemaVersion === V5_SCHEMA_VERSION
    )
      assertAuthorizableTaskPlan(input.plan, profile!, 'checkpoint input')
    else if (input.plan.open_questions.length > 0)
      throw new Error('Cannot create work_basis while plan.open_questions is not empty.')
  }
  const workRevision = workBasisInput ? 1 : 0
  const workBasis = workBasisInput
    ? materializeWorkBasisV3(workBasisInput, 1, workRevision)
    : undefined
  const task: TaskV2 = {
    schema_version: schemaVersion,
    ...(schemaVersion === V4_SCHEMA_VERSION
      ? { min_writer_version: SCHEMA_V4_MIN_WRITER_VERSION }
      : schemaVersion === V5_SCHEMA_VERSION
        ? { min_writer_version: SCHEMA_V5_MIN_WRITER_VERSION }
      : {}),
    id,
    title: input.title.trim(),
    phase: workBasis ? 'dev' : 'plan',
    ...(isStructuredTaskSchema(schemaVersion) ? { primary_writer: actor } : {}),
    ...(profile ? { profile } : {}),
    ...(isStructuredTaskSchema(schemaVersion)
      ? { provenance: 'clean' as TaskProvenance }
      : {}),
    ...(groupId !== undefined ? { group_id: groupId } : {}),
    ...(sourceRecord !== undefined
      ? { source_record: structuredClone(sourceRecord) }
      : {}),
    ...(workBasis ? { work_basis: workBasis } : {}),
    revision: 1,
    plan_revision: 1,
    work_revision: workRevision,
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
  const creationEvents = [makeTaskEvent(task, 'task_created', actor)]
  if (workBasis?.kind === 'implementation_authorization')
    creationEvents.push(makeTaskEvent(task, 'implementation_authorized', actor, {
      plan_revision: workBasis.plan_revision,
      source: workBasis.source,
      reason: workBasis.reason,
      scope: workBasis.scope,
    }))
  if (workBasis?.kind === 'retrospective_record')
    creationEvents.push(makeTaskEvent(task, 'retrospective_recorded', actor, {
      plan_revision: workBasis.plan_revision,
      work_revision: workBasis.work_revision,
      reason: workBasis.reason,
      implemented_before_task: workBasis.implemented_before_task,
      scope_summary: workBasis.scope_summary,
    }))
  if (workBasis)
    creationEvents.push(makeTaskEvent(task, 'work_started', actor, {
      work_revision: workBasis.kind === 'retrospective_record'
        ? workBasis.work_revision
        : task.work_revision,
    }))
  for (const event of creationEvents)
    validateTaskEventForTask(
      task,
      event,
      join(taskDirectory, 'events.jsonl'),
    )

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
      for (const event of creationEvents)
        appendTaskEventForTask(taskDirectory, task, event)
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

// createTaskV2/createTaskV3/createTaskV4 只保留给 legacy fixture；CLI checkpoint 使用 schema 5。
export function createTaskV2(
  store: TaskStoreV2,
  input: CreateTaskV2Input,
  actor: string,
): TaskWriteResultV2 {
  return createTask(store, input, actor, V2_SCHEMA_VERSION)
}

export function createTaskV3(
  store: TaskStoreV2,
  input: CreateTaskV3Input,
  actor: string,
): TaskWriteResultV2 {
  return createTask(store, input, actor, V3_SCHEMA_VERSION)
}

export function createTaskV4(
  store: TaskStoreV2,
  input: CreateTaskV4Input,
  actor: string,
): TaskWriteResultV2 {
  return createTask(store, input, actor, V4_SCHEMA_VERSION)
}

export function createTaskV5(
  store: TaskStoreV2,
  input: CreateTaskV5Input,
  actor: string,
): TaskWriteResultV2 {
  return createTask(store, input, actor, V5_SCHEMA_VERSION)
}

export function currentTaskIdV2(store: TaskStoreV2, actor: string) {
  if (!isWritableActor(actor)) return undefined
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
  assertWritableActor(actor)
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

function lastTaskActor(task: TaskV2, events: TaskEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.revision === task.revision) return event.actor
  }
  return 'unknown'
}

function assertImmutableTaskFields(
  current: TaskV2,
  next: TaskV2,
  allowPrimaryWriterChange = false,
  allowSchemaUpgrade = false,
) {
  const primaryWriterChanged =
    current.primary_writer !== next.primary_writer ||
    Object.hasOwn(current, 'primary_writer') !==
      Object.hasOwn(next, 'primary_writer')
  const sourceRecordChanged =
    Object.hasOwn(current, 'source_record') !==
      Object.hasOwn(next, 'source_record') ||
    current.source_record?.record_id !== next.source_record?.record_id ||
    current.source_record?.revision !== next.source_record?.revision ||
    current.source_record?.body_sha256 !== next.source_record?.body_sha256
  const changed = [
    next.schema_version !== current.schema_version &&
      !(
        allowSchemaUpgrade &&
        (current.schema_version === V2_SCHEMA_VERSION ||
          current.schema_version === V3_SCHEMA_VERSION) &&
        next.schema_version === V4_SCHEMA_VERSION
      ) &&
      'schema_version',
    next.min_writer_version !== current.min_writer_version &&
      !allowSchemaUpgrade &&
      'min_writer_version',
    next.id !== current.id && 'id',
    next.revision !== current.revision && 'revision',
    !allowPrimaryWriterChange && primaryWriterChanged && 'primary_writer',
    sourceRecordChanged && 'source_record',
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
  const events = readTaskEventLogForTask(store, task).events
  throw new Error(
    `Task changed: expected revision ${expectedRevision}, current revision ${task.revision}.\n` +
      `Changed by: ${lastTaskActor(task, events)}.\n` +
      `Run latch context ${task.id} --json --brief and retry.`,
  )
}

function assertPrimaryWriter(task: TaskV2, actor: string) {
  if (
    task.schema_version === V2_SCHEMA_VERSION ||
    !Object.hasOwn(task, 'primary_writer')
  )
    throw new Error(
      'Task is legacy_unclaimed: write denied.\n' +
        'Claim this task after an explicit user continue/handle request for this task id.',
    )
  if (task.primary_writer !== actor)
    throw new Error(
      `Writer mismatch: primary_writer is ${task.primary_writer}, caller is ${actor}.\n` +
        'Continue read-only, or takeover with explicit user handoff / confirmed transfer.',
    )
}

function assertCurrentWriterSchema(task: TaskV2) {
  if (task.schema_version === V3_SCHEMA_VERSION)
    throw new Error(
      `Schema 3 task is read-only: run latch upgrade-v4 --task ${task.id} ` +
        `--expect-revision ${task.revision} before writing.`,
    )
  if (
    task.schema_version !== V4_SCHEMA_VERSION &&
    task.schema_version !== V5_SCHEMA_VERSION
  )
    throw new Error(
      'Task is legacy_unclaimed: write denied.\n' +
        'Claim this task after an explicit user continue/handle request for this task id.',
    )
}

export function assertTaskWritableV2(
  store: TaskStoreV2,
  id: string,
  actor: string,
  expectRevision: number,
) {
  assertExpectedRevision(expectRevision)
  assertWritableActor(actor)
  const canonicalId = resolveOpenTaskIdV2(store, id)
  return withTaskLockV2(store, canonicalId, () => {
    const task = readCanonicalTaskV2(store, canonicalId)
    assertRevisionMatches(store, task, expectRevision)
    assertCurrentWriterSchema(task)
    assertPrimaryWriter(task, actor)
    return task
  })
}

type CommitTaskUpdateOptions = {
  expectRevision: number
  actor: string
  events: (current: TaskV2) => TaskEventInput[]
  authorize: (current: TaskV2) => void
  update: (task: TaskV2) => void
  allowPrimaryWriterChange?: boolean
  allowSchemaUpgrade?: boolean
}

// task.json 是提交点；event 失败不会把已提交更新伪装成完全失败。
function commitTaskUpdate(
  store: TaskStoreV2,
  id: string,
  options: CommitTaskUpdateOptions,
): TaskWriteResultV2 {
  assertExpectedRevision(options.expectRevision)
  assertWritableActor(options.actor)
  const canonicalId = resolveOpenTaskIdV2(store, id)

  return withTaskLockV2(store, canonicalId, () => {
    const current = readCanonicalTaskV2(store, canonicalId)
    assertRevisionMatches(store, current, options.expectRevision)
    options.authorize(current)
    const eventInputs = options.events(current)
    if (eventInputs.length === 0)
      throw new Error('Task update requires at least one event.')
    const next = structuredClone(current)
    options.update(next)
    assertImmutableTaskFields(
      current,
      next,
      options.allowPrimaryWriterChange,
      options.allowSchemaUpgrade,
    )
    next.revision = current.revision + 1
    next.updated_at = now()
    const path = taskJsonPathV2(store, canonicalId)
    assertTaskV2(next, path)
    const events = eventInputs.map((event) =>
      makeTaskEvent(next, event.type, options.actor, event.fields),
    )
    for (const event of events)
      validateTaskEventForTask(
        next,
        event,
        join(taskDirectoryV2(store, canonicalId), 'events.jsonl'),
      )
    writeJsonAtomic(path, next)
    const warnings: string[] = []
    for (const event of events) {
      try {
        appendTaskEventForTask(
          taskDirectoryV2(store, canonicalId),
          next,
          event,
        )
      } catch (error) {
        warnings.push(eventWriteWarning(next, error))
      }
    }
    return { task: next, warnings }
  })
}

export function updateTaskV2(
  store: TaskStoreV2,
  id: string,
  options: UpdateTaskV2Options,
): TaskWriteResultV2 {
  for (const event of options.events)
    if (!taskEventTypes.has(event.type))
      throw new Error(`Unknown task event type: ${event.type}`)
  return commitTaskUpdate(store, id, {
    ...options,
    events: () => options.events,
    authorize(task) {
      assertCurrentWriterSchema(task)
      assertPrimaryWriter(task, options.actor)
    },
  })
}

export function updateTaskV3(
  store: TaskStoreV2,
  id: string,
  options: UpdateTaskV3Options,
): TaskWriteResultV2 {
  return updateTaskV4(store, id, options)
}

export function updateTaskV4(
  store: TaskStoreV2,
  id: string,
  options: UpdateTaskV3Options,
): TaskWriteResultV2 {
  for (const event of options.events)
    if (!taskEventTypesV3.has(event.type))
      throw new Error(`Unknown structured task event type: ${event.type}`)
  return commitTaskUpdate(store, id, {
    ...options,
    events: () => options.events,
    authorize(task) {
      assertCurrentWriterSchema(task)
      assertPrimaryWriter(task, options.actor)
    },
  })
}

export function claimTaskV3(
  store: TaskStoreV2,
  id: string,
  options: ClaimTaskV3Options,
): TaskWriteResultV2 {
  if (options.reason !== undefined)
    requireString(options.reason, 'reason', 'claim input')
  return commitTaskUpdate(store, id, {
    expectRevision: options.expectRevision,
    actor: options.actor,
    events: () => [
      {
        type: 'writer_claimed',
        fields: options.reason ? { reason: options.reason.trim() } : undefined,
      },
    ],
    authorize(task) {
      if (task.schema_version !== V2_SCHEMA_VERSION)
        throw new Error(
          task.schema_version === V3_SCHEMA_VERSION
            ? `Schema 3 task already has a writer and requires upgrade-v4, not claim.`
            : `Task already has primary_writer: ${task.primary_writer}. Use takeover, not claim.`,
        )
    },
    update(task) {
      task.schema_version = V4_SCHEMA_VERSION
      task.min_writer_version = SCHEMA_V4_MIN_WRITER_VERSION
      task.profile = 'standard'
      task.provenance ??= 'clean'
      task.primary_writer = options.actor
    },
    allowPrimaryWriterChange: true,
    allowSchemaUpgrade: true,
  })
}

function collectWorkspaceEvidenceRefs(
  value: unknown,
  references = new Map<string, WorkspaceEvidenceRef>(),
) {
  if (Array.isArray(value)) {
    for (const entry of value) collectWorkspaceEvidenceRefs(entry, references)
    return references
  }
  if (!isRecord(value)) return references
  if (
    typeof value.path === 'string' &&
    typeof value.sha256 === 'string' &&
    Number.isInteger(value.entry_count)
  ) {
    const reference = value as WorkspaceEvidenceRef
    references.set(
      `${reference.path}\u0000${reference.sha256}\u0000${reference.entry_count}`,
      reference,
    )
  }
  for (const entry of Object.values(value))
    collectWorkspaceEvidenceRefs(entry, references)
  return references
}

export function upgradeTaskV4(
  store: TaskStoreV2,
  id: string,
  options: UpgradeTaskV4Options,
): TaskWriteResultV2 {
  const recoverWriter = options.recoverWriter === true
  const recoveryReason = options.reason?.trim()
  if (recoverWriter)
    requireString(recoveryReason, 'reason', 'upgrade-v4 recovery input')
  else if (options.reason !== undefined)
    throw new Error('upgrade-v4 reason requires recoverWriter.')

  const result = commitTaskUpdate(store, id, {
    expectRevision: options.expectRevision,
    actor: options.actor,
    events: (task) => [
      ...(recoverWriter
        ? [{
            type: 'writer_taken_over' as const,
            fields: {
              from: task.primary_writer,
              to: options.actor,
              reason: recoveryReason,
            },
          }]
        : []),
      {
        type: 'schema_upgraded',
        fields: {
          from_schema_version: V3_SCHEMA_VERSION,
          to_schema_version: V4_SCHEMA_VERSION,
          min_writer_version: SCHEMA_V4_MIN_WRITER_VERSION,
        },
      },
    ],
    authorize(task) {
      if (task.schema_version !== V3_SCHEMA_VERSION)
        throw new Error('upgrade-v4 requires an open schema_version 3 task.')
      if (recoverWriter) {
        if (task.primary_writer === options.actor)
          throw new Error(
            `Task primary_writer is already ${options.actor}; ` +
              'run upgrade-v4 without --recover-writer.',
          )
      } else {
        if (task.primary_writer !== options.actor)
          throw new Error(
            `Writer mismatch: primary_writer is ${task.primary_writer}, caller is ${options.actor}.\n` +
              'Ask the current writer to run upgrade-v4, or after explicit recovery authorization ' +
              'retry with --recover-writer --reason <text>.',
          )
      }
      const directory = taskDirectoryV2(store, task.id)
      const eventLog = readTaskEventLogForTask(store, task)
      const references = collectWorkspaceEvidenceRefs([task, eventLog.events])
      for (const reference of references.values())
        readWorkspaceEvidence(directory, reference)
    },
    update(task) {
      task.schema_version = V4_SCHEMA_VERSION
      task.min_writer_version = SCHEMA_V4_MIN_WRITER_VERSION
      if (recoverWriter) task.primary_writer = options.actor
    },
    allowPrimaryWriterChange: recoverWriter,
    allowSchemaUpgrade: true,
  })
  if (recoverWriter)
    result.warnings.push(
      'The previous writer may still modify the shared Git worktree; Latch only rejects its task writes.',
    )
  return result
}

export function takeoverTaskV3(
  store: TaskStoreV2,
  id: string,
  options: TakeoverTaskV3Options,
): TaskWriteResultV2 {
  requireString(options.reason, 'reason', 'takeover input')
  const result = commitTaskUpdate(store, id, {
    expectRevision: options.expectRevision,
    actor: options.actor,
    events: (task) => [
      {
        type: 'writer_taken_over',
        fields: {
          from: task.primary_writer,
          to: options.actor,
          reason: options.reason.trim(),
        },
      },
    ],
    authorize(task) {
      assertCurrentWriterSchema(task)
      if (!Object.hasOwn(task, 'primary_writer'))
        throw new Error('Task is legacy_unclaimed. Use claim, not takeover.')
      if (task.primary_writer === options.actor)
        throw new Error(`Task primary_writer is already ${options.actor}.`)
    },
    update(task) {
      task.primary_writer = options.actor
    },
    allowPrimaryWriterChange: true,
  })
  result.warnings.push(
    'The previous writer may still modify the shared Git worktree; Latch only rejects its task writes.',
  )
  return result
}

function resolveTaskIdForDowngrade(store: TaskStoreV2, id: string) {
  assertTaskIdToken(id)
  const ids = [...new Set([
    ...openTaskIdsV2(store),
    ...archivedTaskIdsV2(store),
  ])]
  if (ids.includes(id)) return id
  const matches = ids.filter((taskId) => taskId.startsWith(id))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1)
    throw new Error(`Task id is ambiguous: ${id}. Matches: ${matches.join(', ')}`)
  throw new Error(`Task not found: ${id}`)
}

function taskDirectoryForDowngrade(store: TaskStoreV2, id: string) {
  const openDirectory = taskDirectoryV2(store, id)
  if (existsSync(join(openDirectory, 'task.json')))
    return { directory: openDirectory, archived: false }
  const archivedDirectory = archivedTaskDirectoryV2(store, id)
  if (archivedDirectory) return { directory: archivedDirectory, archived: true }
  throw new Error(`Task not found: ${id}`)
}

export function downgradeTaskV2(
  store: TaskStoreV2,
  id: string,
  options: { expectRevision: number; actor: string },
): DowngradeTaskV2Result {
  assertExpectedRevision(options.expectRevision)
  assertWritableActor(options.actor)
  const canonicalId = resolveTaskIdForDowngrade(store, id)

  return withTaskLockV2(store, canonicalId, () =>
    withStateLockV2(store, () => {
      const { directory, archived } = taskDirectoryForDowngrade(
        store,
        canonicalId,
      )
      const taskPath = join(directory, 'task.json')
      const current = readTaskFromDirectory(store, canonicalId, directory)
      if (current.revision !== options.expectRevision) {
        const events = readTaskEventLogFromDirectory(current, directory).events
        throw new Error(
          `Task changed: expected revision ${options.expectRevision}, current revision ${current.revision}.\n` +
            `Changed by: ${lastTaskActor(current, events)}.\n` +
            `Run latch context ${current.id} --json --brief and retry.`,
        )
      }
      if (
        current.schema_version !== V3_SCHEMA_VERSION &&
        current.schema_version !== V4_SCHEMA_VERSION
      )
        throw new Error('downgrade-v2 requires a schema_version 3 or 4 task.')
      if (!archived) assertPrimaryWriter(current, options.actor)

      const eventLog = readTaskEventLogFromDirectory(current, directory)
      const next = downgradeTaskValue(current)
      const events = downgradeTaskEvents(eventLog.events)
      assertTaskV2(next, taskPath)
      for (const [index, event] of events.entries())
        validateTaskEventV2(event, `${join(directory, 'events.jsonl')}:${index + 1}`)

      const backupRoot = join(
        store.paths.archiveDir,
        `v${current.schema_version}-backup`,
      )
      const timestamp = now().replace(/\D/g, '')
      const backupDirectory = join(backupRoot, `${canonicalId}-${timestamp}`)
      if (existsSync(backupDirectory))
        throw new Error(`V3 backup already exists: ${backupDirectory}`)
      mkdirSync(backupRoot, { recursive: true })
      cpSync(directory, backupDirectory, {
        recursive: true,
        errorOnExist: true,
        force: false,
      })
      const backupPath = relative(store.paths.workspaceRoot, backupDirectory)
        .split(sep)
        .join('/')

      const serializedEvents = events.length > 0
        ? `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
        : ''
      try {
        writeTextAtomic(join(directory, 'events.jsonl'), serializedEvents)
        writeJsonAtomic(taskPath, next)
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error)
        throw new DowngradeTaskV2Error(
          `Downgrade stopped after backup creation at ${backupPath}: ${cause}`,
          backupPath,
          [
            ...eventLog.warnings,
            'Downgrade partially failed after backup creation; stop task mutations until the main task state is inspected.',
          ],
        )
      }

      return {
        task: next,
        warnings: eventLog.warnings,
        backupPath,
      }
    }),
  )
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
  assertWritableActor(options.actor)
  const canonicalId = resolveOpenTaskIdV2(store, id)

  const archivedTask = withTaskLockV2(store, canonicalId, () => {
    const current = readCanonicalTaskV2(store, canonicalId)
    assertRevisionMatches(store, current, options.expectRevision)
    assertCurrentWriterSchema(current)
    assertPrimaryWriter(current, options.actor)
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
    validateTaskEventForTask(
      next,
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
      appendTaskEventForTask(taskDirectoryV2(store, canonicalId), next, event)
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
