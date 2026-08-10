import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
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

test('checkpoint templates are side-effect-free shape scaffolds that require completion', () => {
  const lightExpected = {
    goal: 'Describe the intended outcome.',
    workspace_scope: { paths: [] },
    scope: [],
    acceptance: [],
    approach: [],
    verification_plan: [],
  }
  const standardExpected = {
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
    verification_plan: [{
      name: 'check',
      command: ['replace-with-real-command'],
      kind: 'gate',
    }],
    open_questions: [],
  }

  for (const [profile, expected] of [
    ['light', lightExpected],
    ['standard', standardExpected],
  ]) {
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
  const templateFile = writePlan(cwd, lightExpected, 'template.json')
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

  const completedLightPlan = {
    ...lightExpected,
    workspace_scope: { paths: ['src/cli.ts'] },
    scope: ['修改 src/cli.ts'],
    acceptance: ['CLI tests pass'],
    approach: ['使用现有 CLI 模式'],
    verification_plan: [{
      name: 'tests',
      command: [process.execPath, '-e', 'process.exit(0)'],
      kind: 'gate',
    }],
  }
  const completedFile = writePlan(
    cwd,
    completedLightPlan,
    'completed-template.json',
  )
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
  assert.deepEqual(task.plan, {
    ...completedLightPlan,
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: [],
    out_of_scope: [],
    open_questions: [],
  })

  const standardRejected = run(cwd, [
    'checkpoint',
    'Minimal Light input is not Standard',
    '--plan-file',
    completedFile,
    '--json',
  ])
  assert.notEqual(standardRejected.status, 0)
  assert.match(standardRejected.stderr, /Missing required plan fields/)
  assert.match(standardRejected.stderr, /plan\.api_assumptions/)
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
  assert.equal(firstTask.schema_version, 5)
  assert.equal(firstTask.min_writer_version, '0.5.0')
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

test('checkpoint rejects existing directory paths without a trailing slash before writing', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  mkdirSync(join(cwd, 'src', 'features', 'ui'), { recursive: true })
  writeFileSync(join(cwd, 'src', 'features', 'card.ts'), 'export {}\n')
  symlinkSync('ui', join(cwd, 'src', 'features', 'ui-link'))
  const statePath = join(cwd, '.latch', 'state.json')
  const stateBefore = readFileSync(statePath, 'utf8')

  const invalidPlan = plan({
    workspace_scope: { paths: ['src/features/ui'] },
  })
  const standard = run(cwd, [
    'checkpoint',
    'Invalid Standard directory scope',
    '--plan-file',
    writePlan(cwd, invalidPlan, 'invalid-standard-directory.json'),
    '--json',
  ])
  assert.notEqual(standard.status, 0)
  const envelope = JSON.parse(standard.stderr)
  assert.equal(envelope.schema_version, 2)
  assert.equal(envelope.error.code, 'command_failed')
  assert.match(envelope.error.message, /src\/features\/ui is an existing directory/)
  assert.match(envelope.error.message, /exact files/)
  assert.match(envelope.error.message, /src\/features\/ui\//)

  const light = run(cwd, [
    'checkpoint',
    'Invalid Light directory scope',
    '--plan-file',
    writePlan(cwd, invalidPlan, 'invalid-light-directory.json'),
    '--profile',
    'light',
  ])
  assert.notEqual(light.status, 0)
  assert.match(light.stderr, /src\/features\/ui is an existing directory/)
  assert.deepEqual(taskIds(cwd), [])
  assert.equal(readFileSync(statePath, 'utf8'), stateBefore)

  for (const [name, path] of [
    ['directory prefix', 'src/features/ui/'],
    ['exact file', 'src/features/card.ts'],
    ['missing path', 'src/features/future'],
    ['directory symlink', 'src/features/ui-link'],
  ]) {
    const result = run(cwd, [
      'checkpoint',
      `Valid ${name}`,
      '--plan-file',
      writePlan(
        cwd,
        plan({ workspace_scope: { paths: [path] } }),
        `valid-${name.replace(' ', '-')}.json`,
      ),
      '--json',
    ])
    assert.equal(result.status, 0, result.stderr)
  }
  assert.equal(taskIds(cwd).length, 4)
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
