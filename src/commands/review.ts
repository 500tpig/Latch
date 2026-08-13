import {
  assertOptionNotRepeated,
  assertSingleStdinInput,
  boundedPositiveInteger,
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
import {
  MAX_TIMEOUT_MS,
  type VerificationProjection,
  type VerificationStreamProjection,
} from '../core/progress/command-output.js'
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

function writeStreamSummary(
  label: 'stdout' | 'stderr',
  stream: VerificationStreamProjection,
) {
  const summary = stream.summary
  process.stdout.write(
    `${label}: bytes=${stream.bytes} truncated=${summary.truncated} omitted_bytes=${summary.omitted_bytes}\n`,
  )
  if (summary.head)
    process.stdout.write(`  head: ${JSON.stringify(summary.head)}\n`)
  if (summary.tail)
    process.stdout.write(`  tail: ${JSON.stringify(summary.tail)}\n`)
}

function writeVerificationResult(taskId: string, output: VerificationProjection) {
  const details = [
    `exit_code=${output.exit_code === null ? 'null' : output.exit_code}`,
    `duration_ms=${output.duration_ms}`,
    ...(output.termination ? [`termination=${output.termination}`] : []),
    ...(output.signal ? [`signal=${output.signal}`] : []),
    ...(output.timeout_ms !== undefined ? [`timeout_ms=${output.timeout_ms}`] : []),
  ]
  process.stdout.write(
    `Verified ${taskId} ${output.name}: ${output.status} (${details.join(', ')})\n`,
  )
  writeStreamSummary('stdout', output.stdout)
  writeStreamSummary('stderr', output.stderr)
  if (output.error)
    process.stdout.write(`error: ${JSON.stringify(output.error)}\n`)
}

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
  assertSingleStdinInput([
    ['--authorization-file', parsed.values['authorization-file']],
    ['--retrospective-file', parsed.values['retrospective-file']],
  ])
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

export async function runVerify(args: string[], cwd: string, actor: string) {
  assertOptionNotRepeated(args, '--timeout-ms')
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    name: { type: 'string' },
    diagnostic: { type: 'boolean' },
    verbose: { type: 'boolean' },
    'timeout-ms': { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.verify}\n`)
  const diagnostic = Boolean(parsed.values.diagnostic)
  requirePositionals('verify', parsed.positionals, [1, Number.MAX_SAFE_INTEGER])
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const timeoutMs = parsed.values['timeout-ms'] === undefined
    ? undefined
    : boundedPositiveInteger(
        parsed.values['timeout-ms'],
        '--timeout-ms',
        MAX_TIMEOUT_MS,
      )
  if (!parsed.values.name) fail('invalid_arguments', '--name is required.')
  const command = parsed.positionals.slice(1)
  if (!diagnostic && command.length > 0)
    fail('invalid_arguments', 'Gate verification command comes from the approved plan.')
  const store = openTaskStoreV2(cwd)
  currentWritableTask(store, parsed.positionals[0])
  const result = await verifyTaskV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    name: parsed.values.name,
    diagnostic,
    command: command.length > 0 ? command : undefined,
    outputMode: parsed.values.json ? 'json' : 'human',
    verbose: Boolean(parsed.values.verbose),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  })
  if (parsed.values.json)
    json({
      ...mutationJson(store, result.task, actor, result.warnings, expectRevision),
      verification: result.output,
    })
  else {
    writeVerificationResult(result.task.id, result.output)
    printWarnings(result.warnings)
  }
  if (result.verification.status === 'fail') process.exitCode = 1
}

export async function runVerifyAll(args: string[], cwd: string, actor: string) {
  assertOptionNotRepeated(args, '--timeout-ms')
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    verbose: { type: 'boolean' },
    'timeout-ms': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage['verify-all']}\n`)
  requirePositionals('verify-all', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const timeoutMs = parsed.values['timeout-ms'] === undefined
    ? undefined
    : boundedPositiveInteger(
        parsed.values['timeout-ms'],
        '--timeout-ms',
        MAX_TIMEOUT_MS,
      )
  const store = openTaskStoreV2(cwd)
  currentWritableTask(store, parsed.positionals[0])
  const result = await verifyAllTasksV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    outputMode: parsed.values.json ? 'json' : 'human',
    verbose: Boolean(parsed.values.verbose),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  })
  const executed = result.executions.map(({ output, revision }) => ({
    ...output,
    revision,
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
    for (const execution of result.executions)
      writeVerificationResult(result.task.id, execution.output)
    process.stdout.write(executed.length === 0
      ? `No pending gates for ${result.task.id}.\n`
      : `Verified ${result.task.id}: ${executed.map((item) => `${item.name}: ${item.status}`).join('; ')}\n`)
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
