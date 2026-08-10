import {
  materializeWorkBasisV3,
  readTaskV2,
  updateTaskV2,
  updateTaskV4,
} from '../task-store.js'
import { LatchDomainError } from '../errors.js'
import type { TaskStoreV2, TaskWriteResultV2 } from '../task-store.js'
import type {
  ImplementationAuthorizationInput,
  RetrospectiveRecordInput,
  TaskProfile,
} from '../types.js'
import { assertAuthorizableTaskPlan } from '../plan-schema.js'
import { now } from '../utils.js'
import {
  assertValidWorkBasis,
  hasValidLegacyApproval,
  profileOf,
  requireText,
  sharedWorktreeWarnings,
  usesLightProofPackage,
  withWarnings,
} from './shared.js'

export type ApproveTaskV2Input = {
  expectRevision: number
  actor: string
  reason?: string
  feedback?: string
  nonImplementationFeedback?: string
  authorization?: ImplementationAuthorizationInput
  retrospective?: RetrospectiveRecordInput
}

export function approveTaskV2(
  store: TaskStoreV2,
  id: string,
  input: ApproveTaskV2Input,
): TaskWriteResultV2 {
  const current = readTaskV2(store, id)
  if (current.blocked) throw new Error(`Task is blocked: ${current.blocked.reason}`)
  if (input.authorization && input.retrospective)
    throw new Error('Authorization and retrospective inputs cannot be combined.')
  const warnings = sharedWorktreeWarnings(store, current.id)

  if (current.phase === 'plan') {
    if (input.feedback || input.nonImplementationFeedback !== undefined)
      throw new LatchDomainError(
        'phase_mismatch',
        'Review feedback requires a task in review.',
      )
    if (current.schema_version === 4 || current.schema_version === 5)
      assertAuthorizableTaskPlan(
        current.plan,
        profileOf(current),
        `task ${current.id} plan`,
      )
    else if (current.plan.open_questions.length > 0)
      throw new Error('Cannot approve while plan.open_questions is not empty.')
    const legacyStandardApproval =
      profileOf(current) === 'standard' &&
      input.reason !== undefined &&
      !input.authorization &&
      !input.retrospective
    if (usesLightProofPackage(current) && !legacyStandardApproval) {
      if (input.reason)
        throw new Error('--reason cannot replace structured work_basis input.')
      if (!input.authorization && !input.retrospective)
        throw new Error(
          'Structured approval requires --authorization-file or --retrospective-file.',
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
      if (current.schema_version !== 4 && current.schema_version !== 5)
        throw new Error(
          'Non-implementation feedback requires schema_version 4 or 5.',
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

  throw new LatchDomainError(
    'phase_mismatch',
    `Cannot approve task in phase ${current.phase}.`,
  )
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
  if (current.schema_version !== 4 && current.schema_version !== 5)
    throw new Error(
      'Profile changes require schema_version 4 or 5.',
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
