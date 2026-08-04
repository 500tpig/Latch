import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const currentCli = join(process.cwd(), 'dist', 'cli.js')
const actor = 'codex:session:schema4-compat'
const temporaryDirectories = []

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function runCli(cli, cwd, args, commandActor = actor) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LATCH_ACTOR: commandActor },
  })
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function directoryChecksums(directory, prefix = '') {
  const checksums = {}
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      Object.assign(checksums, directoryChecksums(path, relativePath))
    else if (entry.isFile())
      checksums[relativePath] = sha256(path)
  }
  return checksums
}

function buildLegacyCli(sourceRef, expectedVersion) {
  const extractionRoot = temporaryDirectory(`latch-schema4-${expectedVersion}-`)
  const archivePath = join(extractionRoot, 'source.tar')
  const sourceRoot = join(extractionRoot, 'source')
  mkdirSync(sourceRoot)
  const archived = spawnSync(
    'git',
    ['archive', '--format=tar', '-o', archivePath, sourceRef],
    { cwd: process.cwd(), encoding: 'utf8' },
  )
  assert.equal(archived.status, 0, archived.stderr)
  const extracted = spawnSync('tar', ['-xf', archivePath, '-C', sourceRoot], {
    encoding: 'utf8',
  })
  assert.equal(extracted.status, 0, extracted.stderr)
  symlinkSync(join(process.cwd(), 'node_modules'), join(sourceRoot, 'node_modules'))
  const built = spawnSync(
    join(process.cwd(), 'node_modules', '.bin', 'tsc'),
    [],
    { cwd: sourceRoot, encoding: 'utf8' },
  )
  assert.equal(built.status, 0, built.stderr || built.stdout)
  const packageJson = JSON.parse(
    readFileSync(join(sourceRoot, 'package.json'), 'utf8'),
  )
  assert.equal(packageJson.version, expectedVersion)
  return join(sourceRoot, 'dist', 'cli.js')
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function assertRunnerBoundary(sourceRef, expectedVersion) {
  const legacyCli = buildLegacyCli(sourceRef, expectedVersion)
  const cwd = temporaryDirectory(`latch-schema4-workspace-${expectedVersion}-`)
  runGit(cwd, ['init', '-q'])
  runGit(cwd, ['config', 'user.email', 'latch-test@example.invalid'])
  runGit(cwd, ['config', 'user.name', 'Latch Test'])
  const initialized = runCli(currentCli, cwd, ['init'])
  assert.equal(initialized.status, 0, initialized.stderr)
  const planPath = join(cwd, 'plan.json')
  writeFileSync(planPath, `${JSON.stringify({
    goal: '验证旧 writer 拒写',
    workspace_scope: { paths: ['plan.json'] },
    scope: ['plan.json'],
    acceptance: ['0.4.0 cannot write schema 5'],
    approach: ['pin the immutable source baseline'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: [],
    out_of_scope: [],
    verification_plan: [{
      name: 'proof',
      command: [process.execPath, '-e', 'process.exit(0)'],
      kind: 'gate',
    }],
    open_questions: [],
  }, null, 2)}\n`)
  runGit(cwd, ['add', 'plan.json'])
  runGit(cwd, ['commit', '-q', '-m', 'fixture'])
  const checkpoint = runCli(currentCli, cwd, [
    'checkpoint',
    'schema 5 compatibility',
    '--plan-file',
    planPath,
    '--json',
  ])
  assert.equal(checkpoint.status, 0, checkpoint.stderr)
  const id = JSON.parse(checkpoint.stdout).task_id
  const directory = join(cwd, '.latch', 'tasks', id)
  const taskPath = join(directory, 'task.json')

  const approval = runCli(currentCli, cwd, [
    'approve',
    id,
    '--expect-revision',
    '1',
    '--reason',
    'prepare a workspace evidence fixture',
    '--json',
  ])
  assert.equal(approval.status, 0, approval.stderr)
  const verification = runCli(currentCli, cwd, [
    'verify',
    id,
    '--expect-revision',
    '2',
    '--name',
    'proof',
    '--json',
  ])
  assert.equal(
    verification.status,
    0,
    `stderr: ${verification.stderr}\nstdout: ${verification.stdout}`,
  )

  const candidateTask = JSON.parse(readFileSync(taskPath, 'utf8'))
  assert.equal(candidateTask.schema_version, 5)
  assert.equal(candidateTask.min_writer_version, '0.5.0')
  const before = directoryChecksums(directory)
  assert.equal(
    Object.keys(before).some((path) => path.startsWith('evidence/')),
    true,
  )

  const rejectedMutations = [
    {
      args: [
        'save',
        id,
        '--expect-revision',
        '3',
        '--decision',
        'old writer must not append this',
        '--json',
      ],
      commandActor: actor,
    },
    {
      args: [
        'approve',
        id,
        '--expect-revision',
        '3',
        '--reason',
        'old approval must not write',
        '--json',
      ],
      commandActor: actor,
    },
    {
      args: [
        'takeover',
        id,
        '--expect-revision',
        '3',
        '--reason',
        'old takeover must not write',
        '--json',
      ],
      commandActor: 'codex:session:legacy-takeover',
    },
    {
      args: [
        'abandon',
        id,
        '--expect-revision',
        '3',
        '--reason',
        'old archive must not write',
        '--json',
      ],
      commandActor: actor,
    },
  ]
  for (const { args, commandActor } of rejectedMutations) {
    const rejected = runCli(legacyCli, cwd, args, commandActor)
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /Unsupported or invalid Latch task schema/)
    assert.deepEqual(directoryChecksums(directory), before)
  }

  const schema4Cwd = temporaryDirectory('latch-schema4-candidate-rejection-')
  const initializedSchema4 = runCli(legacyCli, schema4Cwd, ['init'])
  assert.equal(initializedSchema4.status, 0, initializedSchema4.stderr)
  const schema4Plan = join(schema4Cwd, 'plan.json')
  writeFileSync(schema4Plan, readFileSync(planPath))
  const schema4Checkpoint = runCli(legacyCli, schema4Cwd, [
    'checkpoint', 'schema 4 implementation', '--plan-file', schema4Plan, '--json',
  ])
  assert.equal(schema4Checkpoint.status, 0, schema4Checkpoint.stderr)
  const schema4Id = JSON.parse(schema4Checkpoint.stdout).task_id
  const schema4Directory = join(schema4Cwd, '.latch', 'tasks', schema4Id)
  const schema4Before = directoryChecksums(schema4Directory)
  for (const args of [
    ['save', schema4Id, '--expect-revision', '1', '--decision', 'candidate must refuse', '--json'],
    ['approve', schema4Id, '--expect-revision', '1', '--reason', 'candidate must refuse', '--json'],
    ['abandon', schema4Id, '--expect-revision', '1', '--reason', 'candidate must refuse', '--json'],
  ]) {
    const rejected = runCli(currentCli, schema4Cwd, args)
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /requires its matching runner for schema_version 4/)
    assert.deepEqual(directoryChecksums(schema4Directory), schema4Before)
  }
}

test('schema 4 and schema 5 runners reject the opposite task schema before mutation', () => {
  assertRunnerBoundary('35e6ff0f3fedc4753c04d8a599075c1d0621f411', '0.4.0')
})
