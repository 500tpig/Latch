import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  cleanupTemporaryDirectories,
  init,
  plan,
  readTask,
  run,
  taskIds,
  temporaryDirectory,
  writePlan,
} from './cli-test-support.mjs'

test.afterEach(cleanupTemporaryDirectories)

function jsonInput(value, trailing = '\n') {
  return `${JSON.stringify(value)}${trailing}`
}

function authorization() {
  return {
    kind: 'implementation_authorization',
    source: 'user_request',
    reason: '用户授权 stdin fixture',
    scope: { summary: '验证 stdin fixture' },
  }
}

function retrospective() {
  return {
    kind: 'retrospective_record',
    reason: '记录 task 创建前已完成的 stdin fixture',
    implemented_before_task: true,
    scope_summary: 'stdin fixture',
  }
}

test('structured JSON stdin accepts one complete value and trailing whitespace', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const result = run(cwd, [
    'checkpoint', 'stdin plan', '--plan-file', '-', '--json',
  ], { input: jsonInput(plan({ verification_plan: [] }), ' \n\t') })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const output = JSON.parse(result.stdout)
  assert.equal(readTask(cwd, output.task_id).plan.goal, '实现 v2 CLI')
  assert.equal(existsSync(join(cwd, '-')), false)
})

test('checkpoint validates every stdin JSON input before creating a task', () => {
  for (const [name, input, message] of [
    ['empty', '', /input is empty/],
    ['malformed', '{', /Cannot parse --plan-file from stdin as JSON/],
    ['invalid plan', '{}', /Missing required plan fields/],
  ]) {
    const cwd = temporaryDirectory()
    init(cwd)
    const statePath = join(cwd, '.latch', 'state.json')
    const beforeState = readFileSync(statePath, 'utf8')
    const result = run(cwd, [
      'checkpoint', name, '--plan-file', '-', '--json',
    ], { input })

    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(JSON.parse(result.stderr).error.message, message)
    assert.deepEqual(taskIds(cwd), [])
    assert.equal(readFileSync(statePath, 'utf8'), beforeState)
  }
})

test('checkpoint rejects multiple stdin consumers before reading input', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const result = run(cwd, [
    'checkpoint', 'multiple stdin',
    '--plan-file', '-',
    '--authorization-file', '-',
    '--json',
  ])

  assert.notEqual(result.status, 0)
  const error = JSON.parse(result.stderr).error
  assert.equal(error.code, 'invalid_arguments')
  assert.match(error.message, /Only one structured JSON file option/)
  assert.deepEqual(taskIds(cwd), [])
})

test('authorization and retrospective file options accept stdin', () => {
  const authorizationRoot = temporaryDirectory()
  init(authorizationRoot)
  const authorizationPlan = writePlan(authorizationRoot, plan(), 'authorization-plan.json')
  const authorized = run(authorizationRoot, [
    'checkpoint', 'stdin authorization',
    '--plan-file', authorizationPlan,
    '--authorization-file', '-',
    '--json',
  ], { input: jsonInput(authorization()) })
  assert.equal(authorized.status, 0, authorized.stderr)
  assert.equal(JSON.parse(authorized.stdout).phase, 'dev')

  const retrospectiveRoot = temporaryDirectory()
  init(retrospectiveRoot)
  const retrospectivePlan = writePlan(
    retrospectiveRoot,
    plan({ verification_plan: [] }),
    'retrospective-plan.json',
  )
  const recorded = run(retrospectiveRoot, [
    'checkpoint', 'stdin retrospective',
    '--plan-file', retrospectivePlan,
    '--retrospective-file', '-',
    '--json',
  ], { input: jsonInput(retrospective()) })
  assert.equal(recorded.status, 0, recorded.stderr)
  assert.equal(JSON.parse(recorded.stdout).phase, 'dev')
})

test('knowledge impact and closeout file options accept stdin without temporary files', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const planFile = writePlan(cwd, plan({ verification_plan: [] }))
  const created = JSON.parse(run(cwd, [
    'checkpoint', 'stdin lifecycle', '--plan-file', planFile, '--json',
  ]).stdout)
  const approved = run(cwd, [
    'approve', created.task_id, '--expect-revision', '1',
    '--reason', '批准 stdin lifecycle', '--json',
  ])
  assert.equal(approved.status, 0, approved.stderr)
  const taskPath = join(cwd, '.latch', 'tasks', created.task_id, 'task.json')
  const eventsPath = join(cwd, '.latch', 'tasks', created.task_id, 'events.jsonl')
  const beforeInvalidImpact = [taskPath, eventsPath].map((path) =>
    readFileSync(path, 'utf8'))
  const invalidImpact = run(cwd, [
    'submit', created.task_id, '--expect-revision', '2',
    '--changes', '无效 stdin impact',
    '--no-verify', '--reason', 'plan 无 gate',
    '--knowledge-impact-file', '-', '--json',
  ], { input: '{}' })
  assert.notEqual(invalidImpact.status, 0)
  assert.equal(invalidImpact.stdout, '')
  assert.deepEqual(
    [taskPath, eventsPath].map((path) => readFileSync(path, 'utf8')),
    beforeInvalidImpact,
  )
  const submitted = run(cwd, [
    'submit', created.task_id, '--expect-revision', '2',
    '--changes', '验证 stdin lifecycle',
    '--no-verify', '--reason', 'plan 无 gate',
    '--knowledge-impact-file', '-', '--json',
  ], { input: jsonInput({ kind: 'none', reason: '不改变长期知识' }) })
  assert.equal(submitted.status, 0, submitted.stderr)

  const beforeInvalidCloseout = [taskPath, eventsPath].map((path) =>
    readFileSync(path, 'utf8'))
  const invalidCloseout = run(cwd, [
    'done', created.task_id, '--expect-revision', '3',
    '--closeout-file', '-', '--json',
  ], { input: '{}' })
  assert.notEqual(invalidCloseout.status, 0)
  assert.equal(invalidCloseout.stdout, '')
  assert.deepEqual(
    [taskPath, eventsPath].map((path) => readFileSync(path, 'utf8')),
    beforeInvalidCloseout,
  )
  assert.equal(
    readdirSync(join(cwd, '.latch', 'archive'), { recursive: true })
      .some((path) => String(path).includes(created.task_id)),
    false,
  )

  const done = run(cwd, [
    'done', created.task_id, '--expect-revision', '3',
    '--closeout-file', '-', '--json',
  ], { input: jsonInput({ resolutions: [] }) })
  assert.equal(done.status, 0, done.stderr)
  assert.equal(JSON.parse(done.stdout).archived, true)
})

test('context pack input file accepts stdin', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const result = run(cwd, [
    'context', 'pack', '--input-file', '-', '--json',
  ], { input: jsonInput({ sources: [] }) })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).sections, [])
})

test('benchmark file options each accept stdin and reject multiple consumers', () => {
  const cwd = temporaryDirectory()
  const benchmarkCase = JSON.parse(readFileSync(
    join(process.cwd(), 'benchmarks/context/cases/cross-file-cli.json'),
    'utf8',
  ))
  const mainRun = {
    case_id: 'cross-file-cli',
    path: 'context_pack',
    tool_steps_to_first_actionable: 3,
    chars_read: 600,
    estimated_tokens: 150,
    critical_hits: ['src/cli.ts', 'src/core/context-pack.ts'],
    critical_misses: [],
    wrong_doc: false,
    freshness_failures: 0,
  }
  const baselineRun = {
    ...mainRun,
    path: 'broad',
    tool_steps_to_first_actionable: 6,
    chars_read: 1000,
    estimated_tokens: 250,
  }
  writeFileSync(join(cwd, 'case.json'), jsonInput(benchmarkCase))
  writeFileSync(join(cwd, 'run.json'), jsonInput(mainRun))
  writeFileSync(join(cwd, 'baseline.json'), jsonInput(baselineRun))

  for (const [option, value] of [
    ['--case-file', benchmarkCase],
    ['--run-file', mainRun],
    ['--baseline-run-file', baselineRun],
  ]) {
    const paths = {
      '--case-file': 'case.json',
      '--run-file': 'run.json',
      '--baseline-run-file': 'baseline.json',
    }
    paths[option] = '-'
    const result = run(cwd, [
      'benchmark', 'context',
      '--case-file', paths['--case-file'],
      '--run-file', paths['--run-file'],
      '--baseline-run-file', paths['--baseline-run-file'],
      '--json',
    ], { input: jsonInput(value) })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).benchmark.pass_main, true)
  }

  const multiple = run(cwd, [
    'benchmark', 'context',
    '--case-file', '-', '--run-file', '-', '--json',
  ])
  assert.notEqual(multiple.status, 0)
  assert.equal(JSON.parse(multiple.stderr).error.code, 'invalid_arguments')
  assert.match(multiple.stderr, /Only one structured JSON file option/)
})

test('stdin plan is not represented as a workspace evidence path', () => {
  const cwd = temporaryDirectory()
  const git = (args) => spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(git(['init']).status, 0)
  assert.equal(git(['config', 'user.email', 'fixture@example.com']).status, 0)
  assert.equal(git(['config', 'user.name', 'Fixture']).status, 0)
  writeFileSync(join(cwd, '.gitignore'), '.latch/\n')
  writeFileSync(join(cwd, 'tracked.txt'), 'baseline\n')
  assert.equal(git(['add', '.gitignore', 'tracked.txt']).status, 0)
  assert.equal(git(['commit', '-m', 'baseline']).status, 0)
  init(cwd)
  const taskPlan = plan({
    workspace_scope: { paths: ['tracked.txt'] },
    verification_plan: [{
      name: 'read-file',
      command: [process.execPath, '-e', "require('node:fs').readFileSync('tracked.txt')"],
      kind: 'gate',
    }],
  })
  const created = run(cwd, [
    'checkpoint', 'stdin evidence', '--plan-file', '-', '--json',
  ], { input: jsonInput(taskPlan) })
  assert.equal(created.status, 0, created.stderr)
  const id = JSON.parse(created.stdout).task_id
  assert.equal(run(cwd, [
    'approve', id, '--expect-revision', '1', '--reason', '批准', '--json',
  ]).status, 0)
  const verified = run(cwd, [
    'verify', id, '--expect-revision', '2', '--name', 'read-file', '--json',
  ])
  assert.equal(verified.status, 0, verified.stderr)

  const evidenceDirectory = join(cwd, '.latch', 'tasks', id, 'evidence')
  const evidence = readdirSync(evidenceDirectory)
    .map((name) => readFileSync(join(evidenceDirectory, name), 'utf8'))
    .join('\n')
  assert.doesNotMatch(evidence, /"path"\s*:\s*"-"/)
})
