import { spawnSync } from 'node:child_process'
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
  updateTaskV3,
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
} from './types.js'
import { now } from './utils.js'

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
  return task.schema_version === 3 && task.profile !== undefined
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
        throw new Error('--reason cannot replace structured schema 3 work_basis input.')
      if (!input.authorization && !input.retrospective)
        throw new Error(
          'Schema 3 approval requires --authorization-file or --retrospective-file.',
        )
      if (input.authorization) {
        const workRevision = current.work_revision + 1
        const basis = materializeWorkBasisV3(
          input.authorization,
          current.plan_revision,
          workRevision,
        )
        return withWarnings(updateTaskV3(store, current.id, {
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
      return withWarnings(updateTaskV3(store, current.id, {
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
      throw new Error('Structured work_basis requires schema_version 3 with profile.')
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
      if (current.schema_version !== 3)
        throw new Error(
          'Non-implementation feedback requires schema_version 3; frozen v2 data was not modified.',
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
      return withWarnings(updateTaskV3(store, current.id, update), warnings)
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
      return withWarnings(updateTaskV3(store, current.id, {
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
      throw new Error('Structured authorization requires schema_version 3 with profile.')
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

function assertReadyForWork(task: ReturnType<typeof readTaskV2>) {
  if (task.blocked) throw new Error(`Task is blocked: ${task.blocked.reason}`)
  if (usesLightProofPackage(task)) return assertValidWorkBasis(task)
  if (!hasValidLegacyApproval(task))
    throw new Error('Current plan does not have a valid implementation approval.')
}

function verificationSummary(task: ReturnType<typeof readTaskV2>) {
  return Object.values(task.verification.gate)
    .filter((result) => result.work_revision === task.work_revision)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((result) => `${result.name}: ${result.status}`)
    .join('; ')
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
  const written = updateTaskV2(store, current.id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    events: [
      {
        type: 'verification_run',
        fields: {
          name,
          kind,
          status: result.status,
          exit_code: result.exit_code,
          work_revision: result.work_revision,
          ...(executed.error ? { error: executed.error.message } : {}),
        },
      },
    ],
    update(task) {
      task.verification[kind][name] = result
      if (kind === 'gate' && task.phase === 'dev') task.phase = 'check'
    },
  })
  return { ...written, verification: result }
}

export type SubmitTaskV2Input = {
  expectRevision: number
  actor: string
  changes: string
  unverified: string
  noVerify: boolean
  reason?: string
  knowledgeImpact?: KnowledgeImpact
}

export function submitTaskV2(
  store: TaskStoreV2,
  id: string,
  input: SubmitTaskV2Input,
): TaskWriteResultV2 {
  const current = readTaskV2(store, id)
  assertReadyForWork(current)
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
    const missing = missingCurrentGates(current)
    if (missing.length > 0)
      throw new Error(
        `Current work revision has incomplete gates: ${missing.map((item) => item.name).join(', ')}.`,
      )
  }
  if (usesLightProofPackage(current)) {
    if (!input.knowledgeImpact)
      throw new Error('--knowledge-impact-file is required for schema 3 submission.')
    assertKnowledgeImpact(input.knowledgeImpact, current.artifacts, 'submit input')
  } else if (input.knowledgeImpact) {
    throw new Error(
      'Knowledge impact requires schema_version 3; frozen v2 data was not modified.',
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
    ...untrackedWorktreeWarnings(store.paths.workspaceRoot),
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
  if (current.schema_version !== 3)
    throw new Error(
      'Profile changes require schema_version 3; frozen v2 data was not modified.',
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
  return updateTaskV3(store, current.id, {
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
      'Submission patch requires a schema 3 profile; frozen v2 data was not modified.',
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

  return updateTaskV3(store, current.id, {
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
