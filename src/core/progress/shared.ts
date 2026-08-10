import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { LatchDomainError } from '../errors.js'
import { listTasksV2 } from '../task-store.js'
import type { TaskStoreV2, TaskWriteResultV2 } from '../task-store.js'
import type { TaskProfile, TaskV2, WorkspaceSnapshot } from '../types.js'
import {
  captureWorkspaceSnapshot,
  compareWorkspaceScopeContent,
  compareWorkspaceSnapshots,
  readWorkspaceEvidence,
} from '../workspace-evidence.js'

export function requireText(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value.trim()
}

export function cliArgument(value: string) {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function sharedWorktreeWarnings(store: TaskStoreV2, taskId: string): string[] {
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

export function withWarnings(
  result: TaskWriteResultV2,
  warnings: string[],
): TaskWriteResultV2 {
  return { ...result, warnings: [...result.warnings, ...warnings] }
}

export function profileOf(task: TaskV2): TaskProfile {
  return task.profile ?? 'standard'
}

export function usesLightProofPackage(task: TaskV2) {
  return task.schema_version !== 2 && task.profile !== undefined
}

export function hasValidLegacyApproval(task: TaskV2) {
  return (
    profileOf(task) === 'standard' &&
    task.implementation_approval?.approved_plan_revision === task.plan_revision
  )
}

export function hasValidImplementationAuthorization(task: TaskV2) {
  return (
    (task.work_basis?.kind === 'implementation_authorization' &&
      task.work_basis.plan_revision === task.plan_revision) ||
    hasValidLegacyApproval(task)
  )
}

export function hasValidWorkBasis(task: TaskV2) {
  const basis = task.work_basis
  if (!basis || basis.plan_revision !== task.plan_revision) return false
  return (
    basis.kind === 'implementation_authorization' ||
    basis.work_revision === task.work_revision
  )
}

export function assertValidWorkBasis(task: TaskV2) {
  if (hasValidWorkBasis(task) || hasValidLegacyApproval(task)) return
  throw new Error('Current task does not have a valid work_basis.')
}

export function gatePlan(task: TaskV2) {
  return task.plan.verification_plan.filter((item) => item.kind === 'gate')
}

export function missingCurrentGates(task: TaskV2) {
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

export type WorkspaceLiveStatus = 'match' | 'mismatch' | 'unknown'

export type WorkspaceLiveAssessment = {
  status: WorkspaceLiveStatus
  changes: {
    task_scope_content: number
    ambient: number
    index_content: number
    delivery_state: number
    sample_limit: number
    sample: Array<{
      path: string
      scope: 'in_scope' | 'out_of_scope'
      category?: 'content' | 'index_content' | 'delivery_state'
      change: string
    }>
    truncated: boolean
  }
}

function unknownWorkspaceLiveAssessment(): WorkspaceLiveAssessment {
  return {
    status: 'unknown',
    changes: {
      task_scope_content: 0,
      ambient: 0,
      index_content: 0,
      delivery_state: 0,
      sample_limit: 8,
      sample: [],
      truncated: false,
    },
  }
}

export function currentWorkspaceLiveAssessment(
  store: TaskStoreV2,
  task: TaskV2,
): WorkspaceLiveAssessment | undefined {
  if (!task.workspace_proof) return undefined
  if (!task.plan.workspace_scope) return unknownWorkspaceLiveAssessment()
  const live = captureWorkspaceSnapshot(
    store.paths.workspaceRoot,
    task.plan.workspace_scope,
    task.artifacts,
  )
  if (!live.complete) return unknownWorkspaceLiveAssessment()
  try {
    const directory = join(store.paths.tasksDir, task.id)
    const baseline = readWorkspaceEvidence<WorkspaceSnapshot>(
      directory,
      task.workspace_proof.baseline_ref,
    )
    for (const gate of gatePlan(task)) {
      const result = task.verification.gate[gate.name]
      if (
        result?.status !== 'pass' ||
        result.work_revision !== task.work_revision ||
        result.proof?.ended_generation !== task.workspace_proof.generation
      )
        continue
      if (!result.proof)
        throw new Error(`Gate ${gate.name} has no workspace proof.`)
      readWorkspaceEvidence(directory, result.proof.before_ref)
      readWorkspaceEvidence(directory, result.proof.after_ref)
      readWorkspaceEvidence(directory, result.proof.delta_ref)
    }
    const scopeDelta = compareWorkspaceScopeContent(
      baseline,
      live,
      task.plan.workspace_scope,
    )
    const workspaceDelta = compareWorkspaceSnapshots(
      baseline,
      live,
      task.plan.workspace_scope,
    )
    const scopeContentPaths = new Set(
      scopeDelta.changes.map((change) => change.path),
    )
    const projectedChanges = workspaceDelta.changes.map((change) => ({
      ...change,
      category:
        change.scope === 'out_of_scope' || scopeContentPaths.has(change.path)
          ? change.category
          : change.category === 'index_content'
            ? 'index_content' as const
            : 'delivery_state' as const,
    }))
    const sampleLimit = 8
    return {
      status: scopeDelta.status === 'unchanged' ? 'match' : 'mismatch',
      changes: {
        task_scope_content: scopeDelta.changed_count,
        ambient: projectedChanges.filter(
          (change) => change.scope === 'out_of_scope',
        ).length,
        index_content: projectedChanges.filter(
          (change) =>
            change.scope === 'in_scope' && change.category === 'index_content',
        ).length,
        delivery_state: projectedChanges.filter(
          (change) =>
            change.scope === 'in_scope' && change.category === 'delivery_state',
        ).length,
        sample_limit: sampleLimit,
        sample: projectedChanges.slice(0, sampleLimit).map((change) => ({
          path: change.path,
          scope: change.scope,
          category: change.category,
          change: change.change,
        })),
        truncated: projectedChanges.length > sampleLimit,
      },
    }
  } catch {
    return unknownWorkspaceLiveAssessment()
  }
}

export function currentWorkspaceLiveStatus(
  store: TaskStoreV2,
  task: TaskV2,
): WorkspaceLiveStatus | undefined {
  return currentWorkspaceLiveAssessment(store, task)?.status
}

export type SubmissionProofStatus = 'missing' | 'current' | 'stale'

export function submissionProofStatus(
  task: TaskV2,
  liveStatus?: WorkspaceLiveStatus,
): SubmissionProofStatus {
  const submission = task.submission
  if (!submission) return 'missing'
  if (submission.work_revision !== task.work_revision) return 'stale'
  if (
    usesLightProofPackage(task) &&
    submission.plan_revision !== task.plan_revision
  )
    return 'stale'
  const gates = gatePlan(task)
  if (submission.no_verify) {
    return profileOf(task) === 'light' || gates.length > 0 ? 'stale' : 'current'
  }
  if (
    gates.length === 0 ||
    missingCurrentGates(task).length > 0 ||
    (task.workspace_proof?.unresolved_violations.length ?? 0) > 0 ||
    (liveStatus !== undefined && liveStatus !== 'match')
  )
    return 'stale'
  return 'current'
}

export function assertSubmissionProof(
  task: TaskV2,
  liveStatus?: WorkspaceLiveStatus,
) {
  const status = submissionProofStatus(task, liveStatus)
  if (status === 'missing')
    throw new Error('Current task does not have a submission.')
  if (status === 'stale') {
    const code =
      liveStatus === 'mismatch' ||
      (task.workspace_proof?.unresolved_violations.length ?? 0) > 0
        ? 'workspace_violation'
        : 'proof_stale'
    throw new LatchDomainError(
      code,
      'Current submission proof is stale; run reopen-review before starting a new work revision.',
    )
  }
}

export function assertSubmissionGateProof(task: TaskV2) {
  const submission = task.submission
  if (!submission) throw new Error('Current task does not have a submission.')
  const gates = gatePlan(task)
  if (submission.no_verify) {
    if (profileOf(task) === 'light')
      throw new Error('Light submit denied: --no-verify is not allowed for profile=light.')
    if (gates.length > 0)
      throw new LatchDomainError(
        'proof_stale',
        'Current no-verify submission no longer has a gate-free plan.',
      )
    return
  }
  if (gates.length === 0 || missingCurrentGates(task).length > 0)
    throw new LatchDomainError(
      'proof_stale',
      'Current submission no longer has valid gate results.',
    )
}
