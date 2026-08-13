import { spawn, type ChildProcess } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import type { Readable, Writable } from 'node:stream'

export const SUCCESS_OUTPUT_LIMIT_BYTES = 4096
export const SUCCESS_HEAD_LIMIT_BYTES = 2048
export const SUCCESS_TAIL_LIMIT_BYTES = 2048
export const FAILURE_OUTPUT_LIMIT_BYTES = 16384
export const FAILURE_HEAD_LIMIT_BYTES = 4096
export const FAILURE_TAIL_LIMIT_BYTES = 12288
export const COMMAND_ERROR_LIMIT_BYTES = 2048
export const MAX_TIMEOUT_MS = 86400000
export const TERMINATION_GRACE_MS = 2000

export type VerificationOutputMode = 'human' | 'json'

export type VerificationCommandOptions = {
  outputMode: VerificationOutputMode
  verbose: boolean
  timeoutMs?: number
  stdoutSink?: Writable
  stderrSink?: Writable
  maxByteCount?: number
  terminationGraceMs?: number
}

export type CommandTermination =
  | 'spawn_error'
  | 'signal'
  | 'timeout'
  | 'runner_error'

export type CommandError = {
  code: string | null
  message: string
}

export type StreamSummary = {
  limit_bytes: number
  head_limit_bytes: number
  tail_limit_bytes: number
  head_bytes: number
  tail_bytes: number
  head: string
  tail: string
  omitted_bytes: number
  truncated: boolean
  invalid_utf8: boolean
}

export type VerificationStreamProjection = {
  bytes: number
  summary: StreamSummary
}

export type VerificationProjection = {
  name: string
  status: 'pass' | 'fail'
  exit_code: number | null
  duration_ms: number
  stdout: VerificationStreamProjection
  stderr: VerificationStreamProjection
  failure_reason?: string
  termination?: CommandTermination | 'not_started'
  signal?: NodeJS.Signals
  timeout_ms?: number
  error?: CommandError
}

class BoundedStreamCapture {
  private head = Buffer.alloc(0)
  private tail = Buffer.alloc(0)
  private totalBytes = 0

  constructor(private readonly maxByteCount: number) {}

  append(chunk: Buffer) {
    const remaining = this.maxByteCount - this.totalBytes
    const accepted = remaining <= 0 ? Buffer.alloc(0) : chunk.subarray(0, remaining)
    this.totalBytes += accepted.length

    if (this.head.length < FAILURE_HEAD_LIMIT_BYTES) {
      const needed = FAILURE_HEAD_LIMIT_BYTES - this.head.length
      const selected = accepted.subarray(0, needed)
      if (selected.length > 0)
        this.head = Buffer.concat([this.head, selected], this.head.length + selected.length)
    }

    if (accepted.length >= FAILURE_TAIL_LIMIT_BYTES) {
      this.tail = Buffer.from(
        accepted.subarray(accepted.length - FAILURE_TAIL_LIMIT_BYTES),
      )
    } else if (accepted.length > 0) {
      const combinedLength = this.tail.length + accepted.length
      if (combinedLength <= FAILURE_TAIL_LIMIT_BYTES) {
        this.tail = Buffer.concat([this.tail, accepted], combinedLength)
      } else {
        const retained = FAILURE_TAIL_LIMIT_BYTES - accepted.length
        this.tail = Buffer.concat(
          [this.tail.subarray(this.tail.length - retained), accepted],
          FAILURE_TAIL_LIMIT_BYTES,
        )
      }
    }

    return accepted.length === chunk.length
  }

  project(status: 'pass' | 'fail'): VerificationStreamProjection {
    const limits = status === 'pass'
      ? {
          limit: SUCCESS_OUTPUT_LIMIT_BYTES,
          head: SUCCESS_HEAD_LIMIT_BYTES,
          tail: SUCCESS_TAIL_LIMIT_BYTES,
        }
      : {
          limit: FAILURE_OUTPUT_LIMIT_BYTES,
          head: FAILURE_HEAD_LIMIT_BYTES,
          tail: FAILURE_TAIL_LIMIT_BYTES,
        }

    if (this.totalBytes <= limits.limit) {
      const value = this.fullValue()
      const decoded = decodeUtf8(value)
      return {
        bytes: this.totalBytes,
        summary: {
          limit_bytes: limits.limit,
          head_limit_bytes: limits.head,
          tail_limit_bytes: limits.tail,
          head_bytes: this.totalBytes,
          tail_bytes: 0,
          head: decoded.text,
          tail: '',
          omitted_bytes: 0,
          truncated: false,
          invalid_utf8: decoded.invalid,
        },
      }
    }

    const head = this.head.subarray(0, limits.head)
    const tail = this.tail.subarray(this.tail.length - limits.tail)
    const decodedHead = decodeUtf8(head)
    const decodedTail = decodeUtf8(tail)
    const omittedBytes = this.totalBytes - head.length - tail.length
    return {
      bytes: this.totalBytes,
      summary: {
        limit_bytes: limits.limit,
        head_limit_bytes: limits.head,
        tail_limit_bytes: limits.tail,
        head_bytes: head.length,
        tail_bytes: tail.length,
        head: decodedHead.text,
        tail: decodedTail.text,
        omitted_bytes: omittedBytes,
        truncated: omittedBytes > 0,
        invalid_utf8: decodedHead.invalid || decodedTail.invalid,
      },
    }
  }

  private fullValue() {
    if (this.totalBytes <= this.head.length) return this.head.subarray(0, this.totalBytes)
    const overlap = Math.max(0, this.head.length + this.tail.length - this.totalBytes)
    return Buffer.concat(
      [this.head, this.tail.subarray(overlap)],
      this.totalBytes,
    )
  }
}

type VerificationCommandExecution = {
  exitCode: number | null
  durationMs: number
  stdout: BoundedStreamCapture
  stderr: BoundedStreamCapture
  termination?: CommandTermination
  signal?: NodeJS.Signals
  timeoutMs?: number
  error?: CommandError
}

class VerboseForwarder {
  private readonly sinks = new Map<Writable, {
    lastByte?: number
    pending: Set<Promise<void>>
  }>()

  forward(source: Readable, sink: Writable, chunk: Buffer) {
    let state = this.sinks.get(sink)
    if (!state) {
      state = { pending: new Set() }
      this.sinks.set(sink, state)
    }
    if (chunk.length > 0) state.lastByte = chunk[chunk.length - 1]
    if (sink.write(chunk)) return

    source.pause()
    const drained = new Promise<void>((resolve) => {
      sink.once('drain', () => {
        source.resume()
        resolve()
      })
    })
    state.pending.add(drained)
    void drained.finally(() => state?.pending.delete(drained))
  }

  async finish() {
    for (const state of this.sinks.values())
      await Promise.all(state.pending)
    for (const [sink, state] of this.sinks) {
      if (state.lastByte === undefined || state.lastByte === 0x0a) continue
      if (!sink.write('\n')) await new Promise<void>((resolve) => sink.once('drain', resolve))
      state.lastByte = 0x0a
    }
  }
}

function decodeUtf8(value: Buffer) {
  let invalid = false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    invalid = true
  }
  return {
    text: new TextDecoder('utf-8').decode(value),
    invalid,
  }
}

function errorCode(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (typeof error.code === 'string' || error.code === null)
  ) return error.code
  return null
}

function boundedUtf8(value: string, limit: number) {
  const bytes = Buffer.from(value)
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

function boundedError(error: unknown, fallbackCode: string | null = null): CommandError {
  const message = error instanceof Error ? error.message : String(error)
  return {
    code: errorCode(error) ?? fallbackCode,
    message: boundedUtf8(message, COMMAND_ERROR_LIMIT_BYTES),
  }
}

function sendProcessGroupSignal(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return
    throw error
  }
}

export async function runVerificationCommand(
  command: string[],
  cwd: string,
  options: VerificationCommandOptions,
): Promise<VerificationCommandExecution> {
  const maxByteCount = options.maxByteCount ?? Number.MAX_SAFE_INTEGER
  const stdout = new BoundedStreamCapture(maxByteCount)
  const stderr = new BoundedStreamCapture(maxByteCount)
  const forwarder = new VerboseForwarder()
  const startedAt = performance.now()
  let child: ChildProcess
  try {
    child = spawn(command[0], command.slice(1), {
      cwd,
      detached: true,
      stdio: ['inherit', 'pipe', 'pipe'],
    })
  } catch (error) {
    return {
      exitCode: null,
      durationMs: Math.round(performance.now() - startedAt),
      stdout,
      stderr,
      termination: 'spawn_error',
      error: boundedError(error),
    }
  }

  return new Promise<VerificationCommandExecution>((resolve) => {
    let spawnError: unknown
    let termination: 'timeout' | 'runner_error' | undefined
    let runnerError: CommandError | undefined
    let timeoutTimer: NodeJS.Timeout | undefined
    let killTimer: NodeJS.Timeout | undefined

    const terminate = (
      reason: 'timeout' | 'runner_error',
      error?: CommandError,
    ) => {
      if (termination) return
      termination = reason
      runnerError = error
      if (timeoutTimer) clearTimeout(timeoutTimer)
      try {
        sendProcessGroupSignal(child, 'SIGTERM')
      } catch (signalError) {
        termination = 'runner_error'
        runnerError = boundedError(signalError, 'PROCESS_GROUP_SIGNAL_ERROR')
      }
      killTimer = setTimeout(() => {
        try {
          sendProcessGroupSignal(child, 'SIGKILL')
        } catch (signalError) {
          termination = 'runner_error'
          runnerError = boundedError(signalError, 'PROCESS_GROUP_SIGNAL_ERROR')
        }
      }, options.terminationGraceMs ?? TERMINATION_GRACE_MS)
    }

    const consume = (
      source: Readable,
      capture: BoundedStreamCapture,
      sink: Writable,
    ) => {
      source.on('data', (chunk: Buffer) => {
        if (!capture.append(chunk))
          terminate('runner_error', {
            code: 'OUTPUT_BYTE_COUNT_OVERFLOW',
            message: 'Command output byte count exceeded the JSON safe integer limit.',
          })
        if (options.verbose) forwarder.forward(source, sink, chunk)
      })
    }

    const stdoutSink = options.stdoutSink ?? process.stdout
    const stderrSink = options.stderrSink ?? process.stderr
    consume(
      child.stdout!,
      stdout,
      options.outputMode === 'json' ? stderrSink : stdoutSink,
    )
    consume(child.stderr!, stderr, stderrSink)

    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code, signal) => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (killTimer) clearTimeout(killTimer)
      const durationMs = Math.round(performance.now() - startedAt)
      void forwarder.finish().then(() => {
        const commandTermination = spawnError
          ? 'spawn_error'
          : termination
            ? termination
            : code === null
              ? 'signal'
              : undefined
        resolve({
          exitCode: commandTermination ? null : code,
          durationMs,
          stdout,
          stderr,
          ...(commandTermination ? { termination: commandTermination } : {}),
          ...(signal ? { signal } : {}),
          ...(termination === 'timeout' && options.timeoutMs !== undefined
            ? { timeoutMs: options.timeoutMs }
            : {}),
          ...(spawnError
            ? { error: boundedError(spawnError) }
            : runnerError
              ? { error: runnerError }
              : {}),
        })
      })
    })

    if (options.timeoutMs !== undefined)
      timeoutTimer = setTimeout(() => terminate('timeout'), options.timeoutMs)
  })
}

export function projectVerificationCommand(
  execution: VerificationCommandExecution,
  name: string,
  status: 'pass' | 'fail',
  failureReason?: string,
): VerificationProjection {
  return {
    name,
    status,
    exit_code: execution.exitCode,
    duration_ms: execution.durationMs,
    stdout: execution.stdout.project(status),
    stderr: execution.stderr.project(status),
    ...(status === 'fail'
      ? { failure_reason: failureReason ?? 'command_failed' }
      : {}),
    ...(execution.termination ? { termination: execution.termination } : {}),
    ...(execution.signal ? { signal: execution.signal } : {}),
    ...(execution.timeoutMs !== undefined ? { timeout_ms: execution.timeoutMs } : {}),
    ...(execution.error ? { error: execution.error } : {}),
  }
}

export function notStartedVerificationProjection(
  name: string,
  failureReason: string,
): VerificationProjection {
  const stdout = new BoundedStreamCapture(Number.MAX_SAFE_INTEGER)
  const stderr = new BoundedStreamCapture(Number.MAX_SAFE_INTEGER)
  return {
    name,
    status: 'fail',
    failure_reason: failureReason,
    exit_code: null,
    termination: 'not_started',
    duration_ms: 0,
    stdout: stdout.project('fail'),
    stderr: stderr.project('fail'),
  }
}
