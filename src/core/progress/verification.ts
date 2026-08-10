import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { LatchDomainError } from '../errors.js'
import {
  assertTaskWritableV2,
  readTaskV2,
  updateTaskV2,
  updateTaskV4,
} from '../task-store.js'
import type { TaskStoreV2, TaskWriteResultV2 } from '../task-store.js'
import type {
  TaskV2,
  VerifyResult,
  WorkspaceDelta,
  WorkspaceEntry,
  WorkspaceSnapshot,
  WorkspaceViolation,
} from '../types.js'
import { now } from '../utils.js'
import {
  captureWorkspaceSnapshot,
  compareWorkspaceSnapshots,
  pathInWorkspaceScope,
  readWorkspaceEvidence,
  workspaceScopeDescendantCandidate,
  writeWorkspaceEvidence,
} from '../workspace-evidence.js'
import {
  assertValidWorkBasis,
  gatePlan,
  hasValidLegacyApproval,
  missingCurrentGates,
  requireText,
  usesLightProofPackage,
} from './shared.js'

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

export function assertReadyForWork(task: ReturnType<typeof readTaskV2>) {
  if (task.blocked) throw new Error(`Task is blocked: ${task.blocked.reason}`)
  if (usesLightProofPackage(task)) return assertValidWorkBasis(task)
  if (!hasValidLegacyApproval(task))
    throw new Error('Current plan does not have a valid implementation approval.')
}

export function verificationSummary(task: ReturnType<typeof readTaskV2>) {
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

export function requireWorkspaceScope(task: TaskV2) {
  if (!task.plan.workspace_scope)
    throw new Error(
      'Workspace proof upgrade required: save a plan with workspace_scope and approve it before verify, verify-all, or submit.',
    )
  return task.plan.workspace_scope
}

function taskDirectory(store: TaskStoreV2, task: TaskV2) {
  return join(store.paths.tasksDir, task.id)
}

export function readBaselineSnapshot(store: TaskStoreV2, task: TaskV2) {
  if (!task.workspace_proof) return undefined
  return readWorkspaceEvidence<WorkspaceSnapshot>(
    taskDirectory(store, task),
    task.workspace_proof.baseline_ref,
  )
}

export function validateCurrentGateEvidence(store: TaskStoreV2, task: TaskV2) {
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

export function reconcileViolations(
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

export function invalidateWorkspaceProof(
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
        unresolved_violations: reconciled.remaining,
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
    throw new LatchDomainError(
      'phase_mismatch',
      `Cannot verify task in phase ${current.phase}.`,
    )
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
      stdio: ['inherit', 2, 2],
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
    stdio: ['inherit', 2, 2],
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
  const descendantMismatch = delta.changes
    .filter((change) => change.scope === 'out_of_scope')
    .map((change) => ({
      path: change.path,
      candidate: workspaceScopeDescendantCandidate(change.path, scope),
    }))
    .filter(
      (value): value is { path: string; candidate: string } =>
        value.candidate !== undefined,
    )
    .sort((left, right) => left.path.localeCompare(right.path))[0]
  const scopeHint = descendantMismatch
    ? `Workspace scope path ${descendantMismatch.candidate} is an exact file path and does not include descendant ${descendantMismatch.path}; ` +
      `if the plan intends a directory prefix, change it to ${descendantMismatch.candidate}/ and obtain approval before verifying again.`
    : undefined
  const baselineWarning =
    before.counts.tracked_dirty +
      before.counts.untracked +
      before.counts.explicit_ignored >
    0
      ? `Gate ${name} ran against a dirty baseline: ${before.counts.in_scope} in scope, ${before.counts.out_of_scope} ambient covered path(s); samples: ${before.entries
          .slice(0, 8)
          .map((entry) =>
            `${entry.path} (${entry.scope === 'in_scope' ? 'in scope' : 'ambient'})`,
          )
          .join(', ')}.`
      : undefined
  return {
    ...written,
    warnings: [
      ...warnings,
      ...written.warnings,
      ...(mutationWarning ? [mutationWarning] : []),
      ...(scopeHint ? [scopeHint] : []),
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
    throw new LatchDomainError(
      'phase_mismatch',
      `Cannot verify task in phase ${current.phase}.`,
    )

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
