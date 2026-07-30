import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  artifactDeliveryWarnings,
  untrackedWorktreeWarnings,
} from './artifact-status.js'
import {
  archiveTaskV2,
  assertKnowledgeImpact,
  assertTaskWritableV2,
  materializeWorkBasisV3,
  readArchivedTaskV2,
  readTaskV2,
  updateTaskV2,
  updateTaskV4,
  listTasksV2,
} from './task-store.js'
import type { TaskStoreV2, TaskWriteResultV2 } from './task-store.js'
import type {
  ImplementationAuthorizationInput,
  KnowledgeImpact,
  RetrospectiveRecordInput,
  TaskProfile,
  TaskV2,
  VerifyResult,
  WorkspaceDelta,
  WorkspaceEntry,
  WorkspaceSnapshot,
  WorkspaceViolation,
} from './types.js'
import { now } from './utils.js'
import {
  captureWorkspaceSnapshot,
  compareWorkspaceSnapshots,
  pathInWorkspaceScope,
  readWorkspaceEvidence,
  writeWorkspaceEvidence,
} from './workspace-evidence.js'

export type ApproveTaskV2Input = {
  expectRevision: number
  actor: string
  reason?: string
  feedback?: string
  nonImplementationFeedback?: string
  authorization?: ImplementationAuthorizationInput
  retrospective?: RetrospectiveRecordInput
}

function requireText(value: string | undefined, message: string): string {
  if (!value?.trim()) throw new Error(message)
  return value.trim()
}

function cliArgument(value: string) {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

function sharedWorktreeWarnings(store: TaskStoreV2, taskId: string): string[] {
  const active = listTasksV2(store).filter((task) => task.id !== taskId)
  const devOrCheck = active.find(
    (task) => task.phase === 'dev' || task.phase === 'check',
  )
  if (devOrCheck)
    return [
      `Shared worktree: task ${devOrCheck.id} is also active in phase ${devOrCheck.phase}; verify changes against the whole worktree or use a separate Git worktree.`,
    ]
  const review = active.find((task) => task.phase === 'review')
  if (!review) return []
  const status = spawnSync(
    'git',
    ['-C', store.paths.workspaceRoot, 'status', '--porcelain'],
    { encoding: 'utf8' },
  )
  if (status.status === 0 && !status.stdout.trim()) return []
  const reason = status.status === 0
    ? 'the Git worktree is not clean'
    : 'Git status could not be determined'
  return [
    `Shared worktree: task ${review.id} is active in phase review and ${reason}; verify changes against the whole worktree or use a separate Git worktree.`,
  ]
}

function withWarnings(
  result: TaskWriteResultV2,
  warnings: string[],
): TaskWriteResultV2 {
  return { ...result, warnings: [...result.warnings, ...warnings] }
}

function profileOf(task: TaskV2): TaskProfile {
  return task.profile ?? 'standard'
}

function usesLightProofPackage(task: TaskV2) {
  return task.schema_version !== 2 && task.profile !== undefined
}

function hasValidLegacyApproval(task: TaskV2) {
  return (
    profileOf(task) === 'standard' &&
    task.implementation_approval?.approved_plan_revision === task.plan_revision
  )
}

function hasValidWorkBasis(task: TaskV2) {
  const basis = task.work_basis
  if (!basis || basis.plan_revision !== task.plan_revision) return false
  return (
    basis.kind === 'implementation_authorization' ||
    basis.work_revision === task.work_revision
  )
}

function assertValidWorkBasis(task: TaskV2) {
  if (hasValidWorkBasis(task) || hasValidLegacyApproval(task)) return
  throw new Error('Current task does not have a valid work_basis.')
}

function gatePlan(task: TaskV2) {
  return task.plan.verification_plan.filter((item) => item.kind === 'gate')
}

function missingCurrentGates(task: TaskV2) {
  return gatePlan(task).filter((item) => {
    const result = task.verification.gate[item.name]
    return (
      !result ||
      result.work_revision !== task.work_revision ||
      result.proof?.ended_generation !== task.workspace_proof?.generation ||
      result.status !== 'pass'
    )
  })
}

function assertSubmissionProof(task: TaskV2) {
  const submission = task.submission
  if (!submission) throw new Error('Current task does not have a submission.')
  const gates = gatePlan(task)
  if (submission.no_verify) {
    if (profileOf(task) === 'light')
      throw new Error('Light submit denied: --no-verify is not allowed for profile=light.')
    if (gates.length > 0)
      throw new Error('Current no-verify submission no longer has a gate-free plan.')
    return
  }
  if (gates.length === 0 || missingCurrentGates(task).length > 0)
    throw new Error('Current submission no longer has valid gate results.')
}

export function approveTaskV2(
  store: TaskStoreV2,
  id: string,
  input: ApproveTaskV2Input,
): TaskWriteResultV2 {
  const current = readTaskV2(store, id)
  if (current.blocked) throw new Error(`Task is blocked: ${current.blocked.reason}`)
  if (current.plan.open_questions.length > 0)
    throw new Error('Cannot approve while plan.open_questions is not empty.')
  if (input.authorization && input.retrospective)
    throw new Error('Authorization and retrospective inputs cannot be combined.')
  const warnings = sharedWorktreeWarnings(store, current.id)

  if (current.phase === 'plan') {
    if (input.feedback || input.nonImplementationFeedback !== undefined)
      throw new Error('Review feedback requires a task in review.')
    const legacyStandardApproval =
      profileOf(current) === 'standard' &&
      input.reason !== undefined &&
      !input.authorization &&
      !input.retrospective
    if (usesLightProofPackage(current) && !legacyStandardApproval) {
      if (input.reason)
        throw new Error('--reason cannot replace structured schema 4 work_basis input.')
      if (!input.authorization && !input.retrospective)
        throw new Error(
          'Schema 4 approval requires --authorization-file or --retrospective-file.',
        )
      if (input.authorization) {
        const workRevision = current.work_revision + 1
        const basis = materializeWorkBasisV3(
          input.authorization,
          current.plan_revision,
          workRevision,
        )
        return withWarnings(updateTaskV4(store, current.id, {
          expectRevision: input.expectRevision,
          actor: input.actor,
          events: [
            {
              type: 'implementation_authorized',
              fields: {
                plan_revision: basis.plan_revision,
                source: basis.source,
                reason: basis.reason,
                scope: basis.scope,
              },
            },
            { type: 'work_started', fields: { work_revision: workRevision } },
          ],
          update(task) {
            task.work_basis = basis
            delete task.implementation_approval
            task.work_revision = workRevision
            task.phase = 'dev'
            delete task.submission
          },
        }), warnings)
      }

      const retrospective = input.retrospective!
      const firstRecord = current.work_revision === 0
      if (firstRecord) {
        if (current.work_basis || current.implementation_approval || current.submission)
          throw new Error(
            'Retrospective denied: cannot apply retrospective_record to in-flight authorized task.',
          )
      } else if (
        current.work_basis?.kind !== 'retrospective_record' ||
        retrospective.code_unchanged !== true ||
        current.submission
      ) {
        throw new Error(
          'Retrospective rebind requires a prior retrospective_record, no submission, and code_unchanged=true.',
        )
      }
      const workRevision = firstRecord ? 1 : current.work_revision
      const basis = materializeWorkBasisV3(
        retrospective,
        current.plan_revision,
        workRevision,
      )
      return withWarnings(updateTaskV4(store, current.id, {
        expectRevision: input.expectRevision,
        actor: input.actor,
        events: [
          {
            type: 'retrospective_recorded',
            fields: {
              plan_revision: basis.plan_revision,
              work_revision: basis.work_revision,
              reason: basis.reason,
              implemented_before_task: basis.implemented_before_task,
              scope_summary: basis.scope_summary,
            },
          },
          ...(firstRecord
            ? [{ type: 'work_started' as const, fields: { work_revision: 1 } }]
            : []),
        ],
        update(task) {
          task.work_basis = basis
          delete task.implementation_approval
          task.work_revision = workRevision
          task.phase = 'dev'
          delete task.submission
        },
      }), warnings)
    }

    if (input.authorization || input.retrospective)
      throw new Error('Structured work_basis requires schema_version 4 with profile.')
    const reason = requireText(input.reason, '--reason is required in plan.')
    return withWarnings(updateTaskV2(store, current.id, {
      expectRevision: input.expectRevision,
      actor: input.actor,
      events: [
        {
          type: 'implementation_approved',
          fields: {
            plan_revision: current.plan_revision,
            source: 'user',
            reason,
          },
        },
        {
          type: 'work_started',
          fields: { work_revision: current.work_revision + 1 },
        },
      ],
      update(task) {
        delete task.work_basis
        task.implementation_approval = {
          approved_plan_revision: task.plan_revision,
          approved_at: now(),
          source: 'user',
          reason,
        }
        task.work_revision += 1
        task.phase = 'dev'
        delete task.submission
      },
    }), warnings)
  }

  if (current.phase === 'review') {
    if (input.nonImplementationFeedback !== undefined) {
      if (current.schema_version !== 4)
        throw new Error(
          'Non-implementation feedback requires schema_version 4.',
        )
      if (input.reason || input.feedback || input.authorization || input.retrospective)
        throw new Error(
          'Non-implementation feedback cannot be combined with approval or implementation feedback inputs.',
        )
      const summary = requireText(
        input.nonImplementationFeedback,
        '--non-implementation-feedback is required.',
      )
      const update = {
        expectRevision: input.expectRevision,
        actor: input.actor,
        events: [
          {
            type: 'review_feedback' as const,
            fields: {
              plan_revision: current.plan_revision,
              work_revision: current.work_revision,
              classification: 'non_implementation_correction' as const,
              summary,
            },
          },
        ],
        update() {},
      }
      return withWarnings(updateTaskV4(store, current.id, update), warnings)
    }
    if (input.reason) throw new Error('--reason cannot be combined with --feedback.')
    if (input.retrospective)
      throw new Error('Retrospective cannot be started from review.')
    const feedback = requireText(
      input.feedback,
      '--feedback is required for a task in review.',
    )
    if (usesLightProofPackage(current)) {
      const workRevision = current.work_revision + 1
      const nextBasis = input.authorization
        ? materializeWorkBasisV3(
            input.authorization,
            current.plan_revision,
            workRevision,
          )
        : undefined
      if (current.work_basis?.kind === 'retrospective_record' && !nextBasis)
        throw new Error(
          'Retrospective work cannot continue after review feedback; authorize first.',
        )
      if (!nextBasis) assertValidWorkBasis(current)
      return withWarnings(updateTaskV4(store, current.id, {
        expectRevision: input.expectRevision,
        actor: input.actor,
        events: [
          ...(nextBasis?.kind === 'implementation_authorization'
            ? [{
                type: 'implementation_authorized' as const,
                fields: {
                  plan_revision: nextBasis.plan_revision,
                  source: nextBasis.source,
                  reason: nextBasis.reason,
                  scope: nextBasis.scope,
                },
              }]
            : []),
          {
            type: 'review_feedback',
            fields: {
              plan_revision: current.plan_revision,
              work_revision: workRevision,
              classification: 'implementation_correction',
              summary: feedback,
            },
          },
          { type: 'work_started', fields: { work_revision: workRevision } },
        ],
        update(task) {
          if (nextBasis) {
            task.work_basis = nextBasis
            delete task.implementation_approval
          }
          task.work_revision = workRevision
          task.phase = 'dev'
          delete task.submission
        },
      }), warnings)
    }

    if (input.authorization)
      throw new Error('Structured authorization requires schema_version 4 with profile.')
    if (
      current.implementation_approval?.approved_plan_revision !==
      current.plan_revision
    )
      throw new Error('Current plan does not have a valid implementation approval.')
    return withWarnings(updateTaskV2(store, current.id, {
      expectRevision: input.expectRevision,
      actor: input.actor,
      events: [
        {
          type: 'review_feedback',
          fields: {
            plan_revision: current.plan_revision,
            work_revision: current.work_revision + 1,
            classification: 'implementation_correction',
            summary: feedback,
          },
        },
        {
          type: 'work_started',
          fields: { work_revision: current.work_revision + 1 },
        },
      ],
      update(task) {
        task.work_revision += 1
        task.phase = 'dev'
        delete task.submission
      },
    }), warnings)
  }

  throw new Error(`Cannot approve task in phase ${current.phase}.`)
}

export type VerifyTaskV2Input = {
  expectRevision: number
  actor: string
  name: string
  diagnostic: boolean
  command?: string[]
}

export type VerifyTaskV2Result = TaskWriteResultV2 & {
  verification: VerifyResult
}

export type VerifyAllTasksV2Result = TaskWriteResultV2 & {
  verifications: VerifyResult[]
  executions: Array<{ verification: VerifyResult; revision: number }>
  failed?: VerifyResult
  stoppedReason?: string
  stoppedGate?: string
  remaining: string[]
}

function assertReadyForWork(task: ReturnType<typeof readTaskV2>) {
  if (task.blocked) throw new Error(`Task is blocked: ${task.blocked.reason}`)
  if (usesLightProofPackage(task)) return assertValidWorkBasis(task)
  if (!hasValidLegacyApproval(task))
    throw new Error('Current plan does not have a valid implementation approval.')
}

function verificationSummary(task: ReturnType<typeof readTaskV2>) {
  return Object.values(task.verification.gate)
    .filter(
      (result) =>
        result.work_revision === task.work_revision &&
        result.proof?.ended_generation === task.workspace_proof?.generation,
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((result) => `${result.name}: ${result.status}`)
    .join('; ')
}

function requireWorkspaceScope(task: TaskV2) {
  if (!task.plan.workspace_scope)
    throw new Error(
      'Workspace proof upgrade required: save a plan with workspace_scope and approve it before verify, verify-all, or submit.',
    )
  return task.plan.workspace_scope
}

function taskDirectory(store: TaskStoreV2, task: TaskV2) {
  return join(store.paths.tasksDir, task.id)
}

function readBaselineSnapshot(store: TaskStoreV2, task: TaskV2) {
  if (!task.workspace_proof) return undefined
  return readWorkspaceEvidence<WorkspaceSnapshot>(
    taskDirectory(store, task),
    task.workspace_proof.baseline_ref,
  )
}

function validateCurrentGateEvidence(store: TaskStoreV2, task: TaskV2) {
  const directory = taskDirectory(store, task)
  for (const gate of gatePlan(task)) {
    const result = task.verification.gate[gate.name]
    if (
      !result ||
      result.work_revision !== task.work_revision ||
      result.proof?.ended_generation !== task.workspace_proof?.generation ||
      result.status !== 'pass'
    )
      continue
    if (!result.proof)
      throw new Error(`Gate ${gate.name} does not have workspace proof evidence.`)
    readWorkspaceEvidence(directory, result.proof.before_ref)
    readWorkspaceEvidence(directory, result.proof.after_ref)
    readWorkspaceEvidence(directory, result.proof.delta_ref)
  }
}

function sameViolationEntry(
  expected: WorkspaceEntry | undefined,
  current: WorkspaceEntry | undefined,
) {
  return isDeepStrictEqual(expected, current)
}

function reconcileViolations(
  task: TaskV2,
  snapshot: WorkspaceSnapshot,
) {
  const scope = requireWorkspaceScope(task)
  const currentEntries = new Map(snapshot.entries.map((entry) => [entry.path, entry]))
  const remaining: WorkspaceViolation[] = []
  const restored: string[] = []
  const reclassified: string[] = []
  for (const violation of task.workspace_proof?.unresolved_violations ?? []) {
    if (pathInWorkspaceScope(violation.path, scope)) {
      reclassified.push(violation.id)
      continue
    }
    if (sameViolationEntry(violation.before, currentEntries.get(violation.path))) {
      restored.push(violation.id)
      continue
    }
    remaining.push(violation)
  }
  return { remaining, restored, reclassified }
}

function appendViolations(
  existing: WorkspaceViolation[],
  delta: WorkspaceDelta,
  gate: string,
  generation: number,
  ignoredPaths: Set<string> = new Set(),
) {
  const byPath = new Map(existing.map((violation) => [violation.path, violation]))
  for (const change of delta.changes) {
    if (
      change.scope !== 'out_of_scope' ||
      ignoredPaths.has(change.path) ||
      byPath.has(change.path)
    )
      continue
    byPath.set(change.path, {
      id: randomUUID(),
      path: change.path,
      source_gate: gate,
      created_generation: generation,
      status: 'unresolved',
      ...(change.before ? { before: structuredClone(change.before) } : {}),
      ...(change.after ? { after: structuredClone(change.after) } : {}),
    })
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  )
}

function resolutionEvents(
  restored: string[],
  reclassified: string[],
) {
  const events: Array<{
    type: 'workspace_violation_resolved'
    fields: Record<string, unknown>
  }> = []
  if (restored.length > 0)
    events.push({
      type: 'workspace_violation_resolved',
      fields: { violation_ids: restored, resolution: 'restored' },
    })
  if (reclassified.length > 0)
    events.push({
      type: 'workspace_violation_resolved',
      fields: { violation_ids: reclassified, resolution: 'reclassified' },
    })
  return events
}

function invalidateWorkspaceProof(
  store: TaskStoreV2,
  task: TaskV2,
  input: { expectRevision: number; actor: string },
  snapshot: WorkspaceSnapshot,
  delta: WorkspaceDelta,
  reason: string,
  source: string,
) {
  if (!task.workspace_proof)
    throw new Error('Cannot invalidate a missing workspace proof generation.')
  const directory = taskDirectory(store, task)
  const liveRef = writeWorkspaceEvidence(
    directory,
    source,
    'live',
    snapshot,
  )
  const deltaRef = writeWorkspaceEvidence(directory, source, 'delta', delta)
  const nextGeneration = task.workspace_proof.generation + 1
  const reconciled = reconcileViolations(task, snapshot)
  const resolvedIds = new Set([
    ...reconciled.restored.map((id) =>
      task.workspace_proof!.unresolved_violations.find(
        (violation) => violation.id === id,
      )?.path,
    ),
    ...reconciled.reclassified.map((id) =>
      task.workspace_proof!.unresolved_violations.find(
        (violation) => violation.id === id,
      )?.path,
    ),
  ].filter((path): path is string => Boolean(path)))
  const violations = appendViolations(
    reconciled.remaining,
    delta,
    source,
    nextGeneration,
    resolvedIds,
  )
  return updateTaskV4(store, task.id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    events: [
      {
        type: 'proof_invalidated',
        fields: {
          from_generation: task.workspace_proof.generation,
          to_generation: nextGeneration,
          reason,
          changed_count: delta.changed_count,
          before_ref: task.workspace_proof.baseline_ref,
          after_ref: liveRef,
          changes_ref: deltaRef,
        },
      },
      ...resolutionEvents(reconciled.restored, reconciled.reclassified),
    ],
    update(next) {
      next.workspace_proof = {
        generation: nextGeneration,
        baseline_ref: liveRef,
        baseline_counts: structuredClone(snapshot.counts),
        unresolved_violations: violations,
      }
      delete next.submission
    },
  })
}

function evidenceFailureResult(
  task: TaskV2,
  name: string,
  kind: 'gate' | 'diagnostic',
  command: string[],
  snapshot: WorkspaceSnapshot,
) {
  return {
    name,
    kind,
    command: [...command],
    status: 'fail',
    exit_code: 127,
    work_revision: task.work_revision,
    created_at: now(),
    failure_reason: 'evidence_error',
    command_outcome: {
      status: 'error',
      exit_code: 127,
      error: snapshot.error ?? 'Workspace evidence is incomplete.',
    },
    workspace_effect: {
      status: 'evidence_error',
      changed_count: 0,
      in_scope_count: 0,
      out_of_scope_count: 0,
      samples: [],
      error: snapshot.error ?? 'Workspace evidence is incomplete.',
    },
  } satisfies VerifyResult
}

export function verifyTaskV2(
  store: TaskStoreV2,
  id: string,
  input: VerifyTaskV2Input,
): VerifyTaskV2Result {
  const current = assertTaskWritableV2(
    store,
    id,
    input.actor,
    input.expectRevision,
  )
  assertReadyForWork(current)
  if (current.phase !== 'dev' && current.phase !== 'check')
    throw new Error(`Cannot verify task in phase ${current.phase}.`)
  const name = requireText(input.name, '--name is required.')
  const planned = current.plan.verification_plan.find((item) => item.name === name)
  let kind: 'gate' | 'diagnostic'
  let command: string[]
  if (input.diagnostic) {
    kind = 'diagnostic'
    if (input.command?.length) command = input.command
    else {
      if (!planned || planned.kind !== 'diagnostic')
        throw new Error(`Diagnostic verification is not defined in plan: ${name}.`)
      command = planned.command
    }
  } else {
    if (input.command?.length)
      throw new Error('Gate verification command comes from the approved plan.')
    if (!planned || planned.kind !== 'gate')
      throw new Error(`Gate verification is not defined in plan: ${name}.`)
    kind = 'gate'
    command = planned.command
  }

  if (kind === 'diagnostic') {
    const executed = spawnSync(command[0], command.slice(1), {
      cwd: store.paths.workspaceRoot,
      stdio: 'inherit',
    })
    const exitCode = executed.status ?? 127
    const result: VerifyResult = {
      name,
      kind,
      command: [...command],
      status: exitCode === 0 ? 'pass' : 'fail',
      exit_code: exitCode,
      work_revision: current.work_revision,
      created_at: now(),
    }
    const written = updateTaskV4(store, current.id, {
      expectRevision: input.expectRevision,
      actor: input.actor,
      events: [{
        type: 'verification_run',
        fields: {
          name,
          kind,
          status: result.status,
          exit_code: result.exit_code,
          work_revision: result.work_revision,
          ...(executed.error ? { error: executed.error.message } : {}),
        },
      }],
      update(task) {
        task.verification.diagnostic[name] = result
      },
    })
    return { ...written, verification: result }
  }

  const scope = requireWorkspaceScope(current)
  let workingTask = current
  let revision = input.expectRevision
  const warnings: string[] = []
  let before = captureWorkspaceSnapshot(
    store.paths.workspaceRoot,
    scope,
    current.artifacts,
  )
  const directory = taskDirectory(store, current)
  if (!before.complete) {
    writeWorkspaceEvidence(directory, name, 'before', before)
    const result = evidenceFailureResult(current, name, kind, command, before)
    const written = updateTaskV2(store, current.id, {
      expectRevision: revision,
      actor: input.actor,
      events: [{
        type: 'verification_run',
        fields: {
          name,
          kind,
          status: 'fail',
          failure_reason: 'evidence_error',
          exit_code: 127,
          work_revision: current.work_revision,
          error: before.error,
        },
      }],
      update(task) {
        task.verification.gate[name] = result
        if (task.phase === 'dev') task.phase = 'check'
      },
    })
    return {
      ...written,
      warnings: [
        ...written.warnings,
        `Workspace evidence capture failed before gate ${name}; command was not started.`,
      ],
      verification: result,
    }
  }

  if (workingTask.workspace_proof) {
    let baseline: WorkspaceSnapshot
    try {
      baseline = readBaselineSnapshot(store, workingTask)!
    } catch (error) {
      const failed = {
        ...before,
        complete: false,
        error: error instanceof Error ? error.message : String(error),
      }
      const result = evidenceFailureResult(
        workingTask,
        name,
        kind,
        command,
        failed,
      )
      const written = updateTaskV4(store, workingTask.id, {
        expectRevision: revision,
        actor: input.actor,
        events: [{
          type: 'verification_run',
          fields: {
            name,
            kind,
            status: 'fail',
            failure_reason: 'evidence_error',
            exit_code: 127,
            work_revision: workingTask.work_revision,
            error: failed.error,
          },
        }],
        update(task) {
          task.verification.gate[name] = result
          if (task.phase === 'dev') task.phase = 'check'
        },
      })
      return { ...written, verification: result }
    }
    const liveDelta = compareWorkspaceSnapshots(baseline, before, scope)
    const reconciled = reconcileViolations(workingTask, before)
    if (
      liveDelta.status !== 'unchanged' ||
      reconciled.restored.length > 0 ||
      reconciled.reclassified.length > 0
    ) {
      const invalidated = invalidateWorkspaceProof(
        store,
        workingTask,
        { expectRevision: revision, actor: input.actor },
        before,
        liveDelta,
        'workspace_baseline_mismatch',
        name,
      )
      workingTask = invalidated.task
      revision = workingTask.revision
      warnings.push(
        ...invalidated.warnings,
        `Workspace baseline changed before gate ${name}; proof generation advanced to ${workingTask.workspace_proof!.generation}.`,
      )
    }
  }

  const executed = spawnSync(command[0], command.slice(1), {
    cwd: store.paths.workspaceRoot,
    stdio: 'inherit',
  })
  const exitCode = executed.status ?? 127
  const after = captureWorkspaceSnapshot(
    store.paths.workspaceRoot,
    scope,
    workingTask.artifacts,
  )
  const beforeRef = writeWorkspaceEvidence(directory, name, 'before', before)
  const afterRef = writeWorkspaceEvidence(directory, name, 'after', after)
  const delta = compareWorkspaceSnapshots(before, after, scope)
  const deltaRef = writeWorkspaceEvidence(directory, name, 'delta', delta)
  delta.changes_ref = deltaRef
  const startedGeneration = workingTask.workspace_proof?.generation ?? 1
  const mutation =
    delta.status === 'in_scope_mutation' ||
    delta.status === 'out_of_scope_mutation' ||
    delta.status === 'mixed_mutation'
  const endedGeneration = mutation
    ? startedGeneration + 1
    : startedGeneration
  const reconciled = after.complete
    ? reconcileViolations(workingTask, after)
    : { remaining: workingTask.workspace_proof?.unresolved_violations ?? [], restored: [], reclassified: [] }
  const resolvedPaths = new Set([
    ...reconciled.restored,
    ...reconciled.reclassified,
  ].map((id) =>
    workingTask.workspace_proof?.unresolved_violations.find(
      (violation) => violation.id === id,
    )?.path,
  ).filter((path): path is string => Boolean(path)))
  const violations = mutation
    ? appendViolations(
        reconciled.remaining,
        delta,
        name,
        endedGeneration,
        resolvedPaths,
      )
    : reconciled.remaining
  const commandOutcome = {
    status: executed.error ? 'error' : exitCode === 0 ? 'pass' : 'fail',
    exit_code: exitCode,
    ...(executed.error ? { error: executed.error.message } : {}),
  } as const
  const failureReason =
    delta.status === 'evidence_error'
      ? 'evidence_error'
      : delta.out_of_scope_count > 0
        ? 'scope_violation'
        : delta.in_scope_count > 0
          ? 'workspace_mutated'
          : exitCode !== 0
            ? 'command_failed'
            : violations.length > 0
              ? 'unresolved_scope_violation'
              : undefined
  const { changes: _changes, ...workspaceEffect } = delta
  const result: VerifyResult = {
    name,
    kind,
    command: [...command],
    status: failureReason ? 'fail' : 'pass',
    exit_code: exitCode,
    work_revision: workingTask.work_revision,
    created_at: now(),
    ...(failureReason ? { failure_reason: failureReason } : {}),
    command_outcome: commandOutcome,
    workspace_effect: workspaceEffect,
    proof: {
      work_revision: workingTask.work_revision,
      started_generation: startedGeneration,
      ended_generation: endedGeneration,
      before_ref: beforeRef,
      after_ref: afterRef,
      delta_ref: deltaRef,
    },
  }
  const written = updateTaskV4(store, workingTask.id, {
    expectRevision: revision,
    actor: input.actor,
    events: [
      ...(!workingTask.workspace_proof || mutation
        ? [{
            type: 'proof_generation_started' as const,
            fields: {
              generation: endedGeneration,
              reason: mutation ? 'workspace_mutated' : 'initial_gate_baseline',
            },
          }]
        : []),
      ...resolutionEvents(reconciled.restored, reconciled.reclassified),
      {
        type: 'verification_run',
        fields: {
          name,
          kind,
          status: result.status,
          ...(failureReason ? { failure_reason: failureReason } : {}),
          exit_code: result.exit_code,
          work_revision: result.work_revision,
          started_generation: startedGeneration,
          ended_generation: endedGeneration,
          workspace_effect: delta.status,
          changed_count: delta.changed_count,
          ...(executed.error ? { error: executed.error.message } : {}),
        },
      },
    ],
    update(task) {
      task.verification.gate[name] = result
      if (after.complete && (!task.workspace_proof || mutation)) {
        task.workspace_proof = {
          generation: endedGeneration,
          baseline_ref: afterRef,
          baseline_counts: structuredClone(after.counts),
          unresolved_violations: violations,
        }
      } else if (task.workspace_proof) {
        task.workspace_proof.unresolved_violations = violations
      }
      if (task.phase === 'dev') task.phase = 'check'
    },
  })
  const mutationWarning = mutation
    ? `Gate ${name} changed ${delta.changed_count} covered path(s): ${delta.in_scope_count} in scope, ${delta.out_of_scope_count} out of scope; proof pass was denied.`
    : undefined
  const baselineWarning =
    before.counts.tracked_dirty +
      before.counts.untracked +
      before.counts.explicit_ignored >
    0
      ? `Gate ${name} ran against a dirty baseline with ${before.entries.length} covered path(s).`
      : undefined
  return {
    ...written,
    warnings: [
      ...warnings,
      ...written.warnings,
      ...(mutationWarning ? [mutationWarning] : []),
      ...(baselineWarning ? [baselineWarning] : []),
    ],
    verification: result,
  }
}

export function verifyAllTasksV2(
  store: TaskStoreV2,
  id: string,
  input: Pick<VerifyTaskV2Input, 'expectRevision' | 'actor'>,
): VerifyAllTasksV2Result {
  const current = assertTaskWritableV2(
    store,
    id,
    input.actor,
    input.expectRevision,
  )
  assertReadyForWork(current)
  if (current.phase !== 'dev' && current.phase !== 'check')
    throw new Error(`Cannot verify task in phase ${current.phase}.`)

  let revision = input.expectRevision
  let task = current
  const warnings: string[] = []
  const verifications: VerifyResult[] = []
  const executions: Array<{ verification: VerifyResult; revision: number }> = []
  let failed: VerifyResult | undefined
  let stoppedReason: string | undefined
  let stoppedGate: string | undefined

  if (task.workspace_proof) {
    const scope = requireWorkspaceScope(task)
    const live = captureWorkspaceSnapshot(
      store.paths.workspaceRoot,
      scope,
      task.artifacts,
    )
    if (live.complete) {
      try {
        const baseline = readBaselineSnapshot(store, task)!
        const delta = compareWorkspaceSnapshots(baseline, live, scope)
        const reconciled = reconcileViolations(task, live)
        if (
          delta.status !== 'unchanged' ||
          reconciled.restored.length > 0 ||
          reconciled.reclassified.length > 0
        ) {
          const invalidated = invalidateWorkspaceProof(
            store,
            task,
            { expectRevision: revision, actor: input.actor },
            live,
            delta,
            'workspace_baseline_mismatch',
            'verify-all',
          )
          task = invalidated.task
          revision = task.revision
          warnings.push(
            ...invalidated.warnings,
            `Workspace baseline changed before verify-all; proof generation advanced to ${task.workspace_proof!.generation}.`,
          )
        }
      } catch {
        // 单 gate 原语会把 sidecar 完整性错误保存为 evidence_error。
      }
    }
  }

  const pending = missingCurrentGates(task)
  if (pending.length === 0)
    return {
      task,
      warnings,
      verifications,
      executions,
      remaining: [],
    }

  for (const item of pending) {
    if (executions.length > 0 && task.workspace_proof) {
      const scope = requireWorkspaceScope(task)
      const live = captureWorkspaceSnapshot(
        store.paths.workspaceRoot,
        scope,
        task.artifacts,
      )
      if (live.complete) {
        let baseline: WorkspaceSnapshot | undefined
        try {
          baseline = readBaselineSnapshot(store, task)
        } catch {
          baseline = undefined
        }
        if (baseline) {
          const delta = compareWorkspaceSnapshots(baseline, live, scope)
          const reconciled = reconcileViolations(task, live)
          if (
            delta.status !== 'unchanged' ||
            reconciled.restored.length > 0 ||
            reconciled.reclassified.length > 0
          ) {
            const invalidated = invalidateWorkspaceProof(
              store,
              task,
              { expectRevision: revision, actor: input.actor },
              live,
              delta,
              'workspace_baseline_mismatch',
              'verify-all-between-gates',
            )
            task = invalidated.task
            revision = task.revision
            warnings.push(
              ...invalidated.warnings,
              'Workspace baseline changed between gates; verify-all stopped before the next command.',
            )
            stoppedReason = 'workspace_baseline_mismatch'
            stoppedGate = item.name
            break
          }
        }
      }
    }
    const result = verifyTaskV2(store, id, {
      expectRevision: revision,
      actor: input.actor,
      name: item.name,
      diagnostic: false,
    })
    task = result.task
    revision = result.task.revision
    warnings.push(...result.warnings)
    verifications.push(result.verification)
    executions.push({
      verification: result.verification,
      revision: result.task.revision,
    })
    if (result.verification.status === 'fail') {
      failed = result.verification
      stoppedReason = result.verification.failure_reason ?? 'command_failed'
      stoppedGate = result.verification.name
      break
    }
  }
  const remaining = missingCurrentGates(task).map((item) => item.name)
  return {
    task,
    warnings,
    verifications,
    executions,
    remaining,
    ...(failed ? { failed } : {}),
    ...(stoppedReason ? { stoppedReason } : {}),
    ...(stoppedGate ? { stoppedGate } : {}),
  }
}

export type SubmitTaskV2Input = {
  expectRevision: number
  actor: string
  changes: string
  unverified: string
  noVerify: boolean
  reason?: string
  knowledgeImpact?: KnowledgeImpact
  verboseWarnings?: boolean
}

export function submitTaskV2(
  store: TaskStoreV2,
  id: string,
  input: SubmitTaskV2Input,
): TaskWriteResultV2 {
  const current = assertTaskWritableV2(
    store,
    id,
    input.actor,
    input.expectRevision,
  )
  assertReadyForWork(current)
  const workspaceScope = requireWorkspaceScope(current)
  if (current.plan.open_questions.length > 0)
    throw new Error('Cannot submit while plan.open_questions is not empty.')
  const changes = requireText(input.changes, '--changes is required.')
  if (typeof input.unverified !== 'string')
    throw new Error('--unverified is required.')
  const gates = gatePlan(current)
  let noVerifyReason: string | undefined
  if (input.noVerify) {
    if (profileOf(current) === 'light')
      throw new Error('Light submit denied: --no-verify is not allowed for profile=light.')
    if (current.phase !== 'dev')
      throw new Error('No-verify submission requires phase dev.')
    if (gates.length > 0)
      throw new Error('No-verify submission requires a plan without gates.')
    noVerifyReason = requireText(input.reason, '--reason is required with --no-verify.')
  } else {
    if (input.reason) throw new Error('--reason requires --no-verify.')
    if (current.phase !== 'check')
      throw new Error('Gate submission requires phase check.')
    if (gates.length === 0)
      throw new Error('Gate submission requires at least one planned gate.')
    if (!current.workspace_proof)
      throw new Error('Current task does not have a workspace proof generation.')
    try {
      validateCurrentGateEvidence(store, current)
    } catch (error) {
      throw new Error(
        `Submit workspace evidence error: ${error instanceof Error ? error.message : String(error)}.`,
      )
    }
    const live = captureWorkspaceSnapshot(
      store.paths.workspaceRoot,
      workspaceScope,
      current.artifacts,
    )
    if (!live.complete)
      throw new Error(
        `Submit workspace evidence error: ${live.error ?? 'capture incomplete'}.`,
      )
    let baseline: WorkspaceSnapshot
    try {
      baseline = readBaselineSnapshot(store, current)!
    } catch (error) {
      throw new Error(
        `Submit workspace evidence error: ${error instanceof Error ? error.message : String(error)}.`,
      )
    }
    const liveDelta = compareWorkspaceSnapshots(baseline, live, workspaceScope)
    const reconciled = reconcileViolations(current, live)
    if (
      liveDelta.status !== 'unchanged' ||
      reconciled.restored.length > 0 ||
      reconciled.reclassified.length > 0
    ) {
      const invalidated = invalidateWorkspaceProof(
        store,
        current,
        { expectRevision: input.expectRevision, actor: input.actor },
        live,
        liveDelta,
        'workspace_baseline_mismatch',
        'submit',
      )
      throw new Error(
        `Submit denied: workspace proof generation advanced to ${invalidated.task.workspace_proof!.generation} at revision ${invalidated.task.revision}; rerun all named gates.`,
      )
    }
    if (current.workspace_proof.unresolved_violations.length > 0)
      throw new Error(
        `Submit denied: ${current.workspace_proof.unresolved_violations.length} unresolved workspace violation(s).`,
      )
    const missing = missingCurrentGates(current)
    if (missing.length > 0)
      throw new Error(
        `Current work revision has incomplete gates: ${missing.map((item) => item.name).join(', ')}.`,
      )
  }
  if (usesLightProofPackage(current)) {
    if (!input.knowledgeImpact)
      throw new Error('--knowledge-impact-file is required for schema 4 submission.')
    if (
      input.knowledgeImpact.kind === 'updated' &&
      Array.isArray(input.knowledgeImpact.artifact_refs) &&
      input.knowledgeImpact.artifact_refs.every(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          typeof item.kind === 'string' &&
          typeof item.path === 'string',
      )
    ) {
      assertKnowledgeImpact(
        input.knowledgeImpact,
        [...current.artifacts, ...input.knowledgeImpact.artifact_refs],
        'submit input',
      )
      const attached = new Set(
        current.artifacts.map((item) => `${item.kind}\u0000${item.path}`),
      )
      const missing = input.knowledgeImpact.artifact_refs.filter(
        (item) => !attached.has(`${item.kind}\u0000${item.path}`),
      )
      if (missing.length > 0) {
        const labels = missing.map((item) => `${item.kind}:${item.path}`)
        throw new Error(
          `Knowledge impact artifacts are not attached to the task: ${labels.join(', ')}. ` +
          `Run: latch artifact add ${cliArgument(current.id)} --expect-revision ${current.revision} ${labels.map(cliArgument).join(' ')}`,
        )
      }
    }
    assertKnowledgeImpact(input.knowledgeImpact, current.artifacts, 'submit input')
  } else if (input.knowledgeImpact) {
    throw new Error(
      'Knowledge impact requires schema_version 4; legacy data was not modified.',
    )
  }
  const verified = verificationSummary(current)
  return withWarnings(updateTaskV2(store, current.id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    events: [
      {
        type: 'submitted',
        fields: {
          ...(usesLightProofPackage(current)
            ? { plan_revision: current.plan_revision }
            : {}),
          work_revision: current.work_revision,
          no_verify: input.noVerify,
          ...(input.knowledgeImpact
            ? { knowledge_impact_kind: input.knowledgeImpact.kind }
            : {}),
        },
      },
    ],
    update(task) {
      task.submission = {
        ...(usesLightProofPackage(task)
          ? { plan_revision: task.plan_revision }
          : {}),
        work_revision: task.work_revision,
        changes,
        verified,
        unverified: input.unverified,
        ...(input.knowledgeImpact
          ? { knowledge_impact: structuredClone(input.knowledgeImpact) }
          : {}),
        ...(noVerifyReason ? { no_verify: { reason: noVerifyReason } } : {}),
        submitted_at: now(),
      }
      task.phase = 'review'
    },
  }), [
    ...artifactDeliveryWarnings(store.paths.workspaceRoot, current.artifacts),
    ...untrackedWorktreeWarnings(
      store.paths.workspaceRoot,
      input.verboseWarnings,
    ),
  ])
}

export type ChangeTaskProfileV3Input = {
  expectRevision: number
  actor: string
  profile: TaskProfile
  reason: string
  userRequestedNarrowing: boolean
}

export function changeTaskProfileV3(
  store: TaskStoreV2,
  id: string,
  input: ChangeTaskProfileV3Input,
): TaskWriteResultV2 {
  const current = readTaskV2(store, id)
  if (current.schema_version !== 4)
    throw new Error(
      'Profile changes require schema_version 4.',
    )
  const from = profileOf(current)
  if (input.profile === from)
    throw new Error(`Task profile is already ${from}.`)
  const reason = requireText(input.reason, '--profile-reason is required.')
  const hasAuthorization =
    (current.work_basis?.kind === 'implementation_authorization' &&
      current.work_basis.plan_revision === current.plan_revision) ||
    hasValidLegacyApproval(current)
  if (
    from === 'standard' &&
    input.profile === 'light' &&
    hasAuthorization &&
    !input.userRequestedNarrowing
  )
    throw new Error(
      'Standard to light requires explicit user-requested narrowing when authorization is active.',
    )
  return updateTaskV4(store, current.id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    events: [{
      type: 'profile_changed',
      fields: { from, to: input.profile, reason },
    }],
    update(task) {
      task.profile = input.profile
      task.plan_revision += 1
      task.phase = 'plan'
      delete task.implementation_approval
      delete task.submission
      task.verification = { gate: {}, diagnostic: {} }
    },
  })
}

export type PatchSubmissionKnowledgeImpactV3Input = {
  expectRevision: number
  actor: string
  knowledgeImpact: KnowledgeImpact
  reason?: string
}

export function patchSubmissionKnowledgeImpactV3(
  store: TaskStoreV2,
  id: string,
  input: PatchSubmissionKnowledgeImpactV3Input,
): TaskWriteResultV2 {
  const current = readTaskV2(store, id)
  if (!usesLightProofPackage(current))
    throw new Error(
      'Submission patch requires a schema 4 profile; legacy data was not modified.',
    )
  if (current.blocked) throw new Error(`Task is blocked: ${current.blocked.reason}`)
  if (current.phase !== 'review')
    throw new Error('Patch denied: task must be in review.')
  const submission = current.submission
  if (!submission) throw new Error('Patch denied: submission is required.')
  const previousImpact = submission.knowledge_impact
  const correction = previousImpact !== undefined
  const reason = correction
    ? requireText(input.reason, 'Patch correction requires a non-empty reason.')
    : undefined
  if (correction && isDeepStrictEqual(previousImpact, input.knowledgeImpact))
    throw new Error('Patch denied: knowledge_impact is unchanged.')
  if (
    submission.plan_revision !== undefined &&
    submission.plan_revision !== current.plan_revision
  )
    throw new Error('Patch denied: submission plan_revision mismatch.')
  if (submission.work_revision !== current.work_revision)
    throw new Error('Patch denied: submission work_revision mismatch.')
  assertValidWorkBasis(current)
  assertSubmissionProof(current)
  assertKnowledgeImpact(input.knowledgeImpact, current.artifacts, 'patch input')

  return updateTaskV4(store, current.id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    events: [{
      type: 'submission_knowledge_impact_patched',
      fields: {
        plan_revision: current.plan_revision,
        work_revision: current.work_revision,
        knowledge_impact_kind: input.knowledgeImpact.kind,
        operation: correction ? 'correction' : 'backfill',
        ...(correction
          ? {
              reason,
              previous_knowledge_impact: structuredClone(previousImpact),
              knowledge_impact: structuredClone(input.knowledgeImpact),
            }
          : {}),
      },
    }],
    update(task) {
      task.submission!.plan_revision = task.plan_revision
      task.submission!.knowledge_impact = structuredClone(input.knowledgeImpact)
    },
  })
}

export type DoneTaskV2Input = {
  expectRevision: number
  actor: string
  followup: string
}

export function doneTaskV2(
  store: TaskStoreV2,
  id: string,
  input: DoneTaskV2Input,
): TaskWriteResultV2 {
  const archived = readArchivedTaskV2(store, id)
  if (archived) {
    if (archived.outcome !== 'done')
      throw new Error(`Task was already archived as ${archived.outcome}.`)
    return { task: archived, warnings: [] }
  }
  const current = readTaskV2(store, id)
  if (current.blocked) throw new Error(`Task is blocked: ${current.blocked.reason}`)
  if (current.phase !== 'review')
    throw new Error(`Cannot complete task in phase ${current.phase}.`)
  const submission = current.submission
  if (!submission || submission.work_revision !== current.work_revision)
    throw new Error('Current work revision does not have a valid submission.')
  if (usesLightProofPackage(current)) {
    if (submission.plan_revision !== current.plan_revision)
      throw new Error('Current submission plan_revision is stale.')
    if (!submission.knowledge_impact)
      throw new Error('Current submission does not have knowledge_impact.')
    assertKnowledgeImpact(
      submission.knowledge_impact,
      current.artifacts,
      'current submission',
    )
    assertValidWorkBasis(current)
  }
  assertSubmissionProof(current)
  return archiveTaskV2(store, current.id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    outcome: 'done',
    update(task) {
      task.closure = {
        changes: submission.changes,
        verified: submission.verified,
        unverified: submission.unverified,
        followup: input.followup,
        accepted_at: now(),
      }
    },
  })
}

export type AbandonTaskV2Input = {
  expectRevision: number
  actor: string
  reason: string
}

export function abandonTaskV2(
  store: TaskStoreV2,
  id: string,
  input: AbandonTaskV2Input,
): TaskWriteResultV2 {
  const archived = readArchivedTaskV2(store, id)
  if (archived) {
    if (archived.outcome !== 'abandoned')
      throw new Error(`Task was already archived as ${archived.outcome}.`)
    return { task: archived, warnings: [] }
  }
  const reason = requireText(input.reason, '--reason is required.')
  return archiveTaskV2(store, id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    outcome: 'abandoned',
    eventFields: { reason },
  })
}
