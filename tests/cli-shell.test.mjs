import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  cleanupTemporaryDirectories,
  checkpoint,
  init,
  readTask,
  run,
  taskPath,
  temporaryDirectory,
} from './cli-test-support.mjs'

test.afterEach(cleanupTemporaryDirectories)

test('top-level and command help have no side effects', () => {
  for (const args of [
    [],
    ['--help'],
    ['checkpoint', '--help'],
    ['save', '--help'],
    ['approve', '--help'],
    ['verify-all', '--help'],
    ['reopen-review', '--help'],
    ['artifact', '--help'],
    ['record', '--help'],
    ['record', 'create', '--help'],
    ['submit', '--help'],
    ['done', '--help'],
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
  assert.doesNotMatch(checkpointHelp.stdout, /--scope-summary|--scope-path/)
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
  const approveHelp = run(temporaryDirectory(), ['approve', '--help']).stdout
  assert.match(
    approveHelp,
    /\(--reason <text> \| --authorization-file <path> \| --retrospective-file <path>\)/,
  )
  assert.match(
    approveHelp,
    /--feedback <text> \[--authorization-file <path>\]/,
  )
  assert.match(approveHelp, /--non-implementation-feedback <text>/)
  const contextHelp = run(temporaryDirectory(), ['context', '--help'])
  assert.match(contextHelp.stdout, /--status/)
  assert.match(contextHelp.stdout, /--since-revision/)
  assert.match(contextHelp.stdout, /--history <timeline\|events\|both>/)
  const submitHelp = run(temporaryDirectory(), ['submit', '--help']).stdout
  assert.match(submitHelp, /--verbose-warnings/)
  assert.match(submitHelp, /--unverified-item/)
  assert.doesNotMatch(submitHelp, /--unverified <summary>/)
  assert.match(run(temporaryDirectory(), ['done', '--help']).stdout, /--closeout-file/)
  assert.match(
    run(temporaryDirectory(), ['reopen-review', '--help']).stdout,
    /--reason <text>/,
  )
  const topHelp = run(temporaryDirectory(), ['--help']).stdout
  assert.doesNotMatch(topHelp, /upgrade-v4|downgrade-v2|claim <task-id>/)
})

test('approve rejects conflicting modes before reading or mutating a task', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd)
  const id = created.task_id
  const before = readFileSync(taskPath(cwd, id), 'utf8')
  const conflictingInputs = [
    ['--reason', 'approve plan', '--feedback', 'change implementation'],
    [
      '--reason',
      'approve plan',
      '--non-implementation-feedback',
      'wording only',
    ],
    [
      '--reason',
      'approve plan',
      '--authorization-file',
      'missing-authorization.json',
    ],
    [
      '--reason',
      'approve plan',
      '--retrospective-file',
      'missing-retrospective.json',
    ],
    [
      '--authorization-file',
      'missing-authorization.json',
      '--retrospective-file',
      'missing-retrospective.json',
    ],
    [
      '--authorization-file',
      'missing-authorization.json',
      '--non-implementation-feedback',
      'wording only',
    ],
    [
      '--retrospective-file',
      'missing-retrospective.json',
      '--feedback',
      'change implementation',
    ],
    [
      '--retrospective-file',
      'missing-retrospective.json',
      '--non-implementation-feedback',
      'wording only',
    ],
    [
      '--feedback',
      'change implementation',
      '--non-implementation-feedback',
      'wording only',
    ],
  ]

  for (const input of conflictingInputs) {
    const uninitializedRoot = temporaryDirectory()
    const beforeStore = run(uninitializedRoot, [
      'approve',
      'missing-task',
      '--expect-revision',
      '1',
      ...input,
      '--json',
    ])
    assert.notEqual(beforeStore.status, 0)
    assert.equal(JSON.parse(beforeStore.stderr).error.code, 'invalid_arguments')
    assert.equal(existsSync(join(uninitializedRoot, '.latch')), false)

    const result = run(cwd, [
      'approve',
      id,
      '--expect-revision',
      String(readTask(cwd, id).revision),
      ...input,
      '--json',
    ])
    assert.notEqual(result.status, 0)
    assert.equal(JSON.parse(result.stderr).error.code, 'invalid_arguments')
    assert.equal(readFileSync(taskPath(cwd, id), 'utf8'), before)
  }
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

test('uninitialized list returns a typed JSON error without side effects', () => {
  const roots = [
    { root: temporaryDirectory(), kind: 'non-Git directory' },
    { root: temporaryDirectory(), kind: 'Git repository' },
  ]
  const git = spawnSync('git', ['init', '-q'], {
    cwd: roots[1].root,
    encoding: 'utf8',
  })
  assert.equal(git.status, 0, git.stderr)

  for (const { root, kind } of roots) {
    const entriesBefore = readdirSync(root).sort()
    const result = run(root, ['list', '--json', '--brief'])

    assert.notEqual(result.status, 0, kind)
    const data = JSON.parse(result.stderr)
    assert.equal(data.schema_version, 2)
    assert.equal(data.error.code, 'not_initialized')
    assert.match(data.error.message, /Latch is not initialized from/)
    assert.deepEqual(readdirSync(root).sort(), entriesBefore)
    assert.equal(existsSync(join(root, '.latch')), false)
  }

  const human = run(roots[0].root, ['list'])
  assert.notEqual(human.status, 0)
  assert.match(human.stderr, /Run `latch init` in the project root/)
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
