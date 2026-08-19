import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  openTaskStoreV2,
  readTaskV2,
} from '../dist/core/task-store.js'

const cli = join(process.cwd(), 'dist/cli.js')
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-v2-review-'))
  spawnSync('git', ['init'], { cwd: directory, encoding: 'utf8' })
  temporaryDirectories.push(directory)
  return directory
}

function run(cwd, args, actor = 'codex:session:review') {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LATCH_ACTOR: actor },
  })
}

function plan(overrides = {}) {
  return {
    goal: '完成 review 流程',
    workspace_scope: { paths: ['src/cli.ts'] },
    scope: ['src/cli.ts'],
    acceptance: ['tests pass'],
    approach: ['执行 plan argv'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['approve -> verify -> submit -> done'],
    out_of_scope: ['Slice 5'],
    verification_plan: [
      {
        name: 'first',
        command: [process.execPath, '-e', 'process.exit(0)'],
        kind: 'gate',
      },
      {
        name: 'second',
        command: [process.execPath, '-e', 'process.exit(0)'],
        kind: 'gate',
      },
    ],
    open_questions: [],
    ...overrides,
  }
}

function writePlan(cwd, value = plan()) {
  const name = `plan-${Math.random()}.json`
  const path = join('.latch', name)
  writeFileSync(join(cwd, path), `${JSON.stringify(value, null, 2)}\n`)
  return path
}

function init(cwd) {
  const result = run(cwd, ['init'])
  assert.equal(result.status, 0, result.stderr)
}

function checkpoint(cwd, value = plan(), title = 'review task') {
  const result = run(cwd, [
    'checkpoint', title, '--plan-file', writePlan(cwd, value), '--json',
  ])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout).task_id
}

function taskPath(cwd, id) {
  return join(cwd, '.latch', 'tasks', id, 'task.json')
}

function eventsPath(cwd, id) {
  return join(cwd, '.latch', 'tasks', id, 'events.jsonl')
}

function readTask(cwd, id) {
  return JSON.parse(readFileSync(taskPath(cwd, id), 'utf8'))
}

function revision(cwd, id) {
  return String(readTask(cwd, id).revision)
}

function approve(cwd, id) {
  const result = run(cwd, [
    'approve', id, '--expect-revision', revision(cwd, id),
    '--reason', '用户批准', '--json',
  ])
  assert.equal(result.status, 0, result.stderr)
}

function verify(cwd, id, name, extra = []) {
  const separator = extra.indexOf('--')
  const options = separator === -1 ? extra : extra.slice(0, separator)
  const command = separator === -1 ? [] : extra.slice(separator)
  return run(cwd, [
    'verify', id, '--expect-revision', revision(cwd, id), '--name', name,
    ...options, '--json', ...command,
  ])
}

function submit(cwd, id, extra = []) {
  const impactFile = `impact-${Math.random()}.json`
  const impactPath = join('.latch', impactFile)
  writeFileSync(join(cwd, impactPath), `${JSON.stringify({
    kind: 'none',
    reason: 'Review lifecycle fixture does not change module contracts.',
  })}\n`)
  return run(cwd, [
    'submit', id, '--expect-revision', revision(cwd, id),
    '--changes', '实现完成', '--unverified', '未做浏览器验收',
    '--knowledge-impact-file', impactPath, ...extra, '--json',
  ])
}

function writeCloseout(cwd, resolutions) {
  const path = join('.latch', `closeout-${Math.random()}.json`)
  writeFileSync(join(cwd, path), `${JSON.stringify({ resolutions }, null, 2)}\n`)
  return path
}

function archivedTask(cwd, id) {
  for (const month of readdirSync(join(cwd, '.latch', 'archive')))
    try {
      return JSON.parse(
        readFileSync(join(cwd, '.latch', 'archive', month, id, 'task.json'), 'utf8'),
      )
    } catch {}
  throw new Error(`Archived task not found: ${id}`)
}

function openTaskFiles(cwd, id) {
  return {
    task: readFileSync(taskPath(cwd, id), 'utf8'),
    events: readFileSync(eventsPath(cwd, id), 'utf8'),
    state: readFileSync(join(cwd, '.latch', 'state.json'), 'utf8'),
  }
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('approve without an action returns phase-aware retry details without writes', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [] }), 'approve input')

  function denied(acceptedInputs) {
    const before = openTaskFiles(cwd, id)
    const result = run(cwd, [
      'approve', id, '--expect-revision', revision(cwd, id), '--json',
    ])
    assert.notEqual(result.status, 0)
    const error = JSON.parse(result.stderr).error
    assert.equal(error.code, 'invalid_arguments')
    assert.equal(error.category, 'approval_input')
    assert.deepEqual(error.accepted_inputs, acceptedInputs)
    assert.deepEqual(error.retry, { command: 'approve' })
    assert.deepEqual(openTaskFiles(cwd, id), before)
  }

  denied(['--reason', '--authorization-file', '--retrospective-file'])
  approve(cwd, id)
  const submitted = submit(cwd, id, ['--no-verify', '--reason', 'fixture'])
  assert.equal(submitted.status, 0, submitted.stderr)
  denied(['--feedback', '--non-implementation-feedback'])
})

test('multiple named gates are independent and submit requires all current passes', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd)
  approve(cwd, id)

  const first = verify(cwd, id, 'first')
  assert.equal(first.status, 0, first.stderr)
  assert.equal(readTask(cwd, id).phase, 'check')
  const incomplete = submit(cwd, id)
  assert.notEqual(incomplete.status, 0)
  assert.match(incomplete.stderr, /incomplete gates: second/)

  const second = verify(cwd, id, 'second')
  assert.equal(second.status, 0, second.stderr)
  const submitted = submit(cwd, id)
  assert.equal(submitted.status, 0, submitted.stderr)
  const task = readTask(cwd, id)
  assert.equal(task.phase, 'review')
  assert.equal(task.submission.work_revision, 1)
  assert.equal(task.submission.verified, 'first: pass; second: pass')
})

test('verify-all skips current passes, stops on failure, and preserves per-gate revisions', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({
    verification_plan: [
      { name: 'first', command: [process.execPath, '-e', 'process.exit(0)'], kind: 'gate' },
      {
        name: 'second',
        command: [
          process.execPath,
          '-e',
          "process.stdout.write('second stdout'); process.stderr.write('second stderr'); process.exit(1)",
        ],
        kind: 'gate',
      },
      { name: 'third', command: [process.execPath, '-e', 'process.exit(0)'], kind: 'gate' },
      { name: 'diagnostic', command: [process.execPath, '-e', 'process.exit(1)'], kind: 'diagnostic' },
    ],
  }))
  approve(cwd, id)
  assert.equal(verify(cwd, id, 'first').status, 0)

  const failed = run(cwd, [
    'verify-all', id, '--expect-revision', revision(cwd, id), '--json',
  ])
  assert.notEqual(failed.status, 0)
  const failedEnvelope = JSON.parse(failed.stdout)
  assert.equal(failedEnvelope.schema_version, 3)
  assert.equal('envelope_schema_version' in failedEnvelope, false)
  assert.equal(failedEnvelope.executed.length, 1)
  assert.equal(failedEnvelope.executed[0].name, 'second')
  assert.equal(failedEnvelope.executed[0].status, 'fail')
  assert.equal(failedEnvelope.executed[0].revision, 4)
  assert.equal(failedEnvelope.executed[0].failure_reason, 'command_failed')
  assert.equal(failedEnvelope.executed[0].exit_code, 1)
  assert.equal(failedEnvelope.executed[0].stdout.bytes, 13)
  assert.equal(failedEnvelope.executed[0].stdout.summary.head, 'second stdout')
  assert.equal(failedEnvelope.executed[0].stderr.bytes, 13)
  assert.equal(failedEnvelope.executed[0].stderr.summary.head, 'second stderr')
  assert.equal(failedEnvelope.executed[0].duration_ms >= 0, true)
  assert.equal(failedEnvelope.failed, 'second')
  assert.equal(failedEnvelope.revision, 4)
  assert.equal('failure_log' in failedEnvelope, false)
  assert.equal('log_ref' in failedEnvelope, false)
  assert.equal(failed.stderr, '')
  assert.equal(readTask(cwd, id).verification.gate.third, undefined)
  assert.equal(readTask(cwd, id).verification.diagnostic.diagnostic, undefined)

  const task = readTask(cwd, id)
  task.plan.verification_plan[1].command = [process.execPath, '-e', 'process.exit(0)']
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(task, null, 2)}\n`)
  const passed = run(cwd, [
    'verify-all', id, '--expect-revision', '4', '--json',
  ])
  assert.equal(passed.status, 0, passed.stderr)
  const passedEnvelope = JSON.parse(passed.stdout)
  assert.deepEqual(
    passedEnvelope.executed.map(({ name, status, revision }) => ({ name, status, revision })),
    [
      { name: 'second', status: 'pass', revision: 5 },
      { name: 'third', status: 'pass', revision: 6 },
    ],
  )
  assert.equal(passedEnvelope.failed, null)

  const before = readFileSync(taskPath(cwd, id), 'utf8')
  const noOp = run(cwd, [
    'verify-all', id, '--expect-revision', '6', '--json',
  ])
  assert.equal(noOp.status, 0, noOp.stderr)
  assert.deepEqual(JSON.parse(noOp.stdout).executed, [])
  assert.equal(JSON.parse(noOp.stdout).revision, 6)
  assert.equal(readFileSync(taskPath(cwd, id), 'utf8'), before)
})

test('verify JSON keeps gate stdout and stderr out of the JSON protocol stream', () => {
  const noisyCommand = [
    process.execPath,
    '-e',
    "process.stdout.write('gate stdout'.repeat(2000)); process.stderr.write('gate stderr'.repeat(2000))",
  ]

  const verifyRoot = temporaryDirectory()
  init(verifyRoot)
  const verifyId = checkpoint(verifyRoot, plan({
    verification_plan: [
      { name: 'noisy', command: noisyCommand, kind: 'gate' },
    ],
  }))
  approve(verifyRoot, verifyId)
  const verified = verify(verifyRoot, verifyId, 'noisy')
  assert.equal(verified.status, 0, verified.stderr)
  const verifiedEnvelope = JSON.parse(verified.stdout)
  assert.equal(verifiedEnvelope.schema_version, 3)
  assert.equal('envelope_schema_version' in verifiedEnvelope, false)
  assert.equal(verifiedEnvelope.verification.status, 'pass')
  assert.equal(verifiedEnvelope.verification.stdout.bytes, 22000)
  assert.equal(verifiedEnvelope.verification.stderr.bytes, 22000)
  assert.equal(verifiedEnvelope.verification.stdout.summary.limit_bytes, 4096)
  assert.equal(verifiedEnvelope.verification.stdout.summary.truncated, true)
  assert.equal('failure_log' in verifiedEnvelope, false)
  assert.equal('log_ref' in verifiedEnvelope, false)
  assert.equal(verified.stdout.trimStart().startsWith('{'), true)
  assert.equal(verified.stdout.trimEnd().endsWith('}'), true)
  assert.equal(verified.stderr, '')

  const verifyAllRoot = temporaryDirectory()
  init(verifyAllRoot)
  const verifyAllId = checkpoint(verifyAllRoot, plan({
    verification_plan: [
      { name: 'noisy', command: noisyCommand, kind: 'gate' },
    ],
  }))
  approve(verifyAllRoot, verifyAllId)
  const verifiedAll = run(verifyAllRoot, [
    'verify-all', verifyAllId, '--expect-revision', revision(verifyAllRoot, verifyAllId), '--json',
  ])
  assert.equal(verifiedAll.status, 0, verifiedAll.stderr)
  const verifiedAllEnvelope = JSON.parse(verifiedAll.stdout)
  assert.deepEqual(
    verifiedAllEnvelope.executed.map(({ name, status, revision }) => ({ name, status, revision })),
    [{ name: 'noisy', status: 'pass', revision: 3 }],
  )
  assert.equal(verifiedAllEnvelope.executed[0].stdout.bytes, 22000)
  assert.equal(verifiedAllEnvelope.executed[0].stderr.bytes, 22000)
  assert.equal('failure_log' in verifiedAllEnvelope, false)
  assert.equal(verifiedAll.stdout.trimStart().startsWith('{'), true)
  assert.equal(verifiedAll.stdout.trimEnd().endsWith('}'), true)
  assert.equal(verifiedAll.stderr, '')
})

test('JSON verbose forwards both gate streams only to stderr and keeps one stdout document', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({
    verification_plan: [{
      name: 'noisy',
      command: [
        process.execPath,
        '-e',
        "process.stdout.write('json verbose stdout'); process.stderr.write('json verbose stderr')",
      ],
      kind: 'gate',
    }],
  }))
  approve(cwd, id)

  const result = verify(cwd, id, 'noisy', ['--verbose'])
  assert.equal(result.status, 0, result.stderr)
  const envelope = JSON.parse(result.stdout)
  assert.equal(envelope.verification.status, 'pass')
  assert.equal(envelope.verification.stdout.summary.head, 'json verbose stdout')
  assert.equal(envelope.verification.stderr.summary.head, 'json verbose stderr')
  assert.equal(result.stdout.trimStart().startsWith('{'), true)
  assert.equal(result.stdout.trimEnd().endsWith('}'), true)
  assert.match(result.stderr, /json verbose stdout/)
  assert.match(result.stderr, /json verbose stderr/)
  assert.equal(result.stderr.endsWith('\n'), true)
})

test('verify timeout arguments fail before task or evidence mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [plan().verification_plan[0]] }))
  approve(cwd, id)
  const beforeTask = readFileSync(taskPath(cwd, id), 'utf8')
  const beforeEvents = readFileSync(eventsPath(cwd, id), 'utf8')

  const attempts = [
    ['--timeout-ms', '0'],
    ['--timeout-ms=-1'],
    ['--timeout-ms', '1.5'],
    ['--timeout-ms', '86400001'],
    ['--timeout-ms', '9007199254740992'],
    ['--timeout-ms', '1', '--timeout-ms', '2'],
  ]
  for (const extra of attempts) {
    const result = run(cwd, [
      'verify', id, '--expect-revision', revision(cwd, id), '--name', 'first',
      ...extra, '--json',
    ])
    assert.notEqual(result.status, 0)
    assert.equal(JSON.parse(result.stderr).error.code, 'invalid_arguments')
    assert.equal(result.stdout, '')
    assert.equal(readFileSync(taskPath(cwd, id), 'utf8'), beforeTask)
    assert.equal(readFileSync(eventsPath(cwd, id), 'utf8'), beforeEvents)
  }
})

test('verify accepts timeout boundaries and timeout cannot turn into a pass', () => {
  const maxRoot = temporaryDirectory()
  init(maxRoot)
  const maxId = checkpoint(maxRoot, plan({
    verification_plan: [{
      name: 'quick',
      command: [process.execPath, '-e', "process.stdout.write('quick')"],
      kind: 'gate',
    }],
  }))
  approve(maxRoot, maxId)
  const maximum = run(maxRoot, [
    'verify', maxId, '--expect-revision', revision(maxRoot, maxId),
    '--name', 'quick', '--timeout-ms', '86400000', '--json',
  ])
  assert.equal(maximum.status, 0, maximum.stderr)
  assert.equal(JSON.parse(maximum.stdout).verification.status, 'pass')

  const minRoot = temporaryDirectory()
  init(minRoot)
  const minId = checkpoint(minRoot, plan({
    verification_plan: [{
      name: 'slow',
      command: [
        process.execPath,
        '-e',
        "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)",
      ],
      kind: 'gate',
    }],
  }))
  approve(minRoot, minId)
  const minimum = run(minRoot, [
    'verify', minId, '--expect-revision', revision(minRoot, minId),
    '--name', 'slow', '--timeout-ms', '1', '--json',
  ])
  assert.notEqual(minimum.status, 0)
  const output = JSON.parse(minimum.stdout).verification
  assert.equal(output.status, 'fail')
  assert.equal(output.failure_reason, 'command_failed')
  assert.equal(output.exit_code, null)
  assert.equal(output.termination, 'timeout')
  assert.equal(output.timeout_ms, 1)
})

test('non-JSON verify defaults to escaped bounded summaries and verbose forwards full streams', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({
    verification_plan: [{
      name: 'noisy',
      command: [
        process.execPath,
        '-e',
        "process.stdout.write('human stdout\\n'); process.stderr.write('human stderr\\n')",
      ],
      kind: 'gate',
    }],
  }))
  approve(cwd, id)

  const result = run(cwd, [
    'verify', id, '--expect-revision', revision(cwd, id), '--name', 'noisy',
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Verified .* noisy: pass/)
  assert.match(result.stdout, /stdout: bytes=13 truncated=false omitted_bytes=0/)
  assert.match(result.stdout, /head: "human stdout\\n"/)
  assert.match(result.stdout, /stderr: bytes=13 truncated=false omitted_bytes=0/)
  assert.match(result.stdout, /head: "human stderr\\n"/)
  assert.equal(result.stderr, '')

  const verbose = run(cwd, [
    'verify', id, '--expect-revision', revision(cwd, id), '--name', 'noisy',
    '--verbose',
  ])
  assert.equal(verbose.status, 0, verbose.stderr)
  assert.match(verbose.stdout, /^human stdout\nVerified /)
  assert.match(verbose.stderr, /^human stderr\n$/)
  assert.match(verbose.stdout, /stdout: bytes=13 truncated=false omitted_bytes=0/)
})

test('non-JSON verify-all defaults to bounded per-gate summaries and supports verbose', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({
    verification_plan: [{
      name: 'noisy',
      command: [
        process.execPath,
        '-e',
        "process.stdout.write('all stdout\\n'); process.stderr.write('all stderr\\n')",
      ],
      kind: 'gate',
    }],
  }))
  approve(cwd, id)

  const result = run(cwd, [
    'verify-all', id, '--expect-revision', revision(cwd, id),
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Verified .* noisy: pass/)
  assert.match(result.stdout, /head: "all stdout\\n"/)
  assert.match(result.stdout, /head: "all stderr\\n"/)
  assert.equal(result.stderr, '')

  const verboseRoot = temporaryDirectory()
  init(verboseRoot)
  const verboseId = checkpoint(verboseRoot, plan({
    verification_plan: [{
      name: 'noisy',
      command: [
        process.execPath,
        '-e',
        "process.stdout.write('all stdout'); process.stderr.write('all stderr')",
      ],
      kind: 'gate',
    }],
  }))
  approve(verboseRoot, verboseId)
  const verbose = run(verboseRoot, [
    'verify-all', verboseId, '--expect-revision', revision(verboseRoot, verboseId),
    '--verbose',
  ])
  assert.equal(verbose.status, 0, verbose.stderr)
  assert.match(verbose.stdout, /^all stdout\nVerified /)
  assert.match(verbose.stderr, /^all stderr\n$/)
})

test('verify JSON returns bounded failure head and tail per stream', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({
    verification_plan: [
      {
        name: 'stdout-only',
        command: [
          process.execPath,
          '-e',
          "process.stdout.write('stdout only'); process.exit(2)",
        ],
        kind: 'gate',
      },
      {
        name: 'stderr-only',
        command: [
          process.execPath,
          '-e',
          "process.stderr.write('stderr only'); process.exit(3)",
        ],
        kind: 'gate',
      },
      {
        name: 'boundary',
        command: [
          process.execPath,
          '-e',
          "process.stdout.write('x'.repeat(8192)); process.stderr.write('discard' + 'y'.repeat(8192)); process.exit(4)",
        ],
        kind: 'gate',
      },
      {
        name: 'utf8-tail',
        command: [
          process.execPath,
          '-e',
          "process.stdout.write('界'.repeat(2732)); process.exit(5)",
        ],
        kind: 'gate',
      },
    ],
  }))
  approve(cwd, id)

  const stdoutOnly = verify(cwd, id, 'stdout-only')
  assert.notEqual(stdoutOnly.status, 0)
  let output = JSON.parse(stdoutOnly.stdout).verification
  assert.equal(output.stdout.bytes, 11)
  assert.equal(output.stdout.summary.head, 'stdout only')
  assert.equal(output.stderr.bytes, 0)
  assert.equal(output.exit_code, 2)
  assert.equal(stdoutOnly.stderr, '')

  const stderrOnly = verify(cwd, id, 'stderr-only')
  assert.notEqual(stderrOnly.status, 0)
  output = JSON.parse(stderrOnly.stdout).verification
  assert.equal(output.stdout.bytes, 0)
  assert.equal(output.stderr.bytes, 11)
  assert.equal(output.stderr.summary.head, 'stderr only')
  assert.equal(output.exit_code, 3)
  assert.equal(stderrOnly.stderr, '')

  const boundary = verify(cwd, id, 'boundary')
  assert.notEqual(boundary.status, 0)
  output = JSON.parse(boundary.stdout).verification
  assert.equal(output.stdout.bytes, 8192)
  assert.equal(output.stdout.summary.head, 'x'.repeat(8192))
  assert.equal(output.stdout.summary.truncated, false)
  assert.equal(output.stderr.bytes, 8199)
  assert.equal(output.stderr.summary.head, `discard${'y'.repeat(8192)}`)
  assert.equal(output.stderr.summary.truncated, false)
  assert.equal(boundary.stderr, '')

  const utf8Tail = verify(cwd, id, 'utf8-tail')
  assert.notEqual(utf8Tail.status, 0)
  const utf8Output = JSON.parse(utf8Tail.stdout).verification.stdout
  assert.equal(utf8Output.bytes, 8196)
  assert.equal(utf8Output.summary.truncated, false)
  assert.equal(utf8Output.summary.head.includes('\uFFFD'), false)
  assert.equal(utf8Tail.stderr, '')
  assert.equal(readFileSync(taskPath(cwd, id), 'utf8').includes('failure_log'), false)
  assert.equal(readFileSync(eventsPath(cwd, id), 'utf8').includes('failure_log'), false)
  assert.equal(readFileSync(taskPath(cwd, id), 'utf8').includes('duration_ms'), false)
  assert.equal(readFileSync(eventsPath(cwd, id), 'utf8').includes('duration_ms'), false)
  const evidenceDirectory = join(cwd, '.latch', 'tasks', id, 'evidence')
  const evidence = readdirSync(evidenceDirectory)
    .map((name) => readFileSync(join(evidenceDirectory, name), 'utf8'))
    .join('\n')
  assert.doesNotMatch(evidence, /failure_log|duration_ms|log_ref|stdout only|stderr only/)
  assert.deepEqual(readdirSync(join(cwd, '.latch', 'archive')), [])
  assert.equal(
    readdirSync(join(cwd, '.latch'), { recursive: true })
      .some((path) => /(^|\/)logs?(\/|$)/.test(String(path))),
    false,
  )
})

test('same gate rerun replaces its current result and a failure blocks submit', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({
    verification_plan: [
      { name: 'gate', command: [process.execPath, '-e', 'process.exit(1)'], kind: 'gate' },
    ],
  }))
  approve(cwd, id)
  const failed = verify(cwd, id, 'gate')
  assert.notEqual(failed.status, 0)
  assert.equal(readTask(cwd, id).verification.gate.gate.status, 'fail')
  assert.notEqual(submit(cwd, id).status, 0)

  const task = readTask(cwd, id)
  task.plan.verification_plan[0].command = [process.execPath, '-e', 'process.exit(0)']
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(task, null, 2)}\n`)
  const passed = verify(cwd, id, 'gate')
  assert.equal(passed.status, 0, passed.stderr)
  assert.equal(readTask(cwd, id).verification.gate.gate.status, 'pass')
})

test('diagnostic failure is recorded without moving dev to check or blocking submit', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd)
  approve(cwd, id)
  const diagnostic = verify(cwd, id, 'exploratory', [
    '--diagnostic', '--', process.execPath, '-e', 'process.exit(3)',
  ])
  assert.notEqual(diagnostic.status, 0)
  let task = readTask(cwd, id)
  assert.equal(task.phase, 'dev')
  assert.equal(task.verification.diagnostic.exploratory.exit_code, 3)

  assert.equal(verify(cwd, id, 'first').status, 0)
  assert.equal(verify(cwd, id, 'second').status, 0)
  assert.equal(submit(cwd, id).status, 0)
})

test('verify and verify-all keep command-not-found diagnostics bounded', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({
    verification_plan: [
      { name: 'missing', command: ['latch-v2-command-that-does-not-exist'], kind: 'gate' },
    ],
  }))
  approve(cwd, id)
  const override = verify(cwd, id, 'missing', ['--', process.execPath, '-e', 'process.exit(0)'])
  assert.notEqual(override.status, 0)
  assert.match(override.stderr, /approved plan/)

  const missing = verify(cwd, id, 'missing')
  assert.notEqual(missing.status, 0)
  const missingEnvelope = JSON.parse(missing.stdout)
  assert.equal(missingEnvelope.verification.stdout.bytes, 0)
  assert.equal(missingEnvelope.verification.stderr.bytes, 0)
  assert.equal(missingEnvelope.verification.exit_code, null)
  assert.equal(missingEnvelope.verification.termination, 'spawn_error')
  assert.equal(missingEnvelope.verification.error.code, 'ENOENT')
  assert.match(missingEnvelope.verification.error.message, /ENOENT/)
  assert.equal(missing.stderr, '')
  const task = readTask(cwd, id)
  assert.equal(task.phase, 'check')
  assert.equal(task.verification.gate.missing.status, 'fail')
  assert.equal(task.verification.gate.missing.exit_code, 127)
  assert.match(readFileSync(eventsPath(cwd, id), 'utf8'), /ENOENT/)

  const allRoot = temporaryDirectory()
  init(allRoot)
  const allId = checkpoint(allRoot, plan({
    verification_plan: [{
      name: 'missing',
      command: ['latch-v2-command-that-does-not-exist'],
      kind: 'gate',
    }],
  }))
  approve(allRoot, allId)
  const missingAll = run(allRoot, [
    'verify-all', allId, '--expect-revision', revision(allRoot, allId), '--json',
  ])
  assert.notEqual(missingAll.status, 0)
  const missingAllEnvelope = JSON.parse(missingAll.stdout)
  assert.equal(missingAllEnvelope.failed, 'missing')
  assert.equal(missingAllEnvelope.executed[0].termination, 'spawn_error')
  assert.equal(missingAllEnvelope.executed[0].error.code, 'ENOENT')
  assert.equal(missingAll.stderr, '')
})

test('work revision change makes prior gates and submission stale', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [plan().verification_plan[0]] }))
  approve(cwd, id)
  assert.equal(verify(cwd, id, 'first').status, 0)
  assert.equal(submit(cwd, id).status, 0)
  const correction = run(cwd, [
    'approve', id, '--expect-revision', revision(cwd, id),
    '--feedback', '修正实现', '--json',
  ])
  assert.equal(correction.status, 0, correction.stderr)
  assert.equal(readTask(cwd, id).work_revision, 2)
  const stale = run(cwd, [
    'submit', id, '--expect-revision', revision(cwd, id),
    '--changes', 'second', '--json',
  ])
  assert.notEqual(stale.status, 0)
})

test('non-implementation correction preserves review proof and submission', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [plan().verification_plan[0]] }))
  approve(cwd, id)
  assert.equal(verify(cwd, id, 'first').status, 0)
  assert.equal(submit(cwd, id).status, 0)
  const before = readTask(cwd, id)
  const correction = run(cwd, [
    'approve', id, '--expect-revision', revision(cwd, id),
    '--non-implementation-feedback', '修正文档表述，代码未变', '--json',
  ])
  assert.equal(correction.status, 0, correction.stderr)
  const after = readTask(cwd, id)
  assert.equal(after.phase, 'review')
  assert.equal(after.work_revision, before.work_revision)
  assert.deepEqual(after.verification, before.verification)
  assert.deepEqual(after.submission, before.submission)
  const events = readFileSync(eventsPath(cwd, id), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const feedback = events.findLast((event) => event.type === 'review_feedback')
  assert.equal(feedback.classification, 'non_implementation_correction')
  assert.equal(feedback.work_revision, before.work_revision)

  const human = run(cwd, [
    'approve', id, '--expect-revision', revision(cwd, id),
    '--non-implementation-feedback', '再次修正文案',
  ])
  assert.equal(human.status, 0, human.stderr)
  assert.match(human.stdout, /Recorded non-implementation feedback/)
  assert.doesNotMatch(human.stdout, /Approved/)
})

test('stale review exposes reopen recovery and starts a new auditable work revision', () => {
  const cwd = temporaryDirectory()
  mkdirSync(join(cwd, 'src'), { recursive: true })
  writeFileSync(join(cwd, 'src', 'cli.ts'), 'baseline\n')
  init(cwd)
  const id = checkpoint(cwd)
  approve(cwd, id)
  assert.equal(verify(cwd, id, 'first').status, 0)
  assert.equal(verify(cwd, id, 'second').status, 0)
  assert.equal(submit(cwd, id).status, 0)

  const currentStatus = JSON.parse(
    run(cwd, ['context', id, '--json', '--status']).stdout,
  ).task
  assert.deepEqual(currentStatus.next_action, {
    kind: 'await_user',
    boundary: 'closeout',
    reason: 'unverified_items',
  })

  writeFileSync(join(cwd, 'outside.txt'), 'ambient after submit\n')
  const ambientStatus = JSON.parse(
    run(cwd, ['context', id, '--json', '--status']).stdout,
  ).task
  assert.equal(ambientStatus.workspace_proof.live_status, 'match')
  assert.equal(ambientStatus.workspace_proof.live_changes.ambient, 1)
  assert.equal(ambientStatus.workspace_proof.live_changes.task_scope_content, 0)
  assert.deepEqual(ambientStatus.next_action, currentStatus.next_action)

  spawnSync('git', ['add', 'src/cli.ts'], { cwd, encoding: 'utf8' })
  const delivered = spawnSync(
    'git',
    [
      '-c', 'user.name=Latch Test',
      '-c', 'user.email=latch@example.com',
      'commit', '-m', 'deliver scoped content',
    ],
    { cwd, encoding: 'utf8' },
  )
  assert.equal(delivered.status, 0, delivered.stderr)
  const deliveryStatus = JSON.parse(
    run(cwd, ['context', id, '--json', '--status']).stdout,
  ).task
  assert.equal(deliveryStatus.workspace_proof.live_status, 'match')
  assert.equal(deliveryStatus.workspace_proof.live_changes.ambient, 1)
  assert.equal(deliveryStatus.workspace_proof.live_changes.delivery_state, 1)
  assert.deepEqual(deliveryStatus.next_action, currentStatus.next_action)

  writeFileSync(join(cwd, 'src', 'cli.ts'), 'changed after submit\n')
  const staleStatus = JSON.parse(
    run(cwd, ['context', id, '--json', '--status']).stdout,
  ).task
  assert.equal(staleStatus.workspace_proof.live_status, 'mismatch')
  assert.deepEqual(staleStatus.next_action, {
    kind: 'command',
    command: 'reopen-review',
  })

  const handoffStatus = JSON.parse(
    run(
      cwd,
      ['context', id, '--json', '--status'],
      'codex:session:replacement',
    ).stdout,
  ).task
  assert.deepEqual(handoffStatus.next_action, {
    kind: 'await_user',
    boundary: 'approval',
    reason: 'takeover',
  })
  assert.deepEqual(handoffStatus.after_takeover_next_action, {
    kind: 'command',
    command: 'reopen-review',
  })

  const briefResult = run(cwd, ['context', id, '--json', '--brief'])
  assert.equal(briefResult.status, 0, briefResult.stderr)
  const brief = JSON.parse(briefResult.stdout).task
  assert.equal(brief.schema5_view.reviewer_next_action, 'reopen_review')
  const human = run(cwd, ['context', id])
  assert.equal(human.status, 0, human.stderr)
  assert.match(human.stdout, /Reviewer next action: reopen_review/)

  const before = readTask(cwd, id)
  const deniedDone = run(cwd, [
    'done', id, '--expect-revision', revision(cwd, id), '--json',
  ])
  assert.notEqual(deniedDone.status, 0)
  const deniedEnvelope = JSON.parse(deniedDone.stderr)
  assert.equal(deniedEnvelope.error.code, 'workspace_violation')
  assert.match(deniedEnvelope.error.message, /submission proof is stale/)

  const reopened = run(cwd, [
    'reopen-review', id, '--expect-revision', revision(cwd, id),
    '--reason', '提交后工作区内容发生变化', '--json',
  ])
  assert.equal(reopened.status, 0, reopened.stderr)
  const after = readTask(cwd, id)
  assert.equal(after.phase, 'dev')
  assert.equal(after.work_revision, before.work_revision + 1)
  assert.equal(after.submission, undefined)
  assert.deepEqual(after.plan, before.plan)
  assert.equal(after.plan_revision, before.plan_revision)
  assert.deepEqual(after.implementation_approval, before.implementation_approval)
  assert.deepEqual(after.work_basis, before.work_basis)
  assert.equal(after.primary_writer, before.primary_writer)
  assert.equal(after.provenance, before.provenance)
  assert.deepEqual(after.artifacts, before.artifacts)
  assert.deepEqual(after.verification, before.verification)
  assert.deepEqual(after.workspace_proof, before.workspace_proof)

  const events = readFileSync(eventsPath(cwd, id), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const decision = events.findLast((event) => event.type === 'decision_recorded')
  assert.equal(decision.answer, '提交后工作区内容发生变化')
  assert.equal(events.at(-1).type, 'work_started')
  assert.equal(
    events.filter((event) => event.type === 'review_feedback').length,
    0,
  )
  const timeline = JSON.parse(
    run(cwd, ['context', id, '--json', '--history', 'timeline']).stdout,
  ).timeline
  assert.equal(timeline.at(-2).event_type, 'decision_recorded')
  assert.equal(timeline.at(-1).event_type, 'work_started')

  const verified = run(cwd, [
    'verify-all', id, '--expect-revision', revision(cwd, id), '--json',
  ])
  assert.equal(verified.status, 0, verified.stderr)
  assert.deepEqual(
    JSON.parse(verified.stdout).executed.map((item) => item.name),
    ['first', 'second'],
  )
  const resubmitted = submit(cwd, id)
  assert.equal(resubmitted.status, 0, resubmitted.stderr)
  assert.equal(readTask(cwd, id).phase, 'review')
})

test('reopen-review rejects current proof and invalid lifecycle states without writes', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [] }), 'reopen guards')
  approve(cwd, id)
  assert.equal(submit(cwd, id, ['--no-verify', '--reason', 'fixture']).status, 0)

  function denied(args, actor = 'codex:session:review') {
    const before = openTaskFiles(cwd, id)
    const result = run(cwd, ['reopen-review', id, ...args, '--json'], actor)
    assert.notEqual(result.status, 0)
    assert.deepEqual(openTaskFiles(cwd, id), before)
    return JSON.parse(result.stderr)
  }

  const current = denied([
    '--expect-revision', revision(cwd, id), '--reason', '无效恢复',
  ])
  assert.equal(current.error.code, 'command_failed')
  assert.match(current.error.message, /requires stale submission proof/)

  const missingReason = denied(['--expect-revision', revision(cwd, id)])
  assert.equal(missingReason.error.code, 'invalid_arguments')

  const conflict = denied([
    '--expect-revision', String(Number(revision(cwd, id)) - 1),
    '--reason', '旧 revision',
  ])
  assert.match(conflict.error.message, /Task changed: expected revision/)

  const writerMismatch = denied([
    '--expect-revision', revision(cwd, id), '--reason', '错误 writer',
  ], 'codex:session:other')
  assert.match(writerMismatch.error.message, /Writer mismatch/)

  const blockedTask = readTask(cwd, id)
  blockedTask.blocked = {
    reason: '等待输入',
    waiting_for: '用户',
    blocked_at: blockedTask.updated_at,
  }
  blockedTask.plan.verification_plan = [{
    name: 'new-gate',
    command: [process.execPath, '-e', 'process.exit(0)'],
    kind: 'gate',
  }]
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(blockedTask, null, 2)}\n`)
  const blocked = denied([
    '--expect-revision', revision(cwd, id), '--reason', 'blocked',
  ])
  assert.match(blocked.error.message, /Task is blocked/)

  const retrospective = readTask(cwd, id)
  delete retrospective.blocked
  delete retrospective.implementation_approval
  retrospective.work_basis = {
    kind: 'retrospective_record',
    recorded_at: retrospective.updated_at,
    reason: '事后记录',
    implemented_before_task: true,
    scope_summary: '已有实现',
    plan_revision: retrospective.plan_revision,
    work_revision: retrospective.work_revision,
  }
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(retrospective, null, 2)}\n`)
  const retrospectiveResult = denied([
    '--expect-revision', revision(cwd, id), '--reason', 'retrospective',
  ])
  assert.match(retrospectiveResult.error.message, /retrospective work cannot be reopened/)

  const devTask = readTask(cwd, id)
  devTask.phase = 'dev'
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(devTask, null, 2)}\n`)
  const wrongPhase = denied([
    '--expect-revision', revision(cwd, id), '--reason', 'dev',
  ])
  assert.match(wrongPhase.error.message, /requires a task in review/)

  const historical = readTask(cwd, id)
  historical.phase = 'review'
  historical.schema_version = 4
  historical.min_writer_version = '0.4.0'
  historical.submission.unverified = '未验证项'
  delete historical.submission.unverified_items
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(historical, null, 2)}\n`)
  const historicalResult = denied([
    '--expect-revision', revision(cwd, id), '--reason', 'historical',
  ])
  assert.equal(historicalResult.error.code, 'writer_version_mismatch')
})

test('context timeline rewrites technical review feedback for user reading', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [plan().verification_plan[0]] }))
  approve(cwd, id)
  assert.equal(verify(cwd, id, 'first').status, 0)
  assert.equal(submit(cwd, id).status, 0)
  const feedback = run(cwd, [
    'approve', id, '--expect-revision', revision(cwd, id),
    '--feedback',
    '纠正 submission knowledge_impact：当前 artifact_refs 是产品文档与 canonical skill，并非带 knowledge frontmatter 的模块知识文档；重新提交时改为 kind=none',
    '--json',
  ])
  assert.equal(feedback.status, 0, feedback.stderr)

  const context = run(cwd, ['context', id, '--json', '--brief'])
  assert.equal(context.status, 0, context.stderr)
  const timeline = JSON.parse(context.stdout).timeline
  const entry = timeline.findLast((item) => item.event_type === 'review_feedback')
  assert.equal(entry.title, '反馈：修正提交记录')
  assert.equal(entry.summary, '修正提交记录里的知识影响标记。')
  assert.match(entry.impact, /重新提交验收/)
  assert.doesNotMatch(entry.summary, /knowledge_impact|artifact_refs|kind=none|frontmatter/)
  assert.equal(entry.details.classification, 'implementation_correction')
})

test('submit warns when an artifact is not tracked by Git', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [] }))
  const attached = run(cwd, [
    'save', id, '--expect-revision', revision(cwd, id),
    '--artifact', 'doc:docs/local.md', '--json',
  ])
  assert.equal(attached.status, 0, attached.stderr)
  approve(cwd, id)
  const result = submit(cwd, id, ['--no-verify', '--reason', '纯文档'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(JSON.parse(result.stdout).warnings.join('\n'), /docs\/local\.md is missing/)
})

test('submit verbose warnings report every untracked worktree file separately from artifacts', () => {
  const cwd = temporaryDirectory()
  spawnSync('git', ['init'], { cwd, encoding: 'utf8' })
  writeFileSync(join(cwd, '.gitignore'), '.latch/\n')
  spawnSync('git', ['add', '.gitignore'], { cwd, encoding: 'utf8' })
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [] }))
  writeFileSync(join(cwd, 'implementation.ts'), 'export const value = 1\n')
  writeFileSync(join(cwd, 'review-note.md'), 'review\n')
  mkdirSync(join(cwd, 'src'), { recursive: true })
  writeFileSync(join(cwd, 'src', 'cli.ts'), 'export const scoped = true\n')
  approve(cwd, id)
  const result = submit(cwd, id, [
    '--no-verify', '--reason', 'fixture', '--verbose-warnings',
  ])
  assert.equal(result.status, 0, result.stderr)
  const warnings = JSON.parse(result.stdout).warnings.join('\n')
  assert.match(warnings, /Worktree delivery: implementation\.ts is untracked \(ambient\)/)
  assert.match(warnings, /Worktree delivery: review-note\.md is untracked \(ambient\)/)
  assert.match(warnings, /Worktree delivery: src\/cli\.ts is untracked \(in scope\)/)
  assert.doesNotMatch(warnings, /Artifact delivery: implementation\.ts/)
})

test('submit aggregates untracked worktree warnings with eight sorted samples by default', () => {
  const cwd = temporaryDirectory()
  spawnSync('git', ['init'], { cwd, encoding: 'utf8' })
  writeFileSync(join(cwd, '.gitignore'), '.latch/\n')
  spawnSync('git', ['add', '.gitignore'], { cwd, encoding: 'utf8' })
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [] }))
  for (let index = 0; index < 10; index += 1)
    writeFileSync(join(cwd, `file-${String(index).padStart(2, '0')}.txt`), 'fixture\n')
  approve(cwd, id)

  const result = submit(cwd, id, ['--no-verify', '--reason', 'fixture'])
  assert.equal(result.status, 0, result.stderr)
  const warnings = JSON.parse(result.stdout).warnings.filter(
    (warning) => warning.startsWith('Worktree delivery:'),
  )
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /10 untracked files/)
  assert.match(warnings[0], /0 in scope, 10 ambient/)
  assert.match(warnings[0], /samples: file-00\.txt \(ambient\), file-01\.txt \(ambient\), file-02\.txt \(ambient\), file-03\.txt \(ambient\), file-04\.txt \(ambient\), file-05\.txt \(ambient\), file-06\.txt \(ambient\), file-07\.txt \(ambient\)/)
  assert.doesNotMatch(warnings[0], /file-08\.txt/)
})

test('submit reports every missing knowledge artifact and a copyable repair command', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [] }))
  approve(cwd, id)
  writeFileSync(join(cwd, 'impact.json'), `${JSON.stringify({
    kind: 'updated',
    summary: '更新知识',
    artifact_refs: [
      { kind: 'knowledge', path: 'docs/a.md' },
      { kind: 'doc', path: 'docs/b.md' },
    ],
  })}\n`)

  const result = run(cwd, [
    'submit', id, '--expect-revision', '2',
    '--changes', '实现完成',
    '--knowledge-impact-file', 'impact.json',
    '--no-verify', '--reason', '纯文档', '--json',
  ])
  assert.notEqual(result.status, 0)
  const message = JSON.parse(result.stderr).error.message
  assert.match(message, /knowledge:docs\/a\.md, doc:docs\/b\.md/)
  assert.match(
    message,
    new RegExp(`latch artifact add ${id} --expect-revision 2 knowledge:docs/a\\.md doc:docs/b\\.md`),
  )
  assert.equal(readTask(cwd, id).revision, 2)
  assert.equal(readTask(cwd, id).phase, 'dev')
})

test('no-verify requires approval, no gates, and a reason', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const noGatePlan = plan({ verification_plan: [] })
  const id = checkpoint(cwd, noGatePlan)
  assert.notEqual(submit(cwd, id, ['--no-verify', '--reason', '纯文档']).status, 0)
  approve(cwd, id)
  assert.notEqual(submit(cwd, id, ['--no-verify']).status, 0)
  const result = submit(cwd, id, ['--no-verify', '--reason', '纯文档'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readTask(cwd, id).submission.no_verify.reason, '纯文档')

  const gated = checkpoint(cwd, plan(), 'gated no verify')
  // 第一张已在 review 仍占用；回 plan 只为构造独立门禁场景。
  const first = readTask(cwd, id)
  first.phase = 'plan'
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(first, null, 2)}\n`)
  approve(cwd, gated)
  assert.notEqual(submit(cwd, gated, ['--no-verify', '--reason', 'skip']).status, 0)
})

test('done freezes current submission into closure, archives, clears current, and retries idempotently', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [] }))
  approve(cwd, id)
  assert.equal(submit(cwd, id, ['--no-verify', '--reason', '纯文档']).status, 0)
  const expected = revision(cwd, id)
  const closeout = writeCloseout(cwd, [{
    item_id: 'U1',
    outcome: 'followup',
    followup: {
      action: '后续观察',
      owner: {
        kind: 'external',
        account_uri: 'mailto:runtime@example.com',
      },
    },
  }])
  const done = run(cwd, [
    'done', id, '--expect-revision', expected, '--closeout-file', closeout, '--json',
  ])
  assert.equal(done.status, 0, done.stderr)
  const doneOutput = JSON.parse(done.stdout)
  assert.equal(doneOutput.archived, true)
  assert.equal(doneOutput.phase, 'review')
  assert.equal(doneOutput.last_open_phase, 'review')
  const archived = archivedTask(cwd, id)
  assert.equal(archived.outcome, 'done')
  assert.equal(archived.closure.changes, '实现完成')
  assert.equal(archived.closure.resolutions[0].followup.action, '后续观察')
  assert.equal(
    archived.closure.resolutions[0].followup.owner.account_uri,
    'mailto:runtime@example.com',
  )
  const archivedContext = JSON.parse(run(cwd, ['context', id, '--json']).stdout)
  assert.equal(
    archivedContext.task.schema5_view.closeout.followup_next_action,
    'track_followup_items',
  )
  assert.equal(
    archivedContext.task.schema5_view.closeout.resolutions.sample[0].summary,
    '后续观察',
  )
  const state = JSON.parse(readFileSync(join(cwd, '.latch', 'state.json'), 'utf8'))
  assert.deepEqual(state.actors, {})

  const retry = run(cwd, [
    'done', id, '--expect-revision', expected, '--json',
  ])
  assert.equal(retry.status, 0, retry.stderr)
  assert.equal(JSON.parse(retry.stdout).outcome, 'done')

  const archiveBefore = JSON.stringify(archivedTask(cwd, id))
  const reopenArchive = run(cwd, [
    'reopen-review', id, '--expect-revision', expected,
    '--reason', 'archive 不可恢复', '--json',
  ])
  assert.notEqual(reopenArchive.status, 0)
  assert.equal(JSON.stringify(archivedTask(cwd, id)), archiveBefore)
})

test('schema 5 closeout rejects incomplete, duplicate, unknown, and unstable owner inputs atomically', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [] }), 'atomic closeout')
  approve(cwd, id)
  const submitted = submit(cwd, id, [
    '--unverified', '第二项',
    '--unverified', '第三项',
    '--no-verify', '--reason', 'fixture',
  ])
  assert.equal(submitted.status, 0, submitted.stderr)
  const beforeTask = readFileSync(taskPath(cwd, id), 'utf8')
  const beforeEvents = readFileSync(eventsPath(cwd, id), 'utf8')
  const attempts = [
    [],
    [
      { item_id: 'U1', outcome: 'resolved', resolution: '完成' },
      { item_id: 'U1', outcome: 'resolved', resolution: '重复' },
      { item_id: 'U3', outcome: 'resolved', resolution: '完成' },
    ],
    [
      { item_id: 'U1', outcome: 'resolved', resolution: '完成' },
      { item_id: 'U2', outcome: 'resolved', resolution: '完成' },
      { item_id: 'U9', outcome: 'resolved', resolution: '未知' },
    ],
    [
      { item_id: 'U1', outcome: 'resolved', resolution: '完成' },
      { item_id: 'U2', outcome: 'accepted_risk', reason: '普通 reason 不构成用户接受' },
      {
        item_id: 'U3',
        outcome: 'followup',
        followup: {
          action: '继续观察',
          owner: { kind: 'external', account_uri: 'role:release-manager' },
        },
      },
    ],
    [
      { item_id: 'U1', outcome: 'resolved', resolution: '完成' },
      {
        item_id: 'U2',
        outcome: 'accepted_risk',
        user_acceptance: { statement: '用户明确接受' },
      },
      {
        item_id: 'U3',
        outcome: 'followup',
        followup: {
          action: '继续观察',
          owner: {
            kind: 'external',
            account_uri: 'https://user:secret@example.com/teams/runtime',
          },
        },
      },
    ],
    ...['mailto:@', 'mailto:a@', 'mailto:@example.com'].map((accountUri) => [
      { item_id: 'U1', outcome: 'resolved', resolution: '完成' },
      {
        item_id: 'U2',
        outcome: 'accepted_risk',
        user_acceptance: { statement: '用户明确接受' },
      },
      {
        item_id: 'U3',
        outcome: 'followup',
        followup: {
          action: '继续观察',
          owner: { kind: 'external', account_uri: accountUri },
        },
      },
    ]),
  ]
  for (const resolutions of attempts) {
    const result = run(cwd, [
      'done', id, '--expect-revision', revision(cwd, id),
      '--closeout-file', writeCloseout(cwd, resolutions), '--json',
    ])
    assert.notEqual(result.status, 0)
    assert.equal(readFileSync(taskPath(cwd, id), 'utf8'), beforeTask)
    assert.equal(readFileSync(eventsPath(cwd, id), 'utf8'), beforeEvents)
  }
})

test('task store validates persisted mailto owner local part and domain', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const id = checkpoint(cwd, plan({ verification_plan: [] }), 'persisted mailto')
  approve(cwd, id)
  const submitted = submit(cwd, id, ['--no-verify', '--reason', 'fixture'])
  assert.equal(submitted.status, 0, submitted.stderr)
  const task = readTask(cwd, id)
  task.closure = {
    changes: task.submission.changes,
    verified: task.submission.verified,
    unverified_items: structuredClone(task.submission.unverified_items),
    resolutions: [{
      item_id: 'U1',
      outcome: 'followup',
      followup: {
        action: '继续观察',
        owner: {
          kind: 'external',
          account_uri: 'mailto:runtime@example.com',
        },
      },
    }],
    accepted_at: '2026-07-31T00:00:00.000Z',
  }
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(task, null, 2)}\n`)
  const store = openTaskStoreV2(cwd)
  assert.equal(
    readTaskV2(store, id).closure.resolutions[0].followup.owner.account_uri,
    'mailto:runtime@example.com',
  )

  for (const accountUri of ['mailto:@', 'mailto:a@', 'mailto:@example.com']) {
    task.closure.resolutions[0].followup.owner.account_uri = accountUri
    writeFileSync(taskPath(cwd, id), `${JSON.stringify(task, null, 2)}\n`)
    assert.throws(
      () => readTaskV2(store, id),
      /Invalid closure\.resolutions\.followup\.owner/,
    )
  }
})

test('done rejects stale submission and abandon requires reason and archives outcome', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const doneId = checkpoint(cwd, plan({ verification_plan: [] }), 'stale done')
  approve(cwd, doneId)
  assert.equal(submit(cwd, doneId, ['--no-verify', '--reason', 'none']).status, 0)
  const task = readTask(cwd, doneId)
  task.work_revision += 1
  writeFileSync(taskPath(cwd, doneId), `${JSON.stringify(task, null, 2)}\n`)
  const stale = run(cwd, [
    'done', doneId, '--expect-revision', revision(cwd, doneId), '--json',
  ])
  assert.notEqual(stale.status, 0)
  const staleEnvelope = JSON.parse(stale.stderr)
  assert.equal(staleEnvelope.error.code, 'proof_stale')
  assert.match(staleEnvelope.error.message, /submission proof is stale/)

  task.phase = 'plan'
  writeFileSync(taskPath(cwd, doneId), `${JSON.stringify(task, null, 2)}\n`)
  const abandonedId = checkpoint(cwd, plan(), 'abandoned')
  const missing = run(cwd, [
    'abandon', abandonedId, '--expect-revision', '1',
  ])
  assert.notEqual(missing.status, 0)
  const abandoned = run(cwd, [
    'abandon', abandonedId, '--expect-revision', '1',
    '--reason', '用户取消', '--json',
  ])
  assert.equal(abandoned.status, 0, abandoned.stderr)
  const abandonedOutput = JSON.parse(abandoned.stdout)
  assert.equal(abandonedOutput.archived, true)
  assert.equal(abandonedOutput.phase, 'plan')
  assert.equal(abandonedOutput.last_open_phase, 'plan')
  assert.equal(archivedTask(cwd, abandonedId).outcome, 'abandoned')
})
