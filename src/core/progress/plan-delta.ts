import { lstatSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import {
  materializeWorkBasisV3,
  readTaskV2,
  updateTaskV4,
} from '../task-store.js'
import type {
  TaskStoreV2,
  TaskWriteResultV2,
} from '../task-store.js'
import type {
  ImplementationAuthorization,
  ImplementationAuthorizationInput,
  TaskPlan,
  TaskV2,
} from '../types.js'
import {
  assertAuthorizableTaskPlan,
  normalizeTaskPlanInput,
} from '../plan-schema.js'
import {
  hasValidImplementationAuthorization,
  profileOf,
  sharedWorktreeWarnings,
  withWarnings,
} from './shared.js'

export type PlanDeltaErrorCode =
  | 'invalid_arguments'
  | 'task_not_found'
  | 'revision_conflict'
  | 'writer_mismatch'
  | 'writer_version_mismatch'
  | 'phase_mismatch'
  | 'task_blocked'

export class PlanDeltaError extends Error {
  constructor(
    readonly code: PlanDeltaErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PlanDeltaError'
  }
}

export type AppendWorkspaceScopeInput = {
  expectRevision: number
  actor: string
  paths: string[]
  authorization?: ImplementationAuthorizationInput
}

export type AppendWorkspaceScopeResult = TaskWriteResultV2 & {
  appendedPaths: string[]
  previousPlanRevision: number
  previousWorkRevision: number
  authorizationApplied: boolean
}

function invalidArguments(message: string): never {
  throw new PlanDeltaError('invalid_arguments', message)
}

function typedTaskRead(store: TaskStoreV2, id: string) {
  try {
    return readTaskV2(store, id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('Invalid task id:'))
      throw new PlanDeltaError('invalid_arguments', message)
    if (
      message.startsWith('Task not found:') ||
      message.startsWith('Task id is ambiguous:')
    )
      throw new PlanDeltaError('task_not_found', message)
    throw error
  }
}

function assertWritableDeltaTask(
  task: TaskV2,
  input: AppendWorkspaceScopeInput,
) {
  if (task.revision !== input.expectRevision)
    throw new PlanDeltaError(
      'revision_conflict',
      `Task changed: expected revision ${input.expectRevision}, current revision ${task.revision}.`,
    )
  if (task.schema_version !== 5)
    throw new PlanDeltaError(
      'writer_version_mismatch',
      `append-scope only mutates schema_version 5 tasks; task ${task.id} is historical schema_version ${task.schema_version}.`,
    )
  if (task.primary_writer !== input.actor)
    throw new PlanDeltaError(
      'writer_mismatch',
      `Writer mismatch: primary_writer is ${task.primary_writer}, caller is ${input.actor}.`,
    )
  if (task.blocked)
    throw new PlanDeltaError(
      'task_blocked',
      `Task is blocked: ${task.blocked.reason}`,
    )
  if (task.outcome !== undefined)
    throw new PlanDeltaError(
      'phase_mismatch',
      `append-scope requires an open task; task ${task.id} has outcome ${task.outcome}.`,
    )
}

function normalizeInputPaths(task: TaskV2, paths: string[]) {
  if (paths.length === 0)
    invalidArguments('--path is required at least once.')
  if (paths.some((candidate) => {
    if (candidate === '') return false
    const normalized = posix.normalize(candidate)
    return normalized === '.' || normalized === './'
  }))
    invalidArguments(
      'Invalid plan.workspace_scope.paths in append-scope input: repo root is not allowed.',
    )
  try {
    const inputPlan = normalizeTaskPlanInput(
      {
        ...structuredClone(task.plan),
        workspace_scope: { paths },
      },
      profileOf(task),
      'append-scope input',
    )
    return inputPlan.workspace_scope.paths
  } catch (error) {
    invalidArguments(error instanceof Error ? error.message : String(error))
  }
}

function assertDirectorySuffix(
  store: TaskStoreV2,
  paths: string[],
) {
  for (const candidate of paths) {
    if (candidate.endsWith('/')) continue
    try {
      if (!lstatSync(resolve(store.paths.workspaceRoot, candidate)).isDirectory())
        continue
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      throw error
    }
    invalidArguments(
      `Invalid plan.workspace_scope.paths in append-scope input: ${candidate} is an existing directory. ` +
        'Paths without a trailing "/" are exact files; ' +
        `use ${candidate}/ for a directory prefix.`,
    )
  }
}

function nextPlan(task: TaskV2, appendedPaths: string[]) {
  const plan: TaskPlan = {
    ...structuredClone(task.plan),
    workspace_scope: {
      paths: [
        ...(task.plan.workspace_scope?.paths ?? []),
        ...appendedPaths,
      ],
    },
  }
  try {
    return normalizeTaskPlanInput(
      plan,
      profileOf(task),
      'append-scope post-delta plan',
    )
  } catch (error) {
    invalidArguments(error instanceof Error ? error.message : String(error))
  }
}

function materializeAuthorization(
  task: TaskV2,
  plan: TaskPlan,
  input: ImplementationAuthorizationInput | undefined,
) {
  if (input === undefined) return undefined
  if (
    input?.kind !== 'implementation_authorization' ||
    (input.source !== 'user_delta' && input.source !== 'user_approve')
  )
    invalidArguments(
      'append-scope authorization source must be user_delta or user_approve.',
    )
  if (
    input.source === 'user_delta' &&
    !hasValidImplementationAuthorization(task)
  )
    invalidArguments(
      'user_delta requires a valid implementation authorization for the current plan revision.',
    )
  try {
    assertAuthorizableTaskPlan(
      plan,
      profileOf(task),
      `task ${task.id} post-delta plan`,
    )
    return materializeWorkBasisV3(
      input,
      task.plan_revision + 1,
      task.work_revision + 1,
    ) as ImplementationAuthorization
  } catch (error) {
    invalidArguments(error instanceof Error ? error.message : String(error))
  }
}

function typedAtomicUpdate<T>(update: () => T) {
  try {
    return update()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('Task changed:'))
      throw new PlanDeltaError('revision_conflict', message)
    if (message.startsWith('Writer mismatch:'))
      throw new PlanDeltaError('writer_mismatch', message)
    if (
      message.startsWith('Task not found:') ||
      message.startsWith('Task id is ambiguous:')
    )
      throw new PlanDeltaError('task_not_found', message)
    throw error
  }
}

export function appendWorkspaceScope(
  store: TaskStoreV2,
  id: string,
  input: AppendWorkspaceScopeInput,
): AppendWorkspaceScopeResult {
  const current = typedTaskRead(store, id)
  assertWritableDeltaTask(current, input)
  const normalizedInputs = normalizeInputPaths(current, input.paths)
  assertDirectorySuffix(store, normalizedInputs)
  const existingPaths = new Set(current.plan.workspace_scope?.paths ?? [])
  const appendedPaths = normalizedInputs.filter(
    (candidate) => !existingPaths.has(candidate),
  )
  if (appendedPaths.length === 0)
    invalidArguments('append-scope did not contain any new workspace scope path.')
  const plan = nextPlan(current, appendedPaths)
  const basis = materializeAuthorization(current, plan, input.authorization)
  const nextPlanRevision = current.plan_revision + 1
  const nextWorkRevision = basis
    ? current.work_revision + 1
    : current.work_revision

  const result = typedAtomicUpdate(() =>
    updateTaskV4(store, current.id, {
      expectRevision: input.expectRevision,
      actor: input.actor,
      events: [
        {
          type: 'plan_updated',
          fields: {
            plan_revision: nextPlanRevision,
            change: 'workspace_scope_append',
            appended_paths: appendedPaths,
          },
        },
        ...(basis
          ? [
              {
                type: 'implementation_authorized' as const,
                fields: {
                  plan_revision: basis.plan_revision,
                  source: basis.source,
                  reason: basis.reason,
                  scope: basis.scope,
                },
              },
              {
                type: 'work_started' as const,
                fields: { work_revision: nextWorkRevision },
              },
            ]
          : []),
      ],
      update(task) {
        task.plan = structuredClone(plan)
        task.plan_revision = nextPlanRevision
        task.phase = basis ? 'dev' : 'plan'
        if (basis) {
          task.work_basis = basis
          task.work_revision = nextWorkRevision
        }
        delete task.implementation_approval
        task.verification = { gate: {}, diagnostic: {} }
        delete task.submission
        delete task.workspace_proof
      },
    }),
  )

  return {
    ...withWarnings(result, sharedWorktreeWarnings(store, result.task.id)),
    appendedPaths,
    previousPlanRevision: current.plan_revision,
    previousWorkRevision: current.work_revision,
    authorizationApplied: basis !== undefined,
  }
}
