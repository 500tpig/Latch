import test from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import {
  projectVerificationCommand,
  runVerificationCommand,
} from '../dist/core/progress/command-output.js'

class CollectingWritable extends Writable {
  chunks = []

  constructor(delayMs = 0) {
    super({ highWaterMark: 1 })
    this.delayMs = delayMs
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk))
    if (this.delayMs > 0) setTimeout(callback, this.delayMs)
    else callback()
  }

  text() {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

function nodeCommand(source) {
  return [process.execPath, '-e', source]
}

function run(source, options = {}) {
  return runVerificationCommand(nodeCommand(source), process.cwd(), {
    outputMode: 'json',
    verbose: false,
    ...options,
  })
}

test('runner reports small mixed output and monotonic duration without splitting full streams', async () => {
  const execution = await run(
    "process.stdout.write('small stdout'); process.stderr.write('small stderr')",
  )
  const output = projectVerificationCommand(execution, 'small', 'pass')
  assert.equal(output.exit_code, 0)
  assert.equal(output.duration_ms >= 0, true)
  assert.deepEqual(output.stdout, {
    bytes: 12,
    summary: {
      limit_bytes: 4096,
      head_limit_bytes: 2048,
      tail_limit_bytes: 2048,
      head_bytes: 12,
      tail_bytes: 0,
      head: 'small stdout',
      tail: '',
      omitted_bytes: 0,
      truncated: false,
      invalid_utf8: false,
    },
  })
  assert.equal(output.stderr.bytes, 12)
  assert.equal(output.stderr.summary.head, 'small stderr')
})

test('large success output keeps fixed 2 KiB head and tail without max-buffer failure', async () => {
  const execution = await run(
    'process.stdout.write(Buffer.alloc(100000, 97)); process.stderr.write(Buffer.alloc(120000, 98))',
  )
  const output = projectVerificationCommand(execution, 'large', 'pass')
  assert.equal(output.status, 'pass')
  assert.equal(output.exit_code, 0)
  assert.equal(output.termination, undefined)
  assert.equal(output.stdout.bytes, 100000)
  assert.equal(output.stdout.summary.head, 'a'.repeat(2048))
  assert.equal(output.stdout.summary.tail, 'a'.repeat(2048))
  assert.equal(output.stdout.summary.omitted_bytes, 95904)
  assert.equal(output.stdout.summary.truncated, true)
  assert.equal(output.stderr.bytes, 120000)
  assert.equal(output.stderr.summary.head, 'b'.repeat(2048))
  assert.equal(output.stderr.summary.tail, 'b'.repeat(2048))
  assert.equal(output.stderr.summary.omitted_bytes, 115904)
})

test('failed output keeps the designed 4 KiB head and 12 KiB tail', async () => {
  const execution = await run(
    "process.stdout.write(Buffer.concat([Buffer.alloc(4096, 72), Buffer.alloc(4096, 77), Buffer.alloc(12288, 84)])); process.exit(7)",
  )
  const output = projectVerificationCommand(
    execution,
    'failed',
    'fail',
    'command_failed',
  )
  assert.equal(output.exit_code, 7)
  assert.equal(output.stdout.bytes, 20480)
  assert.equal(output.stdout.summary.limit_bytes, 16384)
  assert.equal(output.stdout.summary.head, 'H'.repeat(4096))
  assert.equal(output.stdout.summary.tail, 'T'.repeat(12288))
  assert.equal(output.stdout.summary.omitted_bytes, 4096)
  assert.equal(output.stdout.summary.truncated, true)
})

test('retained UTF-8 segments use replacement mode and flag invalid bytes or cut code points', async () => {
  const invalidExecution = await run(
    'process.stdout.write(Buffer.from([0x61, 0xff, 0x62]))',
  )
  const invalid = projectVerificationCommand(invalidExecution, 'invalid', 'pass')
  assert.equal(invalid.stdout.summary.head, 'a\uFFFDb')
  assert.equal(invalid.stdout.summary.invalid_utf8, true)

  const boundaryExecution = await run(
    "process.stdout.write(Buffer.from('界'.repeat(2000)))",
  )
  const boundary = projectVerificationCommand(boundaryExecution, 'boundary', 'pass')
  assert.equal(boundary.stdout.bytes, 6000)
  assert.equal(boundary.stdout.summary.truncated, true)
  assert.equal(boundary.stdout.summary.invalid_utf8, true)
  assert.match(boundary.stdout.summary.head, /\uFFFD$/)
})

test('verbose honors sink backpressure and routes human and JSON streams correctly', async () => {
  const humanStdout = new CollectingWritable(1)
  const humanStderr = new CollectingWritable(1)
  await run(
    "process.stdout.write('human-out'); process.stderr.write('human-err')",
    {
      outputMode: 'human',
      verbose: true,
      stdoutSink: humanStdout,
      stderrSink: humanStderr,
    },
  )
  assert.equal(humanStdout.text(), 'human-out\n')
  assert.equal(humanStderr.text(), 'human-err\n')

  const jsonStdout = new CollectingWritable(1)
  const jsonStderr = new CollectingWritable(1)
  await run(
    "process.stdout.write('json-out'); process.stderr.write('json-err')",
    {
      outputMode: 'json',
      verbose: true,
      stdoutSink: jsonStdout,
      stderrSink: jsonStderr,
    },
  )
  assert.equal(jsonStdout.text(), '')
  assert.match(jsonStderr.text(), /json-out/)
  assert.match(jsonStderr.text(), /json-err/)
  assert.equal(jsonStderr.text().endsWith('\n'), true)

  const largeStdout = new CollectingWritable()
  const largeStderr = new CollectingWritable()
  const largeExecution = await run(
    'process.stdout.write(Buffer.alloc(50000, 120)); process.stderr.write(Buffer.alloc(60000, 121))',
    {
      outputMode: 'human',
      verbose: true,
      stdoutSink: largeStdout,
      stderrSink: largeStderr,
    },
  )
  assert.equal(largeStdout.text(), `${'x'.repeat(50000)}\n`)
  assert.equal(largeStderr.text(), `${'y'.repeat(60000)}\n`)
  const largeOutput = projectVerificationCommand(largeExecution, 'large', 'pass')
  assert.equal(largeOutput.stdout.bytes, 50000)
  assert.equal(largeOutput.stderr.bytes, 60000)
})

test('spawn errors use null exit codes and bounded structured errors', async () => {
  const execution = await runVerificationCommand(
    ['latch-command-output-test-does-not-exist'],
    process.cwd(),
    { outputMode: 'json', verbose: false },
  )
  const output = projectVerificationCommand(execution, 'missing', 'fail')
  assert.equal(output.exit_code, null)
  assert.equal(output.termination, 'spawn_error')
  assert.equal(output.error.code, 'ENOENT')
  assert.match(output.error.message, /ENOENT/)
  assert.equal(Buffer.byteLength(output.error.message) <= 2048, true)
  assert.equal(output.stdout.bytes, 0)
  assert.equal(output.stderr.bytes, 0)
})

test('signals and timeouts remain command failures with null ephemeral exit codes', async () => {
  const signaledExecution = await run("process.kill(process.pid, 'SIGTERM')")
  const signaled = projectVerificationCommand(signaledExecution, 'signal', 'fail')
  assert.equal(signaled.exit_code, null)
  assert.equal(signaled.termination, 'signal')
  assert.equal(signaled.signal, 'SIGTERM')

  const timedExecution = await run(
    "process.on('SIGTERM', () => { process.stdout.write('term handled'); process.exit(0) }); setInterval(() => {}, 1000)",
    { timeoutMs: 20, terminationGraceMs: 100 },
  )
  const timed = projectVerificationCommand(timedExecution, 'timeout', 'fail')
  assert.equal(timed.exit_code, null)
  assert.equal(timed.termination, 'timeout')
  assert.equal(timed.timeout_ms, 20)
  assert.equal(timed.duration_ms >= 15, true)
})

test('timeout uses the kill grace period and terminates descendants holding pipes', async () => {
  const killedExecution = await run(
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
    { timeoutMs: 100, terminationGraceMs: 40 },
  )
  const killed = projectVerificationCommand(killedExecution, 'killed', 'fail')
  assert.equal(killed.termination, 'timeout')
  assert.equal(killed.exit_code, null)
  assert.equal(killed.signal, 'SIGKILL')
  assert.equal(killed.duration_ms >= 130, true)

  const startedAt = Date.now()
  const descendantExecution = await run(
    "const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] }); setInterval(() => {}, 1000)",
    { timeoutMs: 20, terminationGraceMs: 40 },
  )
  const descendant = projectVerificationCommand(
    descendantExecution,
    'descendant',
    'fail',
  )
  assert.equal(descendant.termination, 'timeout')
  assert.equal(descendant.exit_code, null)
  assert.equal(Date.now() - startedAt < 1000, true)
})

test('byte counter overflow is a runner error, not normal output truncation', async () => {
  const execution = await run(
    'process.stdout.write(Buffer.alloc(64, 120)); setInterval(() => {}, 1000)',
    { maxByteCount: 8, terminationGraceMs: 20 },
  )
  const output = projectVerificationCommand(execution, 'overflow', 'fail')
  assert.equal(output.exit_code, null)
  assert.equal(output.termination, 'runner_error')
  assert.equal(output.error.code, 'OUTPUT_BYTE_COUNT_OVERFLOW')
  assert.equal(output.stdout.bytes, 8)
  assert.equal(output.stdout.summary.truncated, false)
})
