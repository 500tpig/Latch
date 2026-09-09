import { Buffer } from 'node:buffer'
import { CliV2Error } from '../cli-support.js'
import {
  PlanValidationError,
  type PlanValidationIssue,
} from '../core/plan-schema.js'

export const CHECKPOINT_PLAN_ERROR_BYTE_BUDGET = 4096
export const CHECKPOINT_PLAN_ISSUE_SAMPLE_LIMIT = 8

type ProjectedPlanValidationIssue = PlanValidationIssue & {
  actual_value_truncated?: boolean
  minimal_legal_value_truncated?: boolean
}

export class CheckpointPlanInputError extends CliV2Error {
  constructor(
    message: string,
    readonly issues: PlanValidationIssue[],
  ) {
    super('invalid_arguments', message)
    this.name = 'CheckpointPlanInputError'
  }
}

export function rethrowCheckpointPlanInputError(error: unknown): never {
  if (error instanceof PlanValidationError)
    throw new CheckpointPlanInputError(error.message, error.issues)
  throw error
}

function boundedUtf8(value: string, limit: number) {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= limit) return value
  let end = limit
  while (end > 0) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(0, end),
      )
    } catch {
      end -= 1
    }
  }
  return ''
}

function jsonBytes(value: unknown) {
  return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function compactIssue(issue: PlanValidationIssue): ProjectedPlanValidationIssue {
  const projected = structuredClone(issue) as ProjectedPlanValidationIssue
  if (projected.actual_value !== undefined) {
    const bounded = boundedUtf8(projected.actual_value, 256)
    if (bounded !== projected.actual_value) {
      projected.actual_value = bounded
      projected.actual_value_truncated = true
    }
  }
  if (
    projected.minimal_legal_value !== undefined &&
    Buffer.byteLength(JSON.stringify(projected.minimal_legal_value), 'utf8') > 512
  ) {
    delete projected.minimal_legal_value
    projected.minimal_legal_value_truncated = true
  }
  return projected
}

function buildEnvelope(
  base: Record<string, unknown>,
  error: CheckpointPlanInputError,
  message: string,
  messageTruncated: boolean,
  sample: ProjectedPlanValidationIssue[],
) {
  const issueValuesTruncated = sample.some(
    (issue) =>
      issue.actual_value_truncated || issue.minimal_legal_value_truncated,
  )
  const issuesTruncated = sample.length < error.issues.length
  return {
    ...base,
    error: {
      code: error.code,
      message,
      category: 'plan_validation',
      issues: {
        total: error.issues.length,
        sample_limit: CHECKPOINT_PLAN_ISSUE_SAMPLE_LIMIT,
        returned_count: sample.length,
        sample,
        truncated: issuesTruncated,
      },
      retry: {
        command: 'checkpoint',
        input: '--plan-file',
      },
      truncated: messageTruncated || issuesTruncated || issueValuesTruncated,
      ...(messageTruncated ? { message_truncated: true } : {}),
    },
  }
}

export function checkpointPlanErrorEnvelope(
  base: Record<string, unknown>,
  error: CheckpointPlanInputError,
) {
  let message = boundedUtf8(error.message, 1024)
  let messageTruncated = message !== error.message
  const sample = error.issues
    .slice(0, CHECKPOINT_PLAN_ISSUE_SAMPLE_LIMIT)
    .map(compactIssue)
  let envelope = buildEnvelope(base, error, message, messageTruncated, sample)

  for (
    let index = sample.length - 1;
    jsonBytes(envelope) > CHECKPOINT_PLAN_ERROR_BYTE_BUDGET && index >= 0;
    index -= 1
  ) {
    if (sample[index].minimal_legal_value === undefined) continue
    delete sample[index].minimal_legal_value
    sample[index].minimal_legal_value_truncated = true
    envelope = buildEnvelope(base, error, message, messageTruncated, sample)
  }

  while (
    jsonBytes(envelope) > CHECKPOINT_PLAN_ERROR_BYTE_BUDGET &&
    sample.length > 1
  ) {
    sample.pop()
    envelope = buildEnvelope(base, error, message, messageTruncated, sample)
  }

  if (jsonBytes(envelope) > CHECKPOINT_PLAN_ERROR_BYTE_BUDGET) {
    message = boundedUtf8(message, 256)
    messageTruncated = true
    envelope = buildEnvelope(base, error, message, messageTruncated, sample)
  }

  if (jsonBytes(envelope) > CHECKPOINT_PLAN_ERROR_BYTE_BUDGET) {
    const minimalSample = sample.slice(0, 1).map((issue) => ({
      path: issue.path,
      reason: issue.reason,
      ...(issue.expected === undefined ? {} : { expected: issue.expected }),
    }))
    envelope = buildEnvelope(
      base,
      error,
      'Plan validation failed.',
      true,
      minimalSample,
    )
  }

  if (jsonBytes(envelope) > CHECKPOINT_PLAN_ERROR_BYTE_BUDGET)
    envelope = buildEnvelope(
      base,
      error,
      'Plan validation failed.',
      true,
      [],
    )

  return envelope
}
