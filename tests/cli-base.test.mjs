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
import {
  archiveTaskV2,
  downgradeTaskV2,
  openTaskStoreV2,
} from '../dist/core/task-store.js'

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
    workspace_scope: { paths: ['src/'] },
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
  for (const args of [
    [],
    ['--help'],
    ['checkpoint', '--help'],
    ['save', '--help'],
    ['verify-all', '--help'],
    ['artifact', '--help'],
    ['record', '--help'],
    ['record', 'create', '--help'],
    ['submit', '--help'],
    ['upgrade-v4', '--help'],
  ]) {
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
  assert.match(checkpointHelp.stdout, /--source-record/)
  assert.match(
    checkpointHelp.stdout,
    /checkpoint --print-plan-template <light\|standard>/,
  )
  assert.match(
    run(temporaryDirectory(), ['--help']).stdout,
    /checkpoint --print-plan-template <light\|standard>/,
  )
  assert.match(run(temporaryDirectory(), ['record', '--help']).stdout, /record create/)
  const saveHelp = run(temporaryDirectory(), ['save', '--help'])
  assert.match(saveHelp.stdout, /--provenance <clean\|mixed>/)
  assert.match(saveHelp.stdout, /--provenance-reason/)
  const contextHelp = run(temporaryDirectory(), ['context', '--help'])
  assert.match(contextHelp.stdout, /--status/)
  assert.match(contextHelp.stdout, /--since-revision/)
  assert.match(contextHelp.stdout, /--history <timeline\|events\|both>/)
  assert.match(run(temporaryDirectory(), ['submit', '--help']).stdout, /--verbose-warnings/)
  const upgradeHelp = run(temporaryDirectory(), ['upgrade-v4', '--help'])
  assert.match(upgradeHelp.stdout, /--recover-writer/)
  assert.match(upgradeHelp.stdout, /--reason <text>/)
})

test('checkpoint templates are side-effect-free shape scaffolds that require completion', () => {
  const expected = {
    goal: 'Describe the intended outcome.',
    workspace_scope: { paths: [] },
    scope: [],
    acceptance: [],
    approach: [],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: [],
    out_of_scope: [],
    verification_plan: [],
    open_questions: [],
  }

  for (const profile of ['light', 'standard']) {
    const cwd = temporaryDirectory()
    const printed = run(
      cwd,
      ['checkpoint', '--print-plan-template', profile],
      { actor: '' },
    )
    assert.equal(printed.status, 0, printed.stderr)
    assert.deepEqual(JSON.parse(printed.stdout), expected)
    assert.equal(existsSync(join(cwd, '.latch')), false)
  }

  const invalid = run(
    temporaryDirectory(),
    ['checkpoint', '--print-plan-template', 'tiny'],
    { actor: '' },
  )
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /must be light or standard/)

  const mixedRoot = temporaryDirectory()
  const mixed = run(
    mixedRoot,
    [
      'checkpoint',
      'mixed',
      '--print-plan-template',
      'light',
      '--plan-file',
      'plan.json',
    ],
    { actor: '' },
  )
  assert.notEqual(mixed.status, 0)
  assert.match(mixed.stderr, /cannot be combined/)
  assert.equal(existsSync(join(mixedRoot, '.latch')), false)

  const cwd = temporaryDirectory()
  init(cwd)
  const templateFile = writePlan(cwd, expected, 'template.json')
  const draft = run(cwd, [
    'checkpoint',
    'Template draft',
    '--plan-file',
    templateFile,
    '--profile',
    'light',
    '--json',
  ])
  assert.equal(draft.status, 0, draft.stderr)
  assert.equal(readTask(cwd, JSON.parse(draft.stdout).task_id).phase, 'plan')

  const denied = run(cwd, [
    'checkpoint',
    'Template authorization denied',
    '--plan-file',
    templateFile,
    '--authorize-request',
    '用户请求执行明确的低风险变更',
    '--json',
  ])
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /not authorizable/)
  assert.equal(taskIds(cwd).length, 1)

  const completedFile = writePlan(cwd, {
    ...expected,
    workspace_scope: { paths: ['src/cli.ts'] },
    scope: ['修改 src/cli.ts'],
    acceptance: ['CLI tests pass'],
    approach: ['使用现有 CLI 模式'],
    verification_plan: [{
      name: 'tests',
      command: [process.execPath, '-e', 'process.exit(0)'],
      kind: 'gate',
    }],
  }, 'completed-template.json')
  const created = run(cwd, [
    'checkpoint',
    'Completed template task',
    '--plan-file',
    completedFile,
    '--authorize-request',
    '用户请求执行明确的低风险变更',
    '--json',
  ])
  assert.equal(created.status, 0, created.stderr)
  const task = readTask(cwd, JSON.parse(created.stdout).task_id)
  assert.equal(task.profile, 'light')
  assert.equal(task.phase, 'dev')
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
  assert.equal(firstTask.schema_version, 4)
  assert.equal(firstTask.min_writer_version, '0.4.0')
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
  assert.match(invalid.stderr, /Missing required plan fields/)
  assert.match(invalid.stderr, /plan\.scope/)
  assert.match(invalid.stderr, /Expected schema/)
  assert.match(invalid.stderr, /Minimal legal plan/)
  assert.match(invalid.stderr, /checkpoint --print-plan-template light/)

  for (const [value, actual] of [
    ['src/cli.ts', 'string'],
    [{ in: ['src/cli.ts'] }, 'object'],
  ]) {
    const invalidScope = writePlan(
      cwd,
      plan({ scope: value }),
      `invalid-scope-${actual}.json`,
    )
    const result = run(cwd, [
      'checkpoint',
      `Invalid scope ${actual}`,
      '--plan-file',
      invalidScope,
    ])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Invalid plan\.scope/)
    assert.match(result.stderr, /expected string\[\]/)
    assert.match(result.stderr, new RegExp(`got ${actual}`))
    assert.match(result.stderr, /Minimal legal value: \[\]/)
  }

  const invalidScopeJson = run(cwd, [
    'checkpoint',
    'Invalid scope JSON',
    '--plan-file',
    writePlan(cwd, plan({ scope: 'src/cli.ts' }), 'invalid-scope-json.json'),
    '--json',
  ])
  assert.notEqual(invalidScopeJson.status, 0)
  const invalidScopeEnvelope = JSON.parse(invalidScopeJson.stderr)
  assert.equal(invalidScopeEnvelope.schema_version, 2)
  assert.equal(invalidScopeEnvelope.error.code, 'command_failed')
  assert.match(invalidScopeEnvelope.error.message, /expected string\[\]/)
  assert.match(
    invalidScopeEnvelope.error.message,
    /checkpoint --print-plan-template light/,
  )

  const invalidVerification = writePlan(
    cwd,
    plan({
      verification_plan: [{
        name: 'check',
        command: 'pnpm check',
        kind: 'gate',
      }],
    }),
    'invalid-verification.json',
  )
  const invalidCommand = run(cwd, [
    'checkpoint',
    'Invalid verification command',
    '--plan-file',
    invalidVerification,
  ])
  assert.notEqual(invalidCommand.status, 0)
  assert.match(invalidCommand.stderr, /Invalid verification_plan\.command/)
  assert.match(invalidCommand.stderr, /expected string\[\]/)
  assert.match(invalidCommand.stderr, /got string/)
  assert.match(
    invalidCommand.stderr,
    /Minimal legal value: \["replace-with-real-command"\]/,
  )

  const invalidVerificationPlan = writePlan(
    cwd,
    plan({ verification_plan: {} }),
    'invalid-verification-plan.json',
  )
  const invalidPlanType = run(cwd, [
    'checkpoint',
    'Invalid verification plan',
    '--plan-file',
    invalidVerificationPlan,
  ])
  assert.notEqual(invalidPlanType.status, 0)
  assert.match(invalidPlanType.stderr, /Invalid plan\.verification_plan/)
  assert.match(invalidPlanType.stderr, /expected Array<\{/)
  assert.match(invalidPlanType.stderr, /got object/)

  const invalidNamePlan = writePlan(
    cwd,
    plan({
      verification_plan: [{
        name: '',
        command: ['pnpm', 'check'],
        kind: 'gate',
      }],
    }),
    'invalid-verification-name.json',
  )
  const invalidName = run(cwd, [
    'checkpoint',
    'Invalid verification name',
    '--plan-file',
    invalidNamePlan,
  ])
  assert.notEqual(invalidName.status, 0)
  assert.match(invalidName.stderr, /Invalid verification_plan\.name/)
  assert.match(invalidName.stderr, /expected non-empty string/)
  assert.match(invalidName.stderr, /Minimal legal value: "check"/)

  const invalidKindPlan = writePlan(
    cwd,
    plan({
      verification_plan: [{
        name: 'check',
        command: ['pnpm', 'check'],
        kind: 'check',
      }],
    }),
    'invalid-verification-kind.json',
  )
  const invalidKind = run(cwd, [
    'checkpoint',
    'Invalid verification kind',
    '--plan-file',
    invalidKindPlan,
  ])
  assert.notEqual(invalidKind.status, 0)
  assert.match(invalidKind.stderr, /Invalid verification_plan\.kind/)
  assert.match(invalidKind.stderr, /expected "gate" \| "diagnostic"/)
  assert.match(invalidKind.stderr, /Minimal legal value: "gate"/)
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
  assert.equal('archived' in fullContext, false)
  assert.equal(fullContext.task.id, created.task_id)
  assert.equal(fullContext.task.provenance, 'clean')
  assert.equal(fullContext.task.plan.approach[0], '使用 node:util.parseArgs')
  assert.equal(fullContext.history_incomplete, false)
  assert.deepEqual(fullContext.recent_events.map((event) => event.type), [
    'task_created',
  ])
  assert.deepEqual(fullContext.timeline.map((event) => event.title), [
    '创建任务',
  ])
  assert.equal(fullContext.timeline[0].summary, `创建「${readTask(cwd, created.task_id).title}」。`)

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
  assert.equal(briefContext.timeline.length, 1)
  assert.equal(briefContext.timeline[0].details.event_type, 'task_created')

  const statusContext = JSON.parse(
    run(cwd, ['context', created.task_id, '--json', '--status']).stdout,
  )
  assert.equal(statusContext.view, 'status')
  assert.equal(statusContext.task.writer.status, 'primary_writer')
  assert.equal(statusContext.task.authorization.status, 'missing')
  assert.equal(statusContext.task.next_action, 'approve')
  assert.equal('goal' in statusContext.task, false)
  assert.ok(JSON.stringify(statusContext).length < JSON.stringify(briefContext).length)

  const saved = run(cwd, [
    'save', created.task_id, '--expect-revision', '1',
    '--decision', '记录增量', '--json',
  ])
  assert.equal(saved.status, 0, saved.stderr)
  const delta = JSON.parse(
    run(cwd, [
      'context', created.task_id, '--json', '--since-revision', '1',
    ]).stdout,
  )
  assert.equal(delta.view, 'delta')
  assert.equal(delta.from_revision, 1)
  assert.equal(delta.to_revision, 2)
  assert.equal(delta.requires_baseline, true)
  assert.deepEqual(delta.events.map((event) => event.type), ['decision_recorded'])
  assert.deepEqual(delta.timeline.map((event) => event.title), ['记录决定'])
  assert.equal(delta.timeline[0].summary, '记录增量')
})

test('context 按精确 ID 只读归档 task 并保持 mutation 为 open-only', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, '归档 Context')
  const store = openTaskStoreV2(cwd)
  const archived = archiveTaskV2(store, created.task_id, {
    expectRevision: 1,
    actor: 'codex:session:test-session',
    outcome: 'done',
  }).task
  const archivedDirectory = join(
    cwd,
    '.latch',
    'archive',
    archived.updated_at.slice(0, 7),
    archived.id,
  )
  const taskJsonPath = join(archivedDirectory, 'task.json')
  const eventsPath = join(archivedDirectory, 'events.jsonl')

  const statusResult = run(cwd, [
    'context',
    archived.id,
    '--json',
    '--status',
  ])
  assert.equal(statusResult.status, 0, statusResult.stderr)
  const status = JSON.parse(statusResult.stdout)
  assert.equal(status.archived, true)
  assert.equal(status.outcome, 'done')
  assert.equal(status.last_open_phase, 'plan')
  assert.equal(status.current, false)
  assert.equal(status.task.next_action, 'read_only')

  const brief = JSON.parse(run(cwd, [
    'context',
    archived.id,
    '--json',
    '--brief',
    '--history',
    'timeline',
  ]).stdout)
  assert.equal(brief.archived, true)
  assert.equal(brief.history_view, 'timeline')
  assert.equal(brief.timeline.at(-1).event_type, 'done')
  assert.equal('recent_events' in brief, false)

  const delta = JSON.parse(run(cwd, [
    'context',
    archived.id,
    '--json',
    '--since-revision',
    '1',
    '--history',
    'events',
  ]).stdout)
  assert.equal(delta.archived, true)
  assert.deepEqual(delta.events.map((event) => event.type), ['done'])

  const human = run(cwd, ['context', archived.id])
  assert.equal(human.status, 0, human.stderr)
  assert.match(human.stdout, /Archived: yes/)
  assert.match(human.stdout, /Outcome: done/)
  assert.match(human.stdout, /Last open phase: plan/)

  const taskBefore = readFileSync(taskJsonPath, 'utf8')
  const eventsBefore = readFileSync(eventsPath, 'utf8')
  const mutation = run(cwd, [
    'save',
    archived.id,
    '--expect-revision',
    String(archived.revision),
    '--decision',
    '不应写入 archive',
    '--json',
  ])
  assert.notEqual(mutation.status, 0)
  assert.match(mutation.stderr, /Task not found/)
  assert.equal(readFileSync(taskJsonPath, 'utf8'), taskBefore)
  assert.equal(readFileSync(eventsPath, 'utf8'), eventsBefore)

  const prefix = run(cwd, [
    'context',
    archived.id.slice(0, -1),
    '--json',
    '--status',
  ])
  assert.notEqual(prefix.status, 0)
  assert.match(prefix.stderr, /Task not found/)

  const missing = run(cwd, [
    'context',
    '20260730000000000-missing-000000',
    '--json',
    '--status',
  ])
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /Task not found/)
})

test('context 按精确 ID 兼容读取 schema 2 archive', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, 'schema 2 archive', {
    verification_plan: [],
  })
  const store = openTaskStoreV2(cwd)
  const archived = archiveTaskV2(store, created.task_id, {
    expectRevision: 1,
    actor: 'codex:session:test-session',
    outcome: 'abandoned',
  }).task
  downgradeTaskV2(store, archived.id, {
    expectRevision: archived.revision,
    actor: 'codex:session:test-session',
  })

  const result = run(cwd, ['context', archived.id, '--json'])
  assert.equal(result.status, 0, result.stderr)
  const context = JSON.parse(result.stdout)
  assert.equal(context.archived, true)
  assert.equal(context.outcome, 'abandoned')
  assert.equal(context.last_open_phase, 'plan')
  assert.equal(context.task.schema_version, 2)
  assert.equal(context.recent_events.at(-1).type, 'abandoned')
  assert.equal(context.history_incomplete, false)
})

test('context history selector keeps defaults compatible and projects raw or readable history', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const detail = '调试详情'.repeat(120)
  const saved = run(cwd, [
    'save', created.task_id, '--expect-revision', '1',
    '--decision', '记录可读历史选择器',
    '--question', detail,
    '--answer', detail,
    '--json',
  ])
  assert.equal(saved.status, 0, saved.stderr)

  function assertDefaultMatchesBoth(args) {
    const standard = JSON.parse(run(cwd, [
      'context', created.task_id, '--json', ...args,
    ]).stdout)
    const explicitBoth = JSON.parse(run(cwd, [
      'context', created.task_id, '--json', ...args, '--history', 'both',
    ]).stdout)
    const { generated_at: standardGeneratedAt, ...standardBody } = standard
    const {
      generated_at: explicitGeneratedAt,
      history_view: historyView,
      ...explicitBody
    } = explicitBoth
    assert.ok(standardGeneratedAt)
    assert.ok(explicitGeneratedAt)
    assert.equal(historyView, 'both')
    assert.deepEqual(explicitBody, standardBody)
    return standard
  }

  assertDefaultMatchesBoth([])
  const defaultBrief = assertDefaultMatchesBoth(['--brief'])
  assertDefaultMatchesBoth(['--since-revision', '1'])

  const timeline = JSON.parse(
    run(cwd, [
      'context', created.task_id, '--json', '--brief', '--history', 'timeline',
    ]).stdout,
  )
  assert.equal(timeline.history_view, 'timeline')
  assert.equal('recent_events' in timeline, false)
  assert.equal(timeline.timeline.length, 2)
  assert.equal('details' in timeline.timeline[0], false)
  assert.ok(JSON.stringify(timeline).length < JSON.stringify(defaultBrief).length * 0.8)

  const events = JSON.parse(
    run(cwd, [
      'context', created.task_id, '--json', '--brief', '--history', 'events',
    ]).stdout,
  )
  assert.equal(events.history_view, 'events')
  assert.equal('timeline' in events, false)
  assert.deepEqual(events.recent_events, defaultBrief.recent_events)

  const fullTimeline = JSON.parse(
    run(cwd, [
      'context', created.task_id, '--json', '--history', 'timeline',
    ]).stdout,
  )
  assert.equal('recent_events' in fullTimeline, false)
  assert.equal(fullTimeline.history_view, 'timeline')

  const deltaTimeline = JSON.parse(
    run(cwd, [
      'context', created.task_id, '--json', '--since-revision', '1',
      '--history', 'timeline',
    ]).stdout,
  )
  assert.equal(deltaTimeline.view, 'delta')
  assert.equal(deltaTimeline.requires_baseline, true)
  assert.equal('events' in deltaTimeline, false)
  assert.equal('details' in deltaTimeline.timeline[0], false)

  const deltaEvents = JSON.parse(
    run(cwd, [
      'context', created.task_id, '--json', '--since-revision', '1',
      '--history', 'events',
    ]).stdout,
  )
  assert.equal('timeline' in deltaEvents, false)
  assert.deepEqual(deltaEvents.events.map((event) => event.type), ['decision_recorded'])

  const statusHistory = run(cwd, [
    'context', created.task_id, '--json', '--status', '--history', 'timeline',
  ])
  assert.notEqual(statusHistory.status, 0)
  assert.match(statusHistory.stderr, /--history cannot be combined with --status/)

  const humanHistory = run(cwd, [
    'context', created.task_id, '--history', 'timeline',
  ])
  assert.notEqual(humanHistory.status, 0)
  assert.match(humanHistory.stderr, /--history require --json/)

  const invalidHistory = run(cwd, [
    'context', created.task_id, '--json', '--history', 'raw',
  ])
  assert.notEqual(invalidHistory.status, 0)
  assert.match(invalidHistory.stderr, /--history must be timeline, events, or both/)
})

test('status keeps task writer state and caller capability independent', () => {
  function statusFor(mutator, actor = 'codex:session:test-session') {
    const cwd = temporaryDirectory()
    init(cwd)
    const created = checkpoint(cwd)
    const task = readTask(cwd, created.task_id)
    mutator(task)
    writeFileSync(taskPath(cwd, task.id), `${JSON.stringify(task, null, 2)}\n`)
    const result = run(cwd, ['context', task.id, '--json', '--status'], { actor })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout).task
  }

  const readOnlyLegacy = statusFor((task) => {
    delete task.primary_writer
    task.schema_version = 2
    delete task.min_writer_version
    delete task.profile
    delete task.provenance
    task.blocked = { reason: '等待', waiting_for: '用户', blocked_at: task.updated_at }
  }, '')
  assert.equal(readOnlyLegacy.writer.task_status, 'legacy_unclaimed')
  assert.equal(readOnlyLegacy.writer.caller_capability, 'read_only')
  assert.equal(readOnlyLegacy.writer.status, 'read_only_actor')
  assert.equal(readOnlyLegacy.next_action, 'read_only')

  const writableLegacy = statusFor((task) => {
    delete task.primary_writer
    task.schema_version = 2
    delete task.min_writer_version
    delete task.profile
    delete task.provenance
    task.blocked = { reason: '等待', waiting_for: '用户', blocked_at: task.updated_at }
  })
  assert.equal(writableLegacy.writer.task_status, 'legacy_unclaimed')
  assert.equal(writableLegacy.writer.caller_capability, 'writable')
  assert.equal(writableLegacy.next_action, 'claim')

  const upgradeRequired = statusFor((task) => {
    task.schema_version = 3
    delete task.min_writer_version
  })
  assert.equal(upgradeRequired.task_schema_version, 3)
  assert.equal(upgradeRequired.upgrade_required, true)
  assert.equal(upgradeRequired.writer.task_status, 'schema_upgrade_required')
  assert.equal(upgradeRequired.next_action, 'upgrade_v4')

  const mismatch = statusFor((task) => {
    task.blocked = { reason: '等待', waiting_for: '用户', blocked_at: task.updated_at }
  }, 'codex:session:other')
  assert.equal(mismatch.writer.status, 'writer_mismatch')
  assert.equal(mismatch.next_action, 'takeover')

  const blockedPrimary = statusFor((task) => {
    task.blocked = { reason: '等待', waiting_for: '用户', blocked_at: task.updated_at }
  })
  assert.equal(blockedPrimary.writer.status, 'primary_writer')
  assert.equal(blockedPrimary.next_action, 'unblock')
})

test('status derives phase, gate, and authorization actions after writer checks', () => {
  function statusFor(mutator) {
    const cwd = temporaryDirectory()
    init(cwd)
    const created = checkpoint(cwd)
    const task = readTask(cwd, created.task_id)
    mutator(task)
    writeFileSync(taskPath(cwd, task.id), `${JSON.stringify(task, null, 2)}\n`)
    const result = run(cwd, ['context', task.id, '--json', '--status'])
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout).task
  }

  assert.equal(statusFor((task) => {
    task.plan.open_questions = ['需要确认']
  }).next_action, 'resolve_open_questions')
  assert.equal(statusFor(() => {}).next_action, 'approve')

  const pending = statusFor((task) => {
    task.phase = 'dev'
    task.implementation_approval = {
      approved_plan_revision: task.plan_revision,
      approved_at: task.updated_at,
      source: 'user',
      reason: '已批准',
    }
  })
  assert.equal(pending.authorization.status, 'valid')
  assert.equal(pending.next_action, 'verify')

  const stale = statusFor((task) => {
    task.phase = 'check'
    task.plan_revision = 2
    task.implementation_approval = {
      approved_plan_revision: 1,
      approved_at: task.updated_at,
      source: 'user',
      reason: '旧批准',
    }
  })
  assert.equal(stale.authorization.status, 'stale')
  assert.equal(stale.next_action, 'verify')

  const ready = statusFor((task) => {
    task.phase = 'check'
    task.verification.gate.tests = {
      name: 'tests',
      kind: 'gate',
      command: ['pnpm', 'test'],
      status: 'pass',
      exit_code: 0,
      work_revision: task.work_revision,
      created_at: task.updated_at,
    }
  })
  assert.equal(ready.authorization.status, 'missing')
  assert.equal(ready.next_action, 'submit')

  assert.equal(statusFor((task) => {
    task.phase = 'review'
  }).next_action, 'review_or_archive')
})

test('context reports artifact Git delivery without treating ignored files as local knowledge', () => {
  const cwd = temporaryDirectory()
  spawnSync('git', ['init'], { cwd, encoding: 'utf8' })
  writeFileSync(join(cwd, '.gitignore'), 'ignored.md\n')
  writeFileSync(join(cwd, 'tracked.md'), 'tracked\n')
  writeFileSync(join(cwd, 'untracked.md'), 'untracked\n')
  writeFileSync(join(cwd, 'ignored.md'), 'ignored\n')
  spawnSync('git', ['add', '.gitignore', 'tracked.md'], { cwd, encoding: 'utf8' })
  init(cwd)
  const planFile = writePlan(cwd)
  const created = run(cwd, [
    'checkpoint', 'Artifact delivery', '--plan-file', planFile,
    '--artifact', 'doc:tracked.md',
    '--artifact', 'doc:untracked.md',
    '--artifact', 'doc:ignored.md',
    '--artifact', 'doc:missing.md',
    '--json',
  ])
  assert.equal(created.status, 0, created.stderr)
  const id = JSON.parse(created.stdout).task_id
  const context = JSON.parse(
    run(cwd, ['context', id, '--json', '--status']).stdout,
  )
  assert.deepEqual(
    Object.fromEntries(
      context.artifact_delivery.map((artifact) => [artifact.path, artifact.git_status]),
    ),
    {
      'tracked.md': 'tracked',
      'untracked.md': 'untracked',
      'ignored.md': 'ignored',
      'missing.md': 'missing',
    },
  )
  assert.match(context.warnings.join('\n'), /ignored\.md is ignored/)
  assert.doesNotMatch(context.warnings.join('\n'), /local knowledge/)
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
      stale_reason: 'work_revision_changed',
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

  const status = run(temporaryDirectory(), ['context', '--status'])
  assert.notEqual(status.status, 0)
  assert.match(status.stderr, /require --json/)
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

test('artifact add and remove support multiple values with save-compatible semantics', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const added = run(cwd, [
    'artifact', 'add', created.task_id,
    '--expect-revision', '1',
    'doc:docs/a.md',
    'skill:skills/example.md',
    'doc:docs/a.md',
    '--json',
  ])
  assert.equal(added.status, 0, added.stderr)
  assert.equal(JSON.parse(added.stdout).revision, 2)
  assert.deepEqual(readTask(cwd, created.task_id).artifacts, [
    { kind: 'doc', path: 'docs/a.md' },
    { kind: 'skill', path: 'skills/example.md' },
  ])

  const removed = run(cwd, [
    'artifact', 'remove', created.task_id,
    '--expect-revision', '2',
    'doc:docs/a.md',
    'doc:docs/missing.md',
    '--json',
  ])
  assert.equal(removed.status, 0, removed.stderr)
  assert.equal(JSON.parse(removed.stdout).revision, 3)
  assert.deepEqual(readTask(cwd, created.task_id).artifacts, [
    { kind: 'skill', path: 'skills/example.md' },
  ])

  const events = readFileSync(
    join(cwd, '.latch', 'tasks', created.task_id, 'events.jsonl'),
    'utf8',
  ).trim().split('\n').map(JSON.parse)
  assert.deepEqual(events.slice(-2).map((event) => event.type), [
    'artifact_updated',
    'artifact_updated',
  ])
  assert.deepEqual(events.at(-2).added, [
    'doc:docs/a.md',
    'skill:skills/example.md',
  ])
  assert.deepEqual(events.at(-1).removed, ['doc:docs/a.md'])

  const noOp = run(cwd, [
    'artifact', 'remove', created.task_id,
    '--expect-revision', '3',
    'doc:docs/missing.md',
  ])
  assert.notEqual(noOp.status, 0)
  assert.match(noOp.stderr, /did not contain any effective change/)
  assert.equal(readTask(cwd, created.task_id).revision, 3)
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
