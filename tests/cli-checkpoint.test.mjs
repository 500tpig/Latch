import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  CHECKPOINT_PLAN_ERROR_BYTE_BUDGET,
  CheckpointPlanInputError,
  checkpointPlanErrorEnvelope,
} from '../dist/commands/checkpoint-plan-error.js'
import {
  cleanupTemporaryDirectories,
  checkpoint,
  init,
  plan,
  readTask,
  run,
  taskIds,
  temporaryDirectory,
  writePlan,
} from './cli-test-support.mjs'

test.afterEach(cleanupTemporaryDirectories)

function latchTreeSnapshot(cwd) {
  const root = join(cwd, '.latch')
  const snapshot = []
  function visit(directory, prefix = '') {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        snapshot.push([relative, 'directory'])
        visit(path, relative)
      } else if (entry.isSymbolicLink()) {
        snapshot.push([relative, 'symlink', readlinkSync(path)])
      } else {
        snapshot.push([
          relative,
          'file',
          readFileSync(path).toString('base64'),
        ])
      }
    }
  }
  visit(root)
  return snapshot
}

test('checkpoint templates are side-effect-free shape scaffolds that require completion', () => {
  const lightExpected = {
    goal: 'Describe the intended outcome.',
    workspace_scope: { paths: [] },
    scope: [],
    acceptance: [],
    approach: [],
    verification_plan: [{
      name: 'check',
      command: ['replace-with-real-command'],
      kind: 'gate',
    }],
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

  const standardDraftRoot = temporaryDirectory()
  init(standardDraftRoot)
  const standardTemplateFile = writePlan(
    standardDraftRoot,
    standardExpected,
    'standard-template.json',
  )
  const standardDraft = run(standardDraftRoot, [
    'checkpoint',
    'Standard template draft',
    '--plan-file',
    standardTemplateFile,
    '--json',
  ])
  assert.equal(standardDraft.status, 0, standardDraft.stderr)
  assert.equal(
    readTask(
      standardDraftRoot,
      JSON.parse(standardDraft.stdout).task_id,
    ).phase,
    'plan',
  )

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

  const latchBeforeDenied = latchTreeSnapshot(cwd)
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
  const deniedEnvelope = JSON.parse(denied.stderr)
  assert.equal(deniedEnvelope.error.code, 'invalid_arguments')
  assert.equal(deniedEnvelope.error.category, 'plan_validation')
  assert.deepEqual(deniedEnvelope.error.issues.sample[0], {
    path: '/workspace_scope/paths',
    reason: 'non_empty_required',
    expected: 'non_empty_repo_relative_posix_path_array',
  })
  assert.deepEqual(deniedEnvelope.error.retry, {
    command: 'checkpoint',
    input: '--plan-file',
  })
  assert.deepEqual(deniedEnvelope.next_action, {
    kind: 'stop',
    reason: 'invalid_task_state',
  })
  assert.equal(taskIds(cwd).length, 1)
  assert.deepEqual(latchTreeSnapshot(cwd), latchBeforeDenied)

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
  const sentinelFile = writePlan(
    cwd,
    {
      ...completedLightPlan,
      verification_plan: [{
        name: 'tests',
        command: [
          process.execPath,
          '-e',
          'process.exit(0)',
          'replace-with-real-command',
        ],
        kind: 'gate',
      }],
    },
    'sentinel-template.json',
  )
  const taskCountBeforeSentinel = taskIds(cwd).length
  const latchBeforeSentinel = latchTreeSnapshot(cwd)
  const sentinelDenied = run(cwd, [
    'checkpoint',
    'Sentinel authorization denied',
    '--plan-file',
    sentinelFile,
    '--authorize-request',
    '用户请求执行明确的低风险变更',
    '--json',
  ])
  assert.notEqual(sentinelDenied.status, 0)
  assert.match(sentinelDenied.stderr, /replace-with-real-command/)
  const sentinelEnvelope = JSON.parse(sentinelDenied.stderr)
  assert.equal(sentinelEnvelope.error.code, 'invalid_arguments')
  assert.deepEqual(sentinelEnvelope.error.issues.sample[0], {
    path: '/verification_plan/0/command',
    reason: 'sentinel_not_replaced',
    expected: 'real_command_argv',
  })
  assert.equal(taskIds(cwd).length, taskCountBeforeSentinel)
  assert.deepEqual(latchTreeSnapshot(cwd), latchBeforeSentinel)

  const noGateFile = writePlan(
    cwd,
    {
      ...completedLightPlan,
      verification_plan: [{
        name: 'diagnostic',
        command: [process.execPath, '-e', 'process.exit(0)'],
        kind: 'diagnostic',
      }],
    },
    'no-gate-template.json',
  )
  const latchBeforeNoGate = latchTreeSnapshot(cwd)
  const noGateDenied = run(cwd, [
    'checkpoint',
    'No gate authorization denied',
    '--plan-file',
    noGateFile,
    '--authorize-request',
    '用户请求执行明确的低风险变更',
    '--json',
  ])
  assert.notEqual(noGateDenied.status, 0)
  assert.deepEqual(
    JSON.parse(noGateDenied.stderr).error.issues.sample[0],
    {
      path: '/verification_plan',
      reason: 'gate_required',
      expected: 'verification_plan_with_gate',
    },
  )
  assert.equal(taskIds(cwd).length, taskCountBeforeSentinel)
  assert.deepEqual(latchTreeSnapshot(cwd), latchBeforeNoGate)

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
  assert.equal(firstData.schema_version, 3)
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

test('checkpoint persists only an explicitly supplied group id', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const planFile = writePlan(cwd, plan({
    workspace_scope: { paths: ['src/shared.ts'] },
  }), 'group-plan.json')
  const explicit = run(cwd, [
    'checkpoint',
    'Explicit group task',
    '--plan-file',
    planFile,
    '--group',
    'Wave:Explicit',
    '--json',
  ])
  assert.equal(explicit.status, 0, explicit.stderr)
  const explicitTask = readTask(cwd, JSON.parse(explicit.stdout).task_id)
  assert.equal(explicitTask.group_id, 'Wave:Explicit')

  const inferred = run(cwd, [
    'checkpoint',
    'Overlapping ungrouped task',
    '--plan-file',
    planFile,
    '--json',
  ])
  assert.equal(inferred.status, 0, inferred.stderr)
  const inferredTask = readTask(cwd, JSON.parse(inferred.stdout).task_id)
  assert.equal('group_id' in inferredTask, false)
})

test('lifecycle phase rejections expose the stable phase_mismatch code', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const { task_id: id } = checkpoint(cwd)
  const approved = run(cwd, [
    'approve', id, '--expect-revision', '1',
    '--reason', '批准 fixture', '--json',
  ])
  assert.equal(approved.status, 0, approved.stderr)

  const rejected = run(cwd, [
    'approve', id, '--expect-revision', '2',
    '--reason', '重复批准', '--json',
  ])
  assert.notEqual(rejected.status, 0)
  const envelope = JSON.parse(rejected.stderr)
  assert.equal(envelope.error.code, 'phase_mismatch')
  assert.match(envelope.error.message, /Cannot approve task in phase dev/)
})

test('checkpoint rejects missing or invalid plan without creating task', () => {
  const cwd = temporaryDirectory()
  init(cwd)

  const missing = run(cwd, ['checkpoint', 'Missing plan'])
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /--plan-file is required/)
  assert.deepEqual(taskIds(cwd), [])

  const invalidPlan = writePlan(cwd, { goal: 'incomplete' }, 'invalid.json')
  const latchBeforeInvalid = latchTreeSnapshot(cwd)
  const invalid = run(cwd, [
    'checkpoint',
    'Invalid plan',
    '--plan-file',
    invalidPlan,
    '--json',
  ])
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /Missing required plan fields/)
  assert.match(invalid.stderr, /plan\.scope/)
  assert.match(invalid.stderr, /Expected schema/)
  assert.match(invalid.stderr, /Minimal legal plan/)
  const invalidEnvelope = JSON.parse(invalid.stderr)
  assert.equal(invalidEnvelope.error.code, 'invalid_arguments')
  assert.equal(invalidEnvelope.error.category, 'plan_validation')
  assert.equal(invalidEnvelope.error.message_truncated, true)
  assert.deepEqual(invalidEnvelope.error.issues.sample[0], {
    path: '/scope',
    reason: 'required',
    expected: 'string_array',
    minimal_legal_value: [],
  })
  assert.deepEqual(latchTreeSnapshot(cwd), latchBeforeInvalid)

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
  assert.equal(invalidScopeEnvelope.schema_version, 3)
  assert.equal(invalidScopeEnvelope.error.code, 'invalid_arguments')
  assert.deepEqual(invalidScopeEnvelope.error.issues.sample[0], {
    path: '/scope',
    reason: 'type_mismatch',
    expected: 'string_array',
    actual_type: 'string',
    minimal_legal_value: [],
  })
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
    '--json',
  ])
  assert.notEqual(invalidCommand.status, 0)
  const invalidCommandEnvelope = JSON.parse(invalidCommand.stderr)
  assert.match(
    invalidCommandEnvelope.error.message,
    /Invalid verification_plan\.command/,
  )
  assert.match(invalidCommandEnvelope.error.message, /expected string\[\]/)
  assert.match(invalidCommandEnvelope.error.message, /got string/)
  assert.match(
    invalidCommandEnvelope.error.message,
    /Minimal legal value: \["replace-with-real-command"\]/,
  )
  assert.deepEqual(
    invalidCommandEnvelope.error.issues.sample[0],
    {
      path: '/verification_plan/0/command',
      reason: 'type_mismatch',
      expected: 'non_empty_string_array',
      actual_type: 'string',
      minimal_legal_value: ['replace-with-real-command'],
    },
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
    '--json',
  ])
  assert.notEqual(invalidKind.status, 0)
  const invalidKindMessage = JSON.parse(invalidKind.stderr).error.message
  assert.equal(
    invalidKindMessage,
    `Invalid verification_plan.kind in ${invalidKindPlan}: expected "gate" | "diagnostic", got string. ` +
      'Minimal legal value: "gate". ' +
      'Run `latch checkpoint --print-plan-template light` or ' +
      '`latch checkpoint --print-plan-template standard` for a shape-valid scaffold.',
  )

  const combinedInvalidPlan = writePlan(
    cwd,
    plan({
      verification_plan: [{
        name: '',
        command: 'pnpm check',
        kind: 'check',
      }],
    }),
    'combined-invalid-verification.json',
  )
  const combinedInvalid = run(cwd, [
    'checkpoint',
    'Combined verification errors',
    '--plan-file',
    combinedInvalidPlan,
    '--json',
  ])
  assert.notEqual(combinedInvalid.status, 0)
  const combinedMessage = JSON.parse(combinedInvalid.stderr).error.message
  assert.match(combinedMessage, /Invalid verification_plan\.name/)
  assert.match(combinedMessage, /Invalid verification_plan\.command/)
  assert.match(combinedMessage, /Invalid verification_plan\.kind/)
  assert.match(combinedMessage, /expected non-empty string/)
  assert.match(combinedMessage, /expected string\[\]/)
  assert.match(combinedMessage, /expected "gate" \| "diagnostic"/)
  assert.ok(
    combinedMessage.indexOf('Invalid verification_plan.name') <
      combinedMessage.indexOf('Invalid verification_plan.command'),
  )
  assert.ok(
    combinedMessage.indexOf('Invalid verification_plan.command') <
      combinedMessage.indexOf('Invalid verification_plan.kind'),
  )
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
  const latchBefore = latchTreeSnapshot(cwd)

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
  assert.equal(envelope.schema_version, 3)
  assert.equal(envelope.error.code, 'invalid_arguments')
  assert.deepEqual(envelope.error.issues.sample[0], {
    path: '/workspace_scope/paths/0',
    reason: 'directory_suffix_required',
    expected: 'repo_relative_posix_directory_prefix',
    actual_type: 'string',
    actual_value: 'src/features/ui',
    minimal_legal_value: 'src/features/ui/',
  })
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
  assert.deepEqual(latchTreeSnapshot(cwd), latchBefore)

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

test('checkpoint plan error envelope is bounded and truncates issues deterministically', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const statePath = join(cwd, '.latch', 'state.json')
  const stateBefore = readFileSync(statePath, 'utf8')
  const latchBefore = latchTreeSnapshot(cwd)
  const invalidVerificationPlan = Array.from({ length: 20 }, () => ({
    name: '',
    command: 'pnpm check',
    kind: 'check',
  }))
  const result = run(cwd, [
    'checkpoint',
    'Bounded plan error',
    '--plan-file',
    writePlan(
      cwd,
      plan({ verification_plan: invalidVerificationPlan }),
      'bounded-plan-error.json',
    ),
    '--json',
  ])

  assert.notEqual(result.status, 0)
  assert.ok(Buffer.byteLength(result.stderr, 'utf8') <= 4096)
  const envelope = JSON.parse(result.stderr)
  assert.equal(envelope.error.code, 'invalid_arguments')
  assert.equal(envelope.error.category, 'plan_validation')
  assert.equal(envelope.error.issues.total, 60)
  assert.equal(envelope.error.issues.sample_limit, 8)
  assert.equal(envelope.error.issues.returned_count, 8)
  assert.equal(envelope.error.issues.sample.length, 8)
  assert.equal(envelope.error.issues.truncated, true)
  assert.equal(envelope.error.truncated, true)
  assert.equal(envelope.error.message_truncated, true)
  assert.deepEqual(taskIds(cwd), [])
  assert.equal(readFileSync(statePath, 'utf8'), stateBefore)
  assert.deepEqual(latchTreeSnapshot(cwd), latchBefore)
})

test('checkpoint plan error bounds multibyte actual values on UTF-8 boundaries', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const latchBefore = latchTreeSnapshot(cwd)
  const invalidPath = `${'界'.repeat(300)}*`
  const result = run(cwd, [
    'checkpoint',
    'UTF-8 plan error',
    '--plan-file',
    writePlan(
      cwd,
      plan({ workspace_scope: { paths: [invalidPath] } }),
      'utf8-plan-error.json',
    ),
    '--json',
  ])

  assert.notEqual(result.status, 0)
  assert.ok(Buffer.byteLength(result.stderr, 'utf8') <= 4096)
  const issue = JSON.parse(result.stderr).error.issues.sample[0]
  assert.equal(issue.path, '/workspace_scope/paths/0')
  assert.equal(issue.reason, 'invalid_value')
  assert.equal(issue.expected, 'repo_relative_posix_path')
  assert.equal(issue.actual_type, 'string')
  assert.equal(issue.actual_value_truncated, true)
  assert.ok(Buffer.byteLength(issue.actual_value, 'utf8') <= 256)
  assert.doesNotMatch(issue.actual_value, /\uFFFD/)
  assert.deepEqual(latchTreeSnapshot(cwd), latchBefore)
})

test('checkpoint plan error has an absolute final budget fallback', () => {
  const error = new CheckpointPlanInputError('界'.repeat(10_000), [{
    path: `/${'path'.repeat(3_000)}`,
    reason: 'type_mismatch',
    expected: 'expected'.repeat(3_000),
    actual_type: 'string',
    actual_value: '值'.repeat(3_000),
    minimal_legal_value: '最小值'.repeat(3_000),
  }])
  const envelope = checkpointPlanErrorEnvelope({
    schema_version: 3,
    generated_at: '2026-08-18T00:00:00.000Z',
    next_action: { kind: 'stop', reason: 'invalid_task_state' },
  }, error)

  assert.ok(
    Buffer.byteLength(`${JSON.stringify(envelope, null, 2)}\n`, 'utf8') <=
      CHECKPOINT_PLAN_ERROR_BYTE_BUDGET,
  )
  assert.equal(envelope.error.issues.returned_count, 0)
  assert.equal(envelope.error.issues.truncated, true)
  assert.equal(envelope.error.truncated, true)
  assert.equal(envelope.error.message_truncated, true)
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
