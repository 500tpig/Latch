import {
  commonOptions,
  fail,
  json,
  parseCommand,
  positiveInteger,
  printWarnings,
  readInputFile,
} from '../cli-support.js'
import {
  approveTaskV2,
  reopenReviewTaskV3,
  verifyAllTasksV2,
  verifyTaskV2,
} from '../core/progress.js'
import { openTaskStoreV2 } from '../core/task-store.js'
import type {
  ImplementationAuthorizationInput,
  RetrospectiveRecordInput,
} from '../core/types.js'
import {
  currentWritableTask,
  mutationJson,
  requirePositionals,
} from './task-common.js'
import { commandUsage } from './usage.js'

export function runApprove(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    reason: { type: 'string' },
    feedback: { type: 'string' },
    'non-implementation-feedback': { type: 'string' },
    'authorization-file': { type: 'string' },
    'retrospective-file': { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.approve}
`)
  requirePositionals('approve', parsed.positionals, 1)
  const hasReason = parsed.values.reason !== undefined
  const hasFeedback = parsed.values.feedback !== undefined
  const hasNonImplementationFeedback =
    parsed.values['non-implementation-feedback'] !== undefined
  const hasAuthorization = parsed.values['authorization-file'] !== undefined
  const hasRetrospective = parsed.values['retrospective-file'] !== undefined

  if (hasNonImplementationFeedback &&
      (hasReason || hasFeedback || hasAuthorization || hasRetrospective))
    fail(
      'invalid_arguments',
      '--non-implementation-feedback cannot be combined with approval or implementation feedback inputs.',
    )
  if (
    hasFeedback &&
    (hasReason || hasRetrospective)
  )
    fail(
      'invalid_arguments',
      '--feedback cannot be combined with --reason or --retrospective-file.',
    )
  if (hasAuthorization && hasRetrospective)
    fail(
      'invalid_arguments',
      '--authorization-file and --retrospective-file cannot be combined.',
    )
  if (hasReason && (hasAuthorization || hasRetrospective))
    fail('invalid_arguments', '--reason cannot be combined with structured work_basis.')
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const store = openTaskStoreV2(cwd)
  currentWritableTask(store, parsed.positionals[0])
  const authorization = parsed.values['authorization-file']
    ? readInputFile<ImplementationAuthorizationInput>(
        cwd,
        parsed.values['authorization-file'],
        '--authorization-file',
      )
    : undefined
  const retrospective = parsed.values['retrospective-file']
    ? readInputFile<RetrospectiveRecordInput>(
        cwd,
        parsed.values['retrospective-file'],
        '--retrospective-file',
      )
    : undefined
  const result = approveTaskV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    reason: parsed.values.reason,
    feedback: parsed.values.feedback,
    nonImplementationFeedback: parsed.values['non-implementation-feedback'],
    authorization,
    retrospective,
  })
  if (parsed.values.json)
    return json(
      mutationJson(store, result.task, actor, result.warnings, expectRevision),
    )
  const action =
    parsed.values['non-implementation-feedback'] !== undefined
      ? 'Recorded non-implementation feedback for'
      : 'Approved'
  process.stdout.write(
    `${action} ${result.task.id}: revision ${expectRevision} -> ${result.task.revision}\n`,
  )
  printWarnings(result.warnings)
}

export function runVerify(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    name: { type: 'string' },
    diagnostic: { type: 'boolean' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.verify}\n`)
  const diagnostic = Boolean(parsed.values.diagnostic)
  requirePositionals('verify', parsed.positionals, [1, Number.MAX_SAFE_INTEGER])
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  if (!parsed.values.name) fail('invalid_arguments', '--name is required.')
  const command = parsed.positionals.slice(1)
  if (!diagnostic && command.length > 0)
    fail('invalid_arguments', 'Gate verification command comes from the approved plan.')
  const store = openTaskStoreV2(cwd)
  currentWritableTask(store, parsed.positionals[0])
  const result = verifyTaskV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    name: parsed.values.name,
    diagnostic,
    command: command.length > 0 ? command : undefined,
  })
  if (parsed.values.json)
    json({
      ...mutationJson(store, result.task, actor, result.warnings, expectRevision),
      verification: result.verification,
    })
  else {
    process.stdout.write(
      `Verified ${result.task.id} ${result.verification.name}: ${result.verification.status}\n`,
    )
    printWarnings(result.warnings)
  }
  if (result.verification.status === 'fail') process.exitCode = 1
}

export function runVerifyAll(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage['verify-all']}\n`)
  requirePositionals('verify-all', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const store = openTaskStoreV2(cwd)
  currentWritableTask(store, parsed.positionals[0])
  const result = verifyAllTasksV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
  })
  const executed = result.executions.map(({ verification, revision }) => ({
    name: verification.name,
    status: verification.status,
    revision,
    ...(verification.failure_reason
      ? { failure_reason: verification.failure_reason }
      : {}),
  }))
  if (parsed.values.json)
    json({
      ...mutationJson(store, result.task, actor, result.warnings, expectRevision),
      executed,
      failed: result.failed?.name ?? null,
      stopped_reason: result.stoppedReason ?? null,
      stopped_gate: result.stoppedGate ?? null,
      remaining: result.remaining,
      proof_generation: result.task.workspace_proof?.generation ?? null,
      unresolved_violations:
        result.task.workspace_proof?.unresolved_violations.length ?? 0,
    })
  else {
    process.stdout.write(
      executed.length === 0
        ? `No pending gates for ${result.task.id}.\n`
        : `Verified ${result.task.id}: ${executed.map((item) => `${item.name}: ${item.status}`).join('; ')}\n`,
    )
    printWarnings(result.warnings)
  }
  if (result.failed || result.stoppedReason) process.exitCode = 1
}

export function runReopenReview(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    reason: { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage['reopen-review']}\n`)
  requirePositionals('reopen-review', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  if (!parsed.values.reason?.trim())
    fail('invalid_arguments', '--reason is required.')
  const store = openTaskStoreV2(cwd)
  currentWritableTask(store, parsed.positionals[0])
  const result = reopenReviewTaskV3(store, parsed.positionals[0], {
    expectRevision,
    actor,
    reason: parsed.values.reason,
  })
  if (parsed.values.json)
    return json(
      mutationJson(store, result.task, actor, result.warnings, expectRevision),
    )
  process.stdout.write(
    `Reopened ${result.task.id} for implementation at work revision ${result.task.work_revision}.\n`,
  )
  printWarnings(result.warnings)
}
