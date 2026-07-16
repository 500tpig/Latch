import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const cli = join(process.cwd(), 'dist/cli.js')
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-v2-cli-'))
  temporaryDirectories.push(directory)
  return directory
}

function run(cwd, args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      LATCH_ACTOR: options.actor ?? 'codex:session:test-session',
    },
  })
}

function plan(overrides = {}) {
  return {
    goal: '实现 v2 CLI',
    scope: ['src/cli.ts'],
    acceptance: ['CLI tests pass'],
    approach: ['使用 node:util.parseArgs'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['init -> checkpoint -> save'],
    out_of_scope: ['approve'],
    verification_plan: [
      { name: 'tests', command: ['pnpm', 'test'], kind: 'gate' },
    ],
    open_questions: [],
    ...overrides,
  }
}

function writePlan(cwd, value = plan(), name = 'plan.json') {
  const path = join(cwd, name)
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  return name
}

function init(cwd) {
  const result = run(cwd, ['init'])
  assert.equal(result.status, 0, result.stderr)
}

function checkpoint(cwd, title = 'CLI task', overrides = {}) {
  const planFile = writePlan(cwd, plan(overrides))
  const result = run(cwd, [
    'checkpoint',
    title,
    '--plan-file',
    planFile,
    '--json',
  ])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function taskIds(cwd) {
  return readdirSync(join(cwd, '.latch', 'tasks'))
}

function taskPath(cwd, id) {
  return join(cwd, '.latch', 'tasks', id, 'task.json')
}

function readTask(cwd, id) {
  return JSON.parse(readFileSync(taskPath(cwd, id), 'utf8'))
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('top-level and command help have no side effects', () => {
  for (const args of [[], ['--help'], ['checkpoint', '--help'], ['save', '--help']]) {
    const cwd = temporaryDirectory()
    const result = run(cwd, args)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Usage: latch/)
    assert.equal(existsSync(join(cwd, '.latch')), false)
  }

  const checkpointHelp = run(temporaryDirectory(), ['checkpoint', '--help'])
  assert.match(checkpointHelp.stdout, /--profile <light\|standard>/)
  assert.match(checkpointHelp.stdout, /--authorization-file/)
  assert.match(checkpointHelp.stdout, /--retrospective-file/)
  const saveHelp = run(temporaryDirectory(), ['save', '--help'])
  assert.match(saveHelp.stdout, /--provenance <clean\|mixed>/)
  assert.match(saveHelp.stdout, /--provenance-reason/)
})

test('unknown command and flag fail before creating .latch', () => {
  const unknownCommandRoot = temporaryDirectory()
  const unknownCommand = run(unknownCommandRoot, ['wat'])
  assert.notEqual(unknownCommand.status, 0)
  assert.match(unknownCommand.stderr, /Unknown command/)
  assert.equal(existsSync(join(unknownCommandRoot, '.latch')), false)

  const unknownFlagRoot = temporaryDirectory()
  const unknownFlag = run(unknownFlagRoot, ['list', '--wat'])
  assert.notEqual(unknownFlag.status, 0)
  assert.match(unknownFlag.stderr, /Unknown option/)
  assert.equal(existsSync(join(unknownFlagRoot, '.latch')), false)
})

test('JSON errors use the stable envelope', () => {
  const cwd = temporaryDirectory()
  const result = run(cwd, ['list', '--json', '--wat'])

  assert.notEqual(result.status, 0)
  const data = JSON.parse(result.stderr)
  assert.equal(data.schema_version, 2)
  assert.equal(typeof data.generated_at, 'string')
  assert.equal(data.error.code, 'invalid_arguments')
  assert.match(data.error.message, /Unknown option/)
})

test('init creates schema v2 and returns workspace JSON', () => {
  const cwd = temporaryDirectory()
  const result = run(cwd, ['init', '--json'])

  assert.equal(result.status, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.schema_version, 2)
  assert.equal(typeof data.generated_at, 'string')
  assert.equal(data.workspace_root, realpathSync(cwd))
  assert.deepEqual(
    JSON.parse(readFileSync(join(cwd, '.latch', 'state.json'), 'utf8')),
    { schema_version: 2, actors: {} },
  )
})

test('checkpoint is create-only, requires a full plan, and returns warnings', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const planFile = writePlan(cwd)

  const first = run(cwd, [
    'checkpoint',
    'Same title',
    '--plan-file',
    planFile,
    '--artifact',
    'brief:docs/brief.md',
    '--json',
  ])
  const second = run(cwd, [
    'checkpoint',
    'Same title',
    '--plan-file',
    planFile,
    '--json',
  ])

  assert.equal(first.status, 0, first.stderr)
  assert.equal(second.status, 0, second.stderr)
  const firstData = JSON.parse(first.stdout)
  const secondData = JSON.parse(second.stdout)
  assert.equal(firstData.schema_version, 2)
  assert.equal(firstData.revision, 1)
  assert.equal(firstData.phase, 'plan')
  assert.deepEqual(firstData.warnings, [])
  assert.notEqual(firstData.task_id, secondData.task_id)
  assert.equal(taskIds(cwd).length, 2)
  const firstTask = readTask(cwd, firstData.task_id)
  assert.equal(firstTask.schema_version, 3)
  assert.equal(firstTask.profile, 'standard')
  assert.equal(firstTask.provenance, 'clean')
  assert.deepEqual(firstTask.artifacts, [
    { kind: 'brief', path: 'docs/brief.md' },
  ])
})

test('checkpoint rejects missing or invalid plan without creating task', () => {
  const cwd = temporaryDirectory()
  init(cwd)

  const missing = run(cwd, ['checkpoint', 'Missing plan'])
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /--plan-file is required/)
  assert.deepEqual(taskIds(cwd), [])

  const invalidPlan = writePlan(cwd, { goal: 'incomplete' }, 'invalid.json')
  const invalid = run(cwd, [
    'checkpoint',
    'Invalid plan',
    '--plan-file',
    invalidPlan,
  ])
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /Invalid plan.scope/)
  assert.deepEqual(taskIds(cwd), [])
})

test('artifact paths must remain relative to workspace root', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const planFile = writePlan(cwd)

  for (const value of ['doc:/tmp/x.md', 'doc:../x.md']) {
    const result = run(cwd, [
      'checkpoint',
      'Bad artifact',
      '--plan-file',
      planFile,
      '--artifact',
      value,
    ])
    assert.notEqual(result.status, 0)
  }
  assert.deepEqual(taskIds(cwd), [])
})

test('use resolves a unique prefix, stores canonical ID, and does not append task event', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const directory = join(cwd, '.latch', 'tasks', created.task_id)
  const eventsBefore = readFileSync(join(directory, 'events.jsonl'), 'utf8')

  const result = run(cwd, ['use', created.task_id.slice(0, 20), '--json'], {
    actor: 'codex:session:another-session',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).task_id, created.task_id)
  const state = JSON.parse(readFileSync(join(cwd, '.latch', 'state.json'), 'utf8'))
  assert.equal(
    state.actors['codex:session:another-session'].current_task_id,
    created.task_id,
  )
  assert.equal(readFileSync(join(directory, 'events.jsonl'), 'utf8'), eventsBefore)
})

test('list and context expose stable full and brief JSON', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)

  const fullList = JSON.parse(run(cwd, ['list', '--json']).stdout)
  assert.equal(fullList.schema_version, 2)
  assert.equal(fullList.current_task_id, created.task_id)
  assert.equal(fullList.tasks[0].plan_revision, 1)
  assert.equal(fullList.tasks[0].work_revision, 0)
  assert.equal(fullList.tasks[0].provenance, 'clean')

  const briefList = JSON.parse(run(cwd, ['list', '--json', '--brief']).stdout)
  assert.equal(briefList.tasks[0].revision, 1)
  assert.equal(briefList.tasks[0].provenance, 'clean')
  assert.equal('plan_revision' in briefList.tasks[0], false)

  const fullContext = JSON.parse(run(cwd, ['context', '--json']).stdout)
  assert.equal(fullContext.current, true)
  assert.equal(fullContext.task.id, created.task_id)
  assert.equal(fullContext.task.provenance, 'clean')
  assert.equal(fullContext.task.plan.approach[0], '使用 node:util.parseArgs')
  assert.equal(fullContext.history_incomplete, false)
  assert.deepEqual(fullContext.recent_events.map((event) => event.type), [
    'task_created',
  ])

  const briefContext = JSON.parse(
    run(cwd, ['context', created.task_id, '--json', '--brief']).stdout,
  )
  assert.equal(briefContext.task.goal, '实现 v2 CLI')
  assert.equal(briefContext.task.provenance, 'clean')
  assert.equal('plan' in briefContext.task, false)
  assert.deepEqual(briefContext.task.verification_plan, [
    {
      name: 'tests',
      command: ['pnpm', 'test'],
      kind: 'gate',
      status: 'pending',
    },
  ])
  assert.equal(briefContext.recent_events.length, 1)
})

test('brief context summarizes planned verification states', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, 'Verification summary', {
    verification_plan: [
      { name: 'passed', command: ['pnpm', 'test'], kind: 'gate' },
      { name: 'failed', command: ['pnpm', 'typecheck'], kind: 'gate' },
      { name: 'stale', command: ['pnpm', 'check'], kind: 'gate' },
      { name: 'pending', command: ['pnpm', 'build'], kind: 'diagnostic' },
    ],
  })
  const task = readTask(cwd, created.task_id)
  const createdAt = new Date().toISOString()
  task.work_revision = 2
  task.verification.gate.passed = {
    name: 'passed',
    kind: 'gate',
    command: ['pnpm', 'test'],
    status: 'pass',
    exit_code: 0,
    work_revision: 2,
    created_at: createdAt,
  }
  task.verification.gate.failed = {
    name: 'failed',
    kind: 'gate',
    command: ['pnpm', 'typecheck'],
    status: 'fail',
    exit_code: 1,
    work_revision: 2,
    created_at: createdAt,
  }
  task.verification.gate.stale = {
    name: 'stale',
    kind: 'gate',
    command: ['pnpm', 'check'],
    status: 'pass',
    exit_code: 0,
    work_revision: 1,
    created_at: createdAt,
  }
  writeFileSync(taskPath(cwd, created.task_id), `${JSON.stringify(task, null, 2)}\n`)

  const briefContext = JSON.parse(
    run(cwd, ['context', created.task_id, '--json', '--brief']).stdout,
  )
  assert.deepEqual(briefContext.task.verification_plan, [
    {
      name: 'passed',
      command: ['pnpm', 'test'],
      kind: 'gate',
      status: 'pass',
    },
    {
      name: 'failed',
      command: ['pnpm', 'typecheck'],
      kind: 'gate',
      status: 'fail',
    },
    {
      name: 'stale',
      command: ['pnpm', 'check'],
      kind: 'gate',
      status: 'stale',
    },
    {
      name: 'pending',
      command: ['pnpm', 'build'],
      kind: 'diagnostic',
      status: 'pending',
    },
  ])
  assert.deepEqual(briefContext.task.verification, task.verification)
})

test('brief requires JSON and read commands do not initialize storage', () => {
  const briefRoot = temporaryDirectory()
  const brief = run(briefRoot, ['list', '--brief'])
  assert.notEqual(brief.status, 0)
  assert.match(brief.stderr, /--brief requires --json/)
  assert.equal(existsSync(join(briefRoot, '.latch')), false)

  const readRoot = temporaryDirectory()
  const context = run(readRoot, ['context', '--json'])
  assert.notEqual(context.status, 0)
  assert.equal(existsSync(join(readRoot, '.latch')), false)
})

test('save updates a plan, increments revisions, and invalidates approval and verification', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const path = taskPath(cwd, created.task_id)
  const seeded = readTask(cwd, created.task_id)
  seeded.phase = 'review'
  seeded.implementation_approval = {
    approved_plan_revision: 1,
    approved_at: new Date().toISOString(),
    source: 'user',
    reason: 'approved',
  }
  seeded.verification.gate.tests = {
    name: 'tests',
    kind: 'gate',
    command: ['pnpm', 'test'],
    status: 'pass',
    exit_code: 0,
    work_revision: 1,
    created_at: new Date().toISOString(),
  }
  seeded.submission = {
    work_revision: 1,
    changes: 'old',
    verified: 'tests',
    unverified: '',
    submitted_at: new Date().toISOString(),
  }
  writeFileSync(path, `${JSON.stringify(seeded, null, 2)}\n`)
  const changedPlan = writePlan(
    cwd,
    plan({ approach: ['先实现 parser，再接 store'] }),
    'changed-plan.json',
  )

  const result = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '1',
    '--plan-file',
    changedPlan,
    '--json',
  ])

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.previous_revision, 1)
  assert.equal(output.revision, 2)
  assert.equal(output.phase, 'plan')
  assert.deepEqual(output.warnings, [])
  const task = readTask(cwd, created.task_id)
  assert.equal(task.plan_revision, 2)
  assert.equal(task.phase, 'plan')
  assert.equal('implementation_approval' in task, false)
  assert.equal('submission' in task, false)
  assert.deepEqual(task.verification, { gate: {}, diagnostic: {} })
})

test('save records decision, artifact, and blocked events in one revision', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)

  const result = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '1',
    '--decision',
    '采用独立 v2 CLI',
    '--question',
    '如何保持 v1 回归？',
    '--answer',
    '使用独立入口',
    '--artifact',
    'doc:docs/example.md',
    '--block-reason',
    '等待字段',
    '--waiting-for',
    '后端确认',
    '--json',
  ])

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).revision, 2)
  const task = readTask(cwd, created.task_id)
  assert.deepEqual(task.artifacts, [{ kind: 'doc', path: 'docs/example.md' }])
  assert.equal(task.blocked.reason, '等待字段')
  const events = readFileSync(
    join(cwd, '.latch', 'tasks', created.task_id, 'events.jsonl'),
    'utf8',
  )
    .trim()
    .split('\n')
    .map(JSON.parse)
  assert.deepEqual(events.map((event) => event.type), [
    'task_created',
    'decision_recorded',
    'artifact_updated',
    'blocked',
  ])
  assert.ok(events.slice(1).every((event) => event.revision === 2))
  assert.deepEqual(events[2].added, ['doc:docs/example.md'])
})

test('save JSON exposes event write warnings without reporting a false failure', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const eventsPath = join(
    cwd,
    '.latch',
    'tasks',
    created.task_id,
    'events.jsonl',
  )
  chmodSync(eventsPath, 0o400)

  const result = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '1',
    '--decision',
    'task.json 是提交点',
    '--json',
  ])

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.revision, 2)
  assert.equal(output.warnings.length, 1)
  assert.match(output.warnings[0], /event was not recorded/)
  assert.equal(readTask(cwd, created.task_id).revision, 2)
})

test('save changes provenance as a standalone root fact', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const before = readTask(cwd, created.task_id)

  const mixed = run(cwd, [
    'save', created.task_id, '--expect-revision', '1',
    '--provenance', 'mixed', '--provenance-reason', '用户允许重叠并行', '--json',
  ])
  assert.equal(mixed.status, 0, mixed.stderr)
  let current = readTask(cwd, created.task_id)
  assert.equal(current.provenance, 'mixed')
  assert.equal(current.revision, 2)
  assert.equal(current.phase, before.phase)
  assert.equal(current.plan_revision, before.plan_revision)
  assert.equal(current.work_revision, before.work_revision)
  assert.deepEqual(current.verification, before.verification)

  const directory = join(cwd, '.latch', 'tasks', created.task_id)
  const events = readFileSync(join(directory, 'events.jsonl'), 'utf8')
    .trim().split('\n').map(JSON.parse)
  assert.equal(events.at(-1).type, 'decision_recorded')
  assert.match(events.at(-1).conclusion, /provenance clean -> mixed/)

  for (const args of [
    ['save', created.task_id, '--expect-revision', '2', '--provenance', 'mixed', '--provenance-reason', 'no-op'],
    ['save', created.task_id, '--expect-revision', '2', '--provenance', 'other', '--provenance-reason', 'invalid'],
    ['save', created.task_id, '--expect-revision', '2', '--provenance', 'clean'],
    ['save', created.task_id, '--expect-revision', '2', '--provenance-reason', 'missing value'],
    ['save', created.task_id, '--expect-revision', '2', '--provenance', 'clean', '--provenance-reason', 'combined', '--decision', 'not standalone'],
  ])
    assert.notEqual(run(cwd, args).status, 0)
  assert.equal(readTask(cwd, created.task_id).provenance, 'mixed')

  const wrongWriter = run(cwd, [
    'save', created.task_id, '--expect-revision', '2',
    '--provenance', 'clean', '--provenance-reason', 'wrong writer',
  ], { actor: 'codex:session:other' })
  assert.notEqual(wrongWriter.status, 0)
  assert.match(wrongWriter.stderr, /Writer mismatch/)

  const clean = run(cwd, [
    'save', created.task_id, '--expect-revision', '2',
    '--provenance', 'clean', '--provenance-reason', '隔离已经恢复', '--json',
  ])
  assert.equal(clean.status, 0, clean.stderr)
  current = readTask(cwd, created.task_id)
  assert.equal(current.provenance, 'clean')
  assert.equal(current.revision, 3)
})

test('save can remove artifacts and explicitly unblock', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const first = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '1',
    '--artifact',
    'doc:docs/example.md',
    '--block-reason',
    '等待字段',
    '--waiting-for',
    '后端',
    '--json',
  ])
  assert.equal(first.status, 0, first.stderr)

  const second = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '2',
    '--remove-artifact',
    'doc:docs/example.md',
    '--unblock',
    '--json',
  ])

  assert.equal(second.status, 0, second.stderr)
  const task = readTask(cwd, created.task_id)
  assert.deepEqual(task.artifacts, [])
  assert.equal('blocked' in task, false)
  assert.equal(task.revision, 3)
})

test('save rejects stale revision and no-op without modifying task or events', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const directory = join(cwd, '.latch', 'tasks', created.task_id)
  const before = {
    task: readFileSync(join(directory, 'task.json'), 'utf8'),
    events: readFileSync(join(directory, 'events.jsonl'), 'utf8'),
  }

  const stale = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '2',
    '--decision',
    'stale',
  ])
  assert.notEqual(stale.status, 0)
  assert.match(stale.stderr, /expected revision 2, current revision 1/)

  const noOp = run(cwd, [
    'save',
    created.task_id,
    '--expect-revision',
    '1',
    '--remove-artifact',
    'doc:missing.md',
  ])
  assert.notEqual(noOp.status, 0)
  assert.match(noOp.stderr, /did not contain any effective change/)

  assert.deepEqual(
    {
      task: readFileSync(join(directory, 'task.json'), 'utf8'),
      events: readFileSync(join(directory, 'events.jsonl'), 'utf8'),
    },
    before,
  )
})

test('save validates blocked arguments before writing', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const before = readFileSync(taskPath(cwd, created.task_id), 'utf8')

  for (const args of [
    ['--block-reason', 'missing waiting-for'],
    ['--waiting-for', 'missing reason'],
    ['--unblock', '--block-reason', 'x', '--waiting-for', 'y'],
  ]) {
    const result = run(cwd, [
      'save',
      created.task_id,
      '--expect-revision',
      '1',
      ...args,
    ])
    assert.notEqual(result.status, 0)
  }
  assert.equal(readFileSync(taskPath(cwd, created.task_id), 'utf8'), before)
})
