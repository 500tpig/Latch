import { spawnSync } from 'node:child_process'
import {
  archiveTaskV2,
  readArchivedTaskV2,
  readTaskV2,
  updateTaskV2,
  withWorkspaceLockV2,
  worktreeOccupantV2,
} from './task-store.js'
import type { TaskStoreV2, TaskWriteResultV2 } from './task-store.js'
import { now } from './utils.js'

export type ApproveTaskV2Input = {
  expectRevision: number
  actor: string
  reason?: string
  feedback?: string
}

function requireText(value: string | undefined, message: string): string {
  if (!value?.trim()) throw new Error(message)
  return value.trim()
}

/**
 * workspace 锁只保护占用扫描和 phase 写入；updateTaskV2 在其内部再取 task 锁。
 * 若未来需要同时更新 current state，锁顺序必须继续保持 workspace -> task -> state。
 */
export function approveTaskV2(
  store: TaskStoreV2,
  id: string,
  input: ApproveTaskV2Input,
): TaskWriteResultV2 {
  return withWorkspaceLockV2(store, () => {
    const current = readTaskV2(store, id)
    if (current.blocked) throw new Error(`Task is blocked: ${current.blocked.reason}`)
    if (current.plan.open_questions.length > 0)
      throw new Error('Cannot approve while plan.open_questions is not empty.')

    const occupant = worktreeOccupantV2(store, current.id)
    if (occupant)
      throw new Error(
        `Workspace is occupied by ${occupant.id} in phase ${occupant.phase}.`,
      )

    if (current.phase === 'plan') {
      if (input.feedback) throw new Error('--feedback requires a task in review.')
      const reason = requireText(input.reason, '--reason is required in plan.')
      return updateTaskV2(store, current.id, {
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
      })
    }

    if (current.phase === 'review') {
      if (input.reason) throw new Error('--reason cannot be combined with --feedback.')
      const feedback = requireText(
        input.feedback,
        '--feedback is required for a task in review.',
      )
      if (
        current.implementation_approval?.approved_plan_revision !==
        current.plan_revision
      )
        throw new Error('Current plan does not have a valid implementation approval.')
      return updateTaskV2(store, current.id, {
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
      })
    }

    throw new Error(`Cannot approve task in phase ${current.phase}.`)
  })
}

import type { VerifyResult } from './types.js'

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
  if (
    task.implementation_approval?.approved_plan_revision !== task.plan_revision
  )
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
  const current = readTaskV2(store, id)
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
}

export function submitTaskV2(
  store: TaskStoreV2,
  id: string,
  input: SubmitTaskV2Input,
): TaskWriteResultV2 {
  const current = readTaskV2(store, id)
  assertReadyForWork(current)
  const changes = requireText(input.changes, '--changes is required.')
  if (typeof input.unverified !== 'string')
    throw new Error('--unverified is required.')
  const gatePlan = current.plan.verification_plan.filter(
    (item) => item.kind === 'gate',
  )
  let noVerifyReason: string | undefined
  if (input.noVerify) {
    if (current.phase !== 'dev')
      throw new Error('No-verify submission requires phase dev.')
    if (gatePlan.length > 0)
      throw new Error('No-verify submission requires a plan without gates.')
    noVerifyReason = requireText(input.reason, '--reason is required with --no-verify.')
  } else {
    if (input.reason) throw new Error('--reason requires --no-verify.')
    if (current.phase !== 'check')
      throw new Error('Gate submission requires phase check.')
    if (gatePlan.length === 0)
      throw new Error('Gate submission requires at least one planned gate.')
    const missing = gatePlan.filter((item) => {
      const result = current.verification.gate[item.name]
      return (
        !result ||
        result.work_revision !== current.work_revision ||
        result.status !== 'pass'
      )
    })
    if (missing.length > 0)
      throw new Error(
        `Current work revision has incomplete gates: ${missing.map((item) => item.name).join(', ')}.`,
      )
  }
  const verified = verificationSummary(current)
  return updateTaskV2(store, current.id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    events: [
      {
        type: 'submitted',
        fields: {
          work_revision: current.work_revision,
          no_verify: input.noVerify,
        },
      },
    ],
    update(task) {
      task.submission = {
        work_revision: task.work_revision,
        changes,
        verified,
        unverified: input.unverified,
        ...(noVerifyReason ? { no_verify: { reason: noVerifyReason } } : {}),
        submitted_at: now(),
      }
      task.phase = 'review'
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
  if (!submission.no_verify) {
    const gates = current.plan.verification_plan.filter((item) => item.kind === 'gate')
    if (
      gates.length === 0 ||
      gates.some((item) => {
        const result = current.verification.gate[item.name]
        return (
          !result ||
          result.work_revision !== current.work_revision ||
          result.status !== 'pass'
        )
      })
    )
      throw new Error('Current submission no longer has valid gate results.')
  }
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
