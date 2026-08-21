import { lstatSync } from 'node:fs'
import { basename, posix, resolve } from 'node:path'
import {
  materializeWorkBasisV3,
  readTaskV2,
  updateTaskV4,
  updateTaskV4WithRequiredEvents,
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

export type UpdateVerificationCommandInput = {
  expectRevision: number
  actor: string
  name: string
  command: string[]
  authorization?: ImplementationAuthorizationInput
}

export type UpdateVerificationCommandResult = TaskWriteResultV2 & {
  gateName: string
  previousCommand: string[]
  command: string[]
  previousPlanRevision: number
  previousWorkRevision: number
  authorizationApplied: boolean
}

export type AcceptanceReplacement = {
  from: string
  to: string
}

export type UpdateAcceptanceInput = {
  expectRevision: number
  actor: string
  updates: unknown
  authorization?: ImplementationAuthorizationInput
}

export type UpdateAcceptanceResult = TaskWriteResultV2 & {
  replacements: AcceptanceReplacement[]
  previousPlanRevision: number
  previousWorkRevision: number
  authorizationApplied: boolean
}

export type OpenQuestionResolution = {
  question: string
  answer: string
  decision: string
}

export type ResolveOpenQuestionsInput = {
  expectRevision: number
  actor: string
  answers: unknown
  authorization?: ImplementationAuthorizationInput
}

export type ResolveOpenQuestionsResult = TaskWriteResultV2 & {
  resolvedQuestions: OpenQuestionResolution[]
  previousPlanRevision: number
  previousWorkRevision: number
  authorizationApplied: boolean
}

const verificationCommandSentinel = 'replace-with-real-command'
const instructionOnlyGateCommands = new Set(['echo', 'printf', 'true'])

function implementationAuthorizationExample(
  source: ImplementationAuthorizationInput['source'],
) {
  return {
    kind: 'implementation_authorization' as const,
    source,
    reason: 'Describe the authorized plan delta.',
    scope: { summary: 'Describe the current post-delta plan.' },
  }
}

function invalidArguments(message: string): never {
  throw new PlanDeltaError('invalid_arguments', message)
}

function assertImplementationAuthorizationInput(
  input: ImplementationAuthorizationInput,
  commandName: string,
  allowedSources: readonly ImplementationAuthorizationInput['source'][],
) {
  const example = JSON.stringify(
    implementationAuthorizationExample(allowedSources[0] ?? 'user_delta'),
  )
  if (!isRecord(input))
    invalidArguments(
      `${commandName} authorization must be implementation_authorization JSON. Example: ${example}`,
    )
  if (input.kind !== 'implementation_authorization')
    invalidArguments(
      `${commandName} authorization kind must be implementation_authorization. Example: ${example}`,
    )
  if (
    typeof input.source !== 'string' ||
    !allowedSources.includes(input.source)
  )
    invalidArguments(
      `${commandName} authorization source must be ${allowedSources.join(' or ')}. Example: ${example}`,
    )
  if (typeof input.reason !== 'string' || input.reason.trim() === '')
    invalidArguments(
      `${commandName} authorization reason must be a non-empty string. Example: ${example}`,
    )
  if (!isRecord(input.scope))
    invalidArguments(
      `${commandName} authorization scope must be an object with scope.summary. Example: ${example}`,
    )
  if (
    typeof input.scope.summary !== 'string' ||
    input.scope.summary.trim() === ''
  )
    invalidArguments(
      `${commandName} authorization scope.summary must be a non-empty string. Example: ${example}`,
    )
  if (
    input.scope.paths !== undefined &&
    (!Array.isArray(input.scope.paths) ||
      input.scope.paths.some((entry) => typeof entry !== 'string'))
  )
    invalidArguments(
      `${commandName} authorization scope.paths must be a string array. Example: ${example}`,
    )
  if (
    input.scope.notes !== undefined &&
    (typeof input.scope.notes !== 'string' || input.scope.notes.trim() === '')
  )
    invalidArguments(
      `${commandName} authorization scope.notes must be a non-empty string. Example: ${example}`,
    )
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
    // Reader shape checks run before mutation-time gate lookup; map the frozen
    // contract codes so callers do not see opaque command_failed for these cases.
    if (message.startsWith('Duplicate verification_plan.name'))
      throw new PlanDeltaError('invalid_arguments', message)
    if (message.startsWith('Invalid min_writer_version'))
      throw new PlanDeltaError('writer_version_mismatch', message)
    throw error
  }
}

function assertWritableDeltaTask(
  task: TaskV2,
  input: { expectRevision: number; actor: string },
  commandName: string,
) {
  if (task.revision !== input.expectRevision)
    throw new PlanDeltaError(
      'revision_conflict',
      `Task changed: expected revision ${input.expectRevision}, current revision ${task.revision}.`,
    )
  if (task.schema_version !== 5)
    throw new PlanDeltaError(
      'writer_version_mismatch',
      `${commandName} only mutates schema_version 5 tasks; task ${task.id} is historical schema_version ${task.schema_version}.`,
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
      `${commandName} requires an open task; task ${task.id} has outcome ${task.outcome}.`,
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

function nextScopePlan(task: TaskV2, appendedPaths: string[]) {
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
  commandName: string,
  allowedSources: readonly ImplementationAuthorizationInput['source'][] = [
    'user_delta',
    'user_approve',
  ],
) {
  if (input === undefined) return undefined
  assertImplementationAuthorizationInput(input, commandName, allowedSources)
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

function applyPlanDeltaMutation(
  store: TaskStoreV2,
  current: TaskV2,
  input: {
    expectRevision: number
    actor: string
    authorization?: ImplementationAuthorizationInput
  },
  plan: TaskPlan,
  commandName: string,
  planUpdatedFields: Record<string, unknown>,
  options: {
    clearWorkspaceProof: boolean
    requireEventWrite?: boolean
    additionalEvents?: Array<{
      type: 'decision_recorded'
      fields: Record<string, unknown>
    }>
    allowedAuthorizationSources?: readonly ImplementationAuthorizationInput['source'][]
  },
) {
  const basis = materializeAuthorization(
    current,
    plan,
    input.authorization,
    commandName,
    options.allowedAuthorizationSources,
  )
  const nextPlanRevision = current.plan_revision + 1
  const nextWorkRevision = basis
    ? current.work_revision + 1
    : current.work_revision

  const updateTask = options.requireEventWrite
    ? updateTaskV4WithRequiredEvents
    : updateTaskV4
  const result = typedAtomicUpdate(() =>
    updateTask(store, current.id, {
      expectRevision: input.expectRevision,
      actor: input.actor,
      events: [
        {
          type: 'plan_updated',
          fields: {
            plan_revision: nextPlanRevision,
            ...planUpdatedFields,
          },
        },
        ...(options.additionalEvents ?? []),
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
        if (options.clearWorkspaceProof) delete task.workspace_proof
      },
    }),
  )

  return {
    result,
    basis,
    previousPlanRevision: current.plan_revision,
    previousWorkRevision: current.work_revision,
  }
}

function sameCommand(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function assertGateCommand(command: string[]) {
  if (command.length === 0)
    invalidArguments(
      'update-verification-command requires a non-empty command after --.',
    )
  if (command.some((arg) => typeof arg !== 'string'))
    invalidArguments('update-verification-command command argv must be strings.')
  if (command.includes(verificationCommandSentinel))
    invalidArguments(
      `update-verification-command rejects sentinel command token ${verificationCommandSentinel}.`,
    )
  const executable = basename(command[0] ?? '')
  if (instructionOnlyGateCommands.has(executable))
    invalidArguments(
      `update-verification-command rejects instruction-only gate command ${executable}.`,
    )
}

function resolveGateTarget(task: TaskV2, name: string) {
  if (name.trim() === '')
    invalidArguments('--name is required.')
  const matches = task.plan.verification_plan
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.name === name)
  if (matches.length === 0)
    invalidArguments(
      `update-verification-command could not find verification item ${name}.`,
    )
  if (matches.length > 1)
    invalidArguments(
      `update-verification-command requires a unique verification name; ${name} matches ${matches.length} items.`,
    )
  const match = matches[0]!
  if (match.item.kind !== 'gate')
    invalidArguments(
      `update-verification-command only updates kind=gate items; ${name} is ${match.item.kind}.`,
    )
  return match
}

function nextVerificationPlan(
  task: TaskV2,
  index: number,
  command: string[],
) {
  const plan: TaskPlan = {
    ...structuredClone(task.plan),
    verification_plan: task.plan.verification_plan.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            command: [...command],
          }
        : item,
    ),
  }
  try {
    return normalizeTaskPlanInput(
      plan,
      profileOf(task),
      'update-verification-command post-delta plan',
    )
  } catch (error) {
    invalidArguments(error instanceof Error ? error.message : String(error))
  }
}

export function appendWorkspaceScope(
  store: TaskStoreV2,
  id: string,
  input: AppendWorkspaceScopeInput,
): AppendWorkspaceScopeResult {
  const current = typedTaskRead(store, id)
  assertWritableDeltaTask(current, input, 'append-scope')
  const normalizedInputs = normalizeInputPaths(current, input.paths)
  assertDirectorySuffix(store, normalizedInputs)
  const existingPaths = new Set(current.plan.workspace_scope?.paths ?? [])
  const appendedPaths = normalizedInputs.filter(
    (candidate) => !existingPaths.has(candidate),
  )
  if (appendedPaths.length === 0)
    invalidArguments('append-scope did not contain any new workspace scope path.')
  const plan = nextScopePlan(current, appendedPaths)
  const { result, basis, previousPlanRevision, previousWorkRevision } =
    applyPlanDeltaMutation(
      store,
      current,
      input,
      plan,
      'append-scope',
      {
        change: 'workspace_scope_append',
        appended_paths: appendedPaths,
      },
      { clearWorkspaceProof: true },
    )

  return {
    ...withWarnings(result, sharedWorktreeWarnings(store, result.task.id)),
    appendedPaths,
    previousPlanRevision,
    previousWorkRevision,
    authorizationApplied: basis !== undefined,
  }
}

export function updateVerificationCommand(
  store: TaskStoreV2,
  id: string,
  input: UpdateVerificationCommandInput,
): UpdateVerificationCommandResult {
  const current = typedTaskRead(store, id)
  assertWritableDeltaTask(current, input, 'update-verification-command')
  assertGateCommand(input.command)
  const target = resolveGateTarget(current, input.name)
  const previousCommand = [...target.item.command]
  if (sameCommand(previousCommand, input.command))
    invalidArguments(
      `update-verification-command command for ${input.name} is unchanged.`,
    )
  const plan = nextVerificationPlan(current, target.index, input.command)
  const { result, basis, previousPlanRevision, previousWorkRevision } =
    applyPlanDeltaMutation(
      store,
      current,
      input,
      plan,
      'update-verification-command',
      {
        change: 'verification_command_update',
        gate_name: input.name,
        previous_command: previousCommand,
        command: [...input.command],
      },
      { clearWorkspaceProof: false },
    )

  return {
    ...withWarnings(result, sharedWorktreeWarnings(store, result.task.id)),
    gateName: input.name,
    previousCommand,
    command: [...input.command],
    previousPlanRevision,
    previousWorkRevision,
    authorizationApplied: basis !== undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys)
  const actual = Object.keys(value)
  return actual.length === allowed.size && actual.every((key) => allowed.has(key))
}

function resolveAcceptanceReplacements(
  task: TaskV2,
  payload: unknown,
): AcceptanceReplacement[] {
  if (!isRecord(payload) || !exactKeys(payload, ['replacements']))
    invalidArguments(
      'update-acceptance updates file must contain only the replacements property.',
    )
  if (!Array.isArray(payload.replacements) || payload.replacements.length === 0)
    invalidArguments(
      'update-acceptance replacements must contain at least one item.',
    )

  const seenFrom = new Set<string>()
  const replacements = payload.replacements.map((value, index) => {
    if (!isRecord(value) || !exactKeys(value, ['from', 'to']))
      invalidArguments(
        `update-acceptance replacement at index ${index} must contain only from and to.`,
      )
    if (typeof value.from !== 'string' || !value.from.trim())
      invalidArguments(
        `update-acceptance from at index ${index} must be non-empty text.`,
      )
    if (typeof value.to !== 'string' || !value.to.trim())
      invalidArguments(
        `update-acceptance to at index ${index} must be non-empty text.`,
      )
    if (value.from === value.to)
      invalidArguments(
        `update-acceptance replacement at index ${index} must change the acceptance text.`,
      )
    if (seenFrom.has(value.from))
      invalidArguments(
        `update-acceptance from at index ${index} duplicates an earlier replacement target.`,
      )
    seenFrom.add(value.from)
    const matches = task.plan.acceptance.filter(
      (acceptance) => acceptance === value.from,
    ).length
    if (matches !== 1)
      invalidArguments(
        `update-acceptance from at index ${index} must exactly match one current acceptance item; matched ${matches}.`,
      )
    return { from: value.from, to: value.to }
  })

  const replacementByFrom = new Map(
    replacements.map((replacement) => [replacement.from, replacement.to]),
  )
  const nextAcceptance = task.plan.acceptance.map(
    (acceptance) => replacementByFrom.get(acceptance) ?? acceptance,
  )
  if (new Set(nextAcceptance).size !== nextAcceptance.length)
    invalidArguments(
      'update-acceptance replacements must not create duplicate acceptance items.',
    )
  return replacements
}

function nextAcceptancePlan(
  task: TaskV2,
  replacements: AcceptanceReplacement[],
) {
  const replacementByFrom = new Map(
    replacements.map((replacement) => [replacement.from, replacement.to]),
  )
  const plan: TaskPlan = {
    ...structuredClone(task.plan),
    acceptance: task.plan.acceptance.map(
      (acceptance) => replacementByFrom.get(acceptance) ?? acceptance,
    ),
  }
  try {
    return normalizeTaskPlanInput(
      plan,
      profileOf(task),
      'update-acceptance post-delta plan',
    )
  } catch (error) {
    invalidArguments(error instanceof Error ? error.message : String(error))
  }
}

export function updateAcceptance(
  store: TaskStoreV2,
  id: string,
  input: UpdateAcceptanceInput,
): UpdateAcceptanceResult {
  const current = typedTaskRead(store, id)
  assertWritableDeltaTask(current, input, 'update-acceptance')
  const replacements = resolveAcceptanceReplacements(current, input.updates)
  const plan = nextAcceptancePlan(current, replacements)
  const { result, basis, previousPlanRevision, previousWorkRevision } =
    applyPlanDeltaMutation(
      store,
      current,
      input,
      plan,
      'update-acceptance',
      {},
      { clearWorkspaceProof: false },
    )

  return {
    ...withWarnings(result, sharedWorktreeWarnings(store, result.task.id)),
    replacements: structuredClone(replacements),
    previousPlanRevision,
    previousWorkRevision,
    authorizationApplied: basis !== undefined,
  }
}

function resolveAnswers(
  task: TaskV2,
  payload: unknown,
): OpenQuestionResolution[] {
  const questions = task.plan.open_questions
  if (questions.length === 0)
    invalidArguments(
      'resolve-open-questions requires at least one current open question.',
    )
  if (new Set(questions).size !== questions.length)
    invalidArguments(
      'resolve-open-questions requires unique current open questions.',
    )
  if (!isRecord(payload) || !exactKeys(payload, ['answers']))
    invalidArguments(
      'resolve-open-questions answers file must contain only the answers property.',
    )
  const answers = payload.answers
  if (!Array.isArray(answers) || answers.length !== questions.length)
    invalidArguments(
      `resolve-open-questions answers must contain exactly ${questions.length} item(s).`,
    )

  return answers.map((value, index) => {
    if (
      !isRecord(value) ||
      !exactKeys(value, ['question', 'answer', 'decision'])
    )
      invalidArguments(
        `resolve-open-questions answer at index ${index} must contain only question, answer, and decision.`,
      )
    if (typeof value.question !== 'string')
      invalidArguments(
        `resolve-open-questions question at index ${index} must be a string.`,
      )
    if (value.question !== questions[index])
      invalidArguments(
        `resolve-open-questions question at index ${index} does not exactly match the current open question.`,
      )
    if (typeof value.answer !== 'string' || !value.answer.trim())
      invalidArguments(
        `resolve-open-questions answer at index ${index} must be non-empty text.`,
      )
    if (typeof value.decision !== 'string' || !value.decision.trim())
      invalidArguments(
        `resolve-open-questions decision at index ${index} must be non-empty text.`,
      )
    return {
      question: value.question,
      answer: value.answer,
      decision: value.decision,
    }
  })
}

function nextOpenQuestionsPlan(task: TaskV2) {
  const plan: TaskPlan = {
    ...structuredClone(task.plan),
    open_questions: [],
  }
  try {
    return normalizeTaskPlanInput(
      plan,
      profileOf(task),
      'resolve-open-questions post-delta plan',
    )
  } catch (error) {
    invalidArguments(error instanceof Error ? error.message : String(error))
  }
}

export function resolveOpenQuestions(
  store: TaskStoreV2,
  id: string,
  input: ResolveOpenQuestionsInput,
): ResolveOpenQuestionsResult {
  const current = typedTaskRead(store, id)
  assertWritableDeltaTask(current, input, 'resolve-open-questions')
  if (current.phase !== 'plan')
    throw new PlanDeltaError(
      'phase_mismatch',
      `resolve-open-questions requires phase plan; task ${current.id} is in phase ${current.phase}.`,
    )
  const resolvedQuestions = resolveAnswers(current, input.answers)
  const plan = nextOpenQuestionsPlan(current)
  const { result, basis, previousPlanRevision, previousWorkRevision } =
    applyPlanDeltaMutation(
      store,
      current,
      input,
      plan,
      'resolve-open-questions',
      {
        change: 'open_questions_resolved',
        resolved_count: resolvedQuestions.length,
      },
      {
        clearWorkspaceProof: false,
        requireEventWrite: true,
        additionalEvents: resolvedQuestions.map((resolved) => ({
          type: 'decision_recorded' as const,
          fields: {
            plan_revision: current.plan_revision + 1,
            question: resolved.question,
            answer: resolved.answer,
            conclusion: resolved.decision,
          },
        })),
        allowedAuthorizationSources: ['user_approve'],
      },
    )

  return {
    ...withWarnings(result, sharedWorktreeWarnings(store, result.task.id)),
    resolvedQuestions,
    previousPlanRevision,
    previousWorkRevision,
    authorizationApplied: basis !== undefined,
  }
}
