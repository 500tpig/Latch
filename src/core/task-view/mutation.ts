import { Buffer } from 'node:buffer'
import type {
  VerificationProjection,
  VerificationStreamProjection,
} from '../progress/command-output.js'
import type { UnverifiedItem } from '../types.js'
import { concise } from './shared.js'

export const MUTATION_JSON_BYTE_BUDGET = 4096
export const MUTATION_SAMPLE_LIMIT = 8

export type MutationBounded<T> = {
  total: number
  sample_limit: number
  returned_count: number
  sample: T[]
  truncated: boolean
}

export function boundedMutation<T>(
  values: readonly T[],
  sampleLimit = MUTATION_SAMPLE_LIMIT,
): MutationBounded<T> {
  const sample = values.slice(0, sampleLimit)
  return {
    total: values.length,
    sample_limit: sampleLimit,
    returned_count: sample.length,
    sample,
    truncated: values.length > sample.length,
  }
}

function compactString(value: string, limit = 256) {
  return concise(value, limit)
}

function boundedUtf8(value: string, limit: number) {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= limit) return value
  let end = limit
  while (end > 0) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end))
    } catch {
      end -= 1
    }
  }
  return ''
}

function compactVerificationStream(
  stream: VerificationStreamProjection,
): VerificationStreamProjection {
  const head = boundedUtf8(stream.summary.head, 256)
  const tail = boundedUtf8(stream.summary.tail, 256)
  const headBytes = Buffer.byteLength(head, 'utf8')
  const tailBytes = Buffer.byteLength(tail, 'utf8')
  return {
    bytes: stream.bytes,
    summary: {
      limit_bytes: 512,
      head_limit_bytes: 256,
      tail_limit_bytes: 256,
      head_bytes: headBytes,
      tail_bytes: tailBytes,
      head,
      tail,
      omitted_bytes: Math.max(0, stream.bytes - headBytes - tailBytes),
      truncated: stream.bytes > headBytes + tailBytes,
      invalid_utf8: stream.summary.invalid_utf8,
    },
  }
}

export function compactMutationStrings(
  values: readonly string[],
  sampleLimit = MUTATION_SAMPLE_LIMIT,
  itemLimit = 256,
) {
  return boundedMutation(
    values.map((value) => compactString(value, itemLimit)),
    sampleLimit,
  )
}

export function compactUnverifiedItems(
  values: readonly UnverifiedItem[],
  sampleLimit = MUTATION_SAMPLE_LIMIT,
): MutationBounded<UnverifiedItem> {
  return boundedMutation(
    values.map((item) => ({
      item_id: item.item_id,
      summary: compactString(item.summary),
    })),
    sampleLimit,
  )
}

export function compactResolvedQuestions(
  values: ReadonlyArray<{
    question: string
    answer: string
    decision: string
  }>,
  sampleLimit = MUTATION_SAMPLE_LIMIT,
) {
  return boundedMutation(
    values.map((item) => ({
      question: compactString(item.question),
      answer: compactString(item.answer),
      decision: compactString(item.decision),
    })),
    sampleLimit,
  )
}

export function compactVerification(
  output: VerificationProjection,
  includeDiagnostics = false,
) {
  const compact = {
    name: output.name,
    status: output.status,
    exit_code: output.exit_code,
    duration_ms: output.duration_ms,
    ...(output.failure_reason ? { failure_reason: output.failure_reason } : {}),
    ...(output.termination ? { termination: output.termination } : {}),
    ...(output.signal ? { signal: output.signal } : {}),
    ...(output.timeout_ms !== undefined ? { timeout_ms: output.timeout_ms } : {}),
  }
  if (!includeDiagnostics) return compact
  return {
    ...compact,
    stdout: compactVerificationStream(output.stdout),
    stderr: compactVerificationStream(output.stderr),
    ...(output.error
      ? {
          error: {
            code: output.error.code,
            message: compactString(output.error.message),
          },
        }
      : {}),
  }
}

export function compactVerifyAll(
  executions: ReadonlyArray<{
    output: VerificationProjection
    revision: number
  }>,
) {
  return boundedMutation(
    executions.map(({ output, revision }) => ({
      ...compactVerification(output),
      revision,
    })),
  )
}

export function compactFailedExecution(
  executions: ReadonlyArray<{
    output: VerificationProjection
    revision: number
  }>,
) {
  for (let index = executions.length - 1; index >= 0; index -= 1) {
    const execution = executions[index]
    if (execution.output.status !== 'fail') continue
    return {
      ...compactVerification(execution.output, true),
      revision: execution.revision,
    }
  }
  return undefined
}

function jsonBytes(value: unknown) {
  return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const protectedKeys = new Set([
  'task_id',
  'phase',
  'status',
  'kind',
  'command',
  'mode',
  'outcome',
  'termination',
  'signal',
])

function trimText(value: unknown, key: string): unknown {
  if (typeof value === 'string') {
    if (protectedKeys.has(key)) return value
    return boundedUtf8(value, 256)
  }
  if (Array.isArray(value))
    return value.map((item) => trimText(item, key))
  if (isObject(value)) {
    for (const [childKey, childValue] of Object.entries(value))
      value[childKey] = trimText(childValue, childKey)
  }
  return value
}

function shrinkCollection(value: Record<string, unknown>, key: string) {
  const current = value[key]
  if (!isObject(current) || !Array.isArray(current.sample)) return false
  const sample = current.sample
  if (sample.length === 0) return false
  const nextLength = Math.max(0, Math.floor(sample.length / 2))
  current.sample = sample.slice(0, nextLength)
  current.returned_count = nextLength
  current.truncated = true
  return true
}

/**
 * Final safety clamp for the opt-in mutation projection. Command helpers
 * already bound their own result collections; this pass handles unusually
 * long user text without changing machine tokens or the mandatory lifecycle
 * fields.
 */
export function enforceMutationBudget<T extends Record<string, unknown>>(value: T): T {
  const result = structuredClone(value)
  if (jsonBytes(result) <= MUTATION_JSON_BYTE_BUDGET) return result

  trimText(result, '')
  const collectionKeys = [
    'unverified_items',
    'warning_summary',
    'executed',
    'appended_paths',
    'resolved_questions',
    'resolved_ids',
    'remaining_ids',
    'remaining',
  ]
  let index = 0
  while (jsonBytes(result) > MUTATION_JSON_BYTE_BUDGET && index < collectionKeys.length) {
    const key = collectionKeys[index]
    if (!shrinkCollection(result, key)) index += 1
  }
  const finalBytes = jsonBytes(result)
  if (finalBytes > MUTATION_JSON_BYTE_BUDGET)
    throw new Error(
      `Mutation brief projection is ${finalBytes} UTF-8 bytes after mandatory-field clamp; budget is ${MUTATION_JSON_BYTE_BUDGET}.`,
    )
  return result
}
