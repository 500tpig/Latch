import { spawn, type ChildProcess } from 'node:child_process'

export const VERIFICATION_LOG_LIMIT_BYTES = 8192

export type VerificationOutputMode = 'inherit' | 'capture'

export type VerificationFailureLog = {
  limit_bytes_per_stream: number
  retained: 'tail'
  stdout: {
    text: string
    truncated: boolean
  }
  stderr: {
    text: string
    truncated: boolean
  }
  spawn_error?: string
}

export type VerificationCommandExecution = {
  status: number | null
  error?: Error
  failureLog?: VerificationFailureLog
}

class ByteTailBuffer {
  private value: Buffer = Buffer.alloc(0)
  private totalBytes = 0

  append(chunk: Buffer | string) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    this.totalBytes += bytes.length
    if (bytes.length >= VERIFICATION_LOG_LIMIT_BYTES) {
      this.value = bytes.subarray(bytes.length - VERIFICATION_LOG_LIMIT_BYTES)
      return
    }
    const overflow = this.value.length + bytes.length - VERIFICATION_LOG_LIMIT_BYTES
    this.value = Buffer.concat([
      overflow > 0 ? this.value.subarray(overflow) : this.value,
      bytes,
    ])
  }

  summary() {
    let start = 0
    while (
      start < this.value.length &&
      (this.value[start] & 0xc0) === 0x80
    )
      start += 1
    return {
      text: this.value.subarray(start).toString('utf8'),
      truncated: this.totalBytes > VERIFICATION_LOG_LIMIT_BYTES,
    }
  }
}

function waitForCommand(
  child: ChildProcess,
  stdout?: ByteTailBuffer,
  stderr?: ByteTailBuffer,
) {
  return new Promise<VerificationCommandExecution>((resolve) => {
    let spawnError: Error | undefined
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (status) => {
      resolve({
        status: spawnError ? null : status,
        ...(spawnError ? { error: spawnError } : {}),
        ...(stdout && stderr
          ? {
              failureLog: {
                limit_bytes_per_stream: VERIFICATION_LOG_LIMIT_BYTES,
                retained: 'tail',
                stdout: stdout.summary(),
                stderr: stderr.summary(),
                ...(spawnError ? { spawn_error: spawnError.message } : {}),
              },
            }
          : {}),
      })
    })
  })
}

export function emptyVerificationFailureLog(): VerificationFailureLog {
  return {
    limit_bytes_per_stream: VERIFICATION_LOG_LIMIT_BYTES,
    retained: 'tail',
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
  }
}

export function runVerificationCommand(
  command: string[],
  cwd: string,
  outputMode: VerificationOutputMode,
) {
  if (outputMode === 'inherit') {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      stdio: ['inherit', 2, 2],
    })
    return waitForCommand(child)
  }

  const stdout = new ByteTailBuffer()
  const stderr = new ByteTailBuffer()
  const child = spawn(command[0], command.slice(1), {
    cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk: Buffer) => stdout.append(chunk))
  child.stderr.on('data', (chunk: Buffer) => stderr.append(chunk))
  return waitForCommand(child, stdout, stderr)
}
