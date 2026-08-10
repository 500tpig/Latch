import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  captureWorkspaceSnapshot,
  compareWorkspaceScopeContent,
  compareWorkspaceSnapshots,
  parseGitStatusPorcelainV2,
  pathInWorkspaceScope,
  readWorkspaceEvidence,
  workspaceScopeDescendantCandidate,
  writeWorkspaceEvidence,
} from '../dist/core/workspace-evidence.js'
import { assertWritableTaskPlan } from '../dist/core/plan-schema.js'

const cli = join(process.cwd(), 'dist/cli.js')
const actor = 'codex:session:workspace-evidence'
const temporaryDirectories = []

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

function temporaryRepo() {
  const cwd = mkdtempSync(join(tmpdir(), 'latch-workspace-evidence-'))
  temporaryDirectories.push(cwd)
  git(cwd, ['init'])
  git(cwd, ['config', 'user.email', 'fixture@example.com'])
  git(cwd, ['config', 'user.name', 'Fixture'])
  writeFileSync(join(cwd, '.gitignore'), '.latch/\nignored.txt\nignored-tree/\n')
  writeFileSync(join(cwd, 'tracked.txt'), 'baseline\n')
  writeFileSync(join(cwd, 'outside.txt'), 'outside\n')
  symlinkSync('tracked.txt', join(cwd, 'link.txt'))
  git(cwd, ['add', '.gitignore', 'tracked.txt', 'outside.txt', 'link.txt'])
  git(cwd, ['commit', '-m', 'baseline'])
  return cwd
}

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LATCH_ACTOR: actor },
  })
}

function plan(commands, scopePaths = ['tracked.txt']) {
  return {
    goal: '验证 workspace proof',
    workspace_scope: { paths: scopePaths },
    scope: ['workspace mutation fixture'],
    acceptance: ['proof 状态符合 mutation 结果'],
    approach: ['运行真实 gate argv'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['approve -> verify -> submit'],
    out_of_scope: [],
    verification_plan: commands.map(({ name, command }) => ({
      name,
      command,
      kind: 'gate',
    })),
    open_questions: [],
  }
}

function createTask(cwd, taskPlan) {
  const initialized = run(cwd, ['init'])
  assert.equal(initialized.status, 0, initialized.stderr)
  const planPath = join(cwd, '.latch', 'plan.json')
  writeFileSync(planPath, `${JSON.stringify(taskPlan, null, 2)}\n`)
  const created = run(cwd, [
    'checkpoint', 'workspace proof fixture',
    '--plan-file', '.latch/plan.json', '--json',
  ])
  assert.equal(created.status, 0, created.stderr)
  const id = JSON.parse(created.stdout).task_id
  const approved = run(cwd, [
    'approve', id, '--expect-revision', '1',
    '--reason', '批准 fixture', '--json',
  ])
  assert.equal(approved.status, 0, approved.stderr)
  return id
}

function taskPath(cwd, id) {
  return join(cwd, '.latch', 'tasks', id, 'task.json')
}

function readTask(cwd, id) {
  return JSON.parse(readFileSync(taskPath(cwd, id), 'utf8'))
}

function revision(cwd, id) {
  return String(readTask(cwd, id).revision)
}

function verify(cwd, id, name) {
  return run(cwd, [
    'verify', id, '--expect-revision', revision(cwd, id),
    '--name', name, '--json',
  ])
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('snapshot captures clean, dirty, staged, untracked, delete, mode, symlink, rename, and explicit ignored evidence', () => {
  const cwd = temporaryRepo()
  const scope = {
    paths: [
      'tracked.txt',
      'staged.txt',
      'untracked.txt',
      'deleted.txt',
      'renamed.txt',
      'mode.txt',
      'link.txt',
      'ignored.txt',
    ],
  }
  const clean = captureWorkspaceSnapshot(cwd, scope)
  assert.equal(clean.complete, true)
  assert.equal(clean.entries.length, 1)
  assert.equal(clean.entries[0].path, 'ignored.txt')
  assert.equal(clean.entries[0].exists, false)
  assert.equal(
    clean.scope_entries.find((entry) => entry.path === 'tracked.txt').exists,
    true,
  )

  for (const name of ['staged.txt', 'deleted.txt', 'rename-source.txt', 'mode.txt'])
    writeFileSync(join(cwd, name), `${name}\n`)
  git(cwd, ['add', 'staged.txt', 'deleted.txt', 'rename-source.txt', 'mode.txt'])
  git(cwd, ['commit', '-m', 'more baseline'])

  writeFileSync(join(cwd, 'staged.txt'), 'staged changed\n')
  git(cwd, ['add', 'staged.txt'])
  writeFileSync(join(cwd, 'tracked.txt'), 'dirty\n')
  writeFileSync(join(cwd, 'untracked.txt'), 'untracked\n')
  unlinkSync(join(cwd, 'deleted.txt'))
  git(cwd, ['mv', 'rename-source.txt', 'renamed.txt'])
  chmodSync(join(cwd, 'mode.txt'), 0o755)
  unlinkSync(join(cwd, 'link.txt'))
  symlinkSync('outside.txt', join(cwd, 'link.txt'))
  writeFileSync(join(cwd, 'ignored.txt'), 'ignored\n')

  const snapshot = captureWorkspaceSnapshot(cwd, scope)
  assert.equal(snapshot.complete, true, snapshot.error)
  const paths = snapshot.entries.map((entry) => entry.path)
  for (const expected of [
    'deleted.txt',
    'ignored.txt',
    'link.txt',
    'mode.txt',
    'renamed.txt',
    'staged.txt',
    'tracked.txt',
    'untracked.txt',
  ])
    assert.ok(paths.includes(expected), expected)
  assert.equal(
    snapshot.entries.find((entry) => entry.path === 'link.txt').file_type,
    'symlink',
  )
  assert.equal(
    snapshot.entries.find((entry) => entry.path === 'ignored.txt').source,
    'workspace_scope',
  )
  assert.equal(snapshot.coverage.ignored_tree, false)
})

test('snapshot detects dirty content and staged index changes with stable status tuples', () => {
  const cwd = temporaryRepo()
  const scope = { paths: ['tracked.txt', 'untracked.txt'] }
  writeFileSync(join(cwd, 'tracked.txt'), 'dirty one\n')
  const dirtyBefore = captureWorkspaceSnapshot(cwd, scope)
  writeFileSync(join(cwd, 'tracked.txt'), 'dirty two\n')
  const dirtyAfter = captureWorkspaceSnapshot(cwd, scope)
  const dirtyDelta = compareWorkspaceSnapshots(dirtyBefore, dirtyAfter, scope)
  assert.equal(dirtyDelta.status, 'in_scope_mutation')
  assert.equal(dirtyDelta.changes[0].change, 'content_changed')

  git(cwd, ['add', 'tracked.txt'])
  const stagedBefore = captureWorkspaceSnapshot(cwd, scope)
  writeFileSync(join(cwd, 'tracked.txt'), 'staged two\n')
  git(cwd, ['add', 'tracked.txt'])
  const stagedAfter = captureWorkspaceSnapshot(cwd, scope)
  const stagedDelta = compareWorkspaceSnapshots(stagedBefore, stagedAfter, scope)
  assert.equal(stagedDelta.status, 'in_scope_mutation')
  assert.equal(stagedDelta.changes[0].change, 'content_changed')
  assert.equal(stagedDelta.changes[0].category, 'content')

  writeFileSync(join(cwd, 'untracked.txt'), 'one\n')
  const untrackedBefore = captureWorkspaceSnapshot(cwd, scope)
  writeFileSync(join(cwd, 'untracked.txt'), 'two\n')
  const untrackedAfter = captureWorkspaceSnapshot(cwd, scope)
  const untrackedDelta = compareWorkspaceSnapshots(
    untrackedBefore,
    untrackedAfter,
    scope,
  )
  assert.equal(untrackedDelta.status, 'in_scope_mutation')
  assert.equal(
    untrackedDelta.changes.find((change) => change.path === 'untracked.txt').change,
    'content_changed',
  )
})

test('scope content comparison ignores ambient and Git delivery changes but detects content changes', () => {
  const cwd = temporaryRepo()
  const scope = { paths: ['tracked.txt'] }
  writeFileSync(join(cwd, 'tracked.txt'), 'implementation\n')
  const baseline = captureWorkspaceSnapshot(cwd, scope)

  writeFileSync(join(cwd, 'outside.txt'), 'ambient\n')
  const ambient = captureWorkspaceSnapshot(cwd, scope)
  assert.equal(
    compareWorkspaceScopeContent(baseline, ambient, scope).status,
    'unchanged',
  )
  assert.equal(
    compareWorkspaceSnapshots(baseline, ambient, scope).status,
    'out_of_scope_mutation',
  )

  git(cwd, ['add', 'tracked.txt'])
  const staged = captureWorkspaceSnapshot(cwd, scope)
  const stagedDelta = compareWorkspaceSnapshots(ambient, staged, scope)
  assert.equal(stagedDelta.changes[0].category, 'index_content')
  assert.equal(
    compareWorkspaceScopeContent(ambient, staged, scope).status,
    'unchanged',
  )

  git(cwd, ['commit', '-m', 'deliver implementation'])
  const committed = captureWorkspaceSnapshot(cwd, scope)
  assert.equal(
    compareWorkspaceScopeContent(staged, committed, scope).status,
    'unchanged',
  )

  writeFileSync(join(cwd, 'tracked.txt'), 'changed implementation\n')
  const changed = compareWorkspaceScopeContent(
    committed,
    captureWorkspaceSnapshot(cwd, scope),
    scope,
  )
  assert.equal(changed.status, 'in_scope_mutation')
  assert.equal(changed.changes[0].category, 'content')
})

test('porcelain parser preserves rename origins and submodule state', () => {
  const hash = 'a'.repeat(40)
  const parsed = parseGitStatusPorcelainV2(
    `2 R. N... 100644 100644 100644 ${hash} ${hash} R100 new name.txt\0old name.txt\0` +
      `1 .M S.M. 160000 160000 160000 ${hash} ${hash} vendor/sub\0`,
  )
  assert.equal(parsed[0].path, 'new name.txt')
  assert.equal(parsed[0].originalPath, 'old name.txt')
  assert.equal(parsed[1].submoduleState, 'S.M.')
  assert.equal(parsed[1].mode, '160000')
})

test('capture and sidecar integrity failures fail closed', () => {
  const cwd = temporaryRepo()
  const failed = captureWorkspaceSnapshot(
    cwd,
    { paths: ['tracked.txt'] },
    [],
    { gitCommand: 'missing-git-for-evidence-test' },
  )
  assert.equal(failed.complete, false)
  assert.match(failed.error, /ENOENT/)

  const snapshot = captureWorkspaceSnapshot(cwd, { paths: ['tracked.txt'] })
  const taskDirectory = join(cwd, '.latch', 'tasks', 'fixture')
  mkdirSync(taskDirectory, { recursive: true })
  const reference = writeWorkspaceEvidence(
    taskDirectory,
    'fixture',
    'before',
    snapshot,
  )
  assert.deepEqual(
    readWorkspaceEvidence(taskDirectory, reference),
    snapshot,
  )
  writeFileSync(join(taskDirectory, reference.path), '{}\n')
  assert.throws(
    () => readWorkspaceEvidence(taskDirectory, reference),
    /integrity mismatch/,
  )
})

test('workspace scope validation normalizes duplicates and rejects escapes, globs, and pathspec magic', () => {
  const valid = plan([], ['src//core/', 'src/core/', 'src/cli.ts'])
  assertWritableTaskPlan(valid, 'fixture')
  assert.deepEqual(valid.workspace_scope.paths, ['src/core/', 'src/cli.ts'])
  for (const path of ['/tmp/a', '../a', 'src/*', ':glob:src', '.', 'C:\\tmp'])
    assert.throws(
      () => assertWritableTaskPlan(plan([], [path]), 'fixture'),
      /workspace_scope/,
      path,
    )
})

test('workspace scope keeps exact files separate from directory prefixes', () => {
  const exact = { paths: ['src/features/ui'] }
  assert.equal(pathInWorkspaceScope('src/features/ui', exact), true)
  assert.equal(pathInWorkspaceScope('src/features/ui/card.ts', exact), false)
  assert.equal(pathInWorkspaceScope('src/features/ui-kit', exact), false)
  assert.equal(
    workspaceScopeDescendantCandidate('src/features/ui/card.ts', exact),
    'src/features/ui',
  )
  assert.equal(
    workspaceScopeDescendantCandidate('src/features/ui-kit/card.ts', exact),
    undefined,
  )

  const directory = { paths: ['src/features/ui/'] }
  assert.equal(pathInWorkspaceScope('src/features/ui/card.ts', directory), true)
  assert.equal(
    workspaceScopeDescendantCandidate('src/features/ui/card.ts', directory),
    undefined,
  )

  assert.equal(
    workspaceScopeDescendantCandidate(
      'src/features/ui/card.ts',
      { paths: ['src', 'src/features/ui'] },
    ),
    'src/features/ui',
  )
})

test('scope content capture expands tracked and untracked directory descendants', () => {
  const cwd = temporaryRepo()
  mkdirSync(join(cwd, 'src'), { recursive: true })
  writeFileSync(join(cwd, 'src', 'tracked.ts'), 'export const tracked = true\n')
  git(cwd, ['add', 'src/tracked.ts'])
  git(cwd, ['commit', '-m', 'add scoped directory'])
  const scope = { paths: ['src/'] }
  const baseline = captureWorkspaceSnapshot(cwd, scope)
  assert.deepEqual(
    baseline.scope_entries.map((entry) => entry.path),
    ['src/tracked.ts'],
  )

  writeFileSync(join(cwd, 'src', 'untracked.ts'), 'export const added = true\n')
  const delta = compareWorkspaceScopeContent(
    baseline,
    captureWorkspaceSnapshot(cwd, scope),
    scope,
  )
  assert.equal(delta.status, 'in_scope_mutation')
  assert.equal(delta.changes[0].path, 'src/untracked.ts')
})

test('clean workspace passes and in-scope mutation denies pass', () => {
  const cleanRoot = temporaryRepo()
  const cleanId = createTask(cleanRoot, plan([
    { name: 'clean', command: [process.execPath, '-e', 'process.exit(0)'] },
  ]))
  const clean = verify(cleanRoot, cleanId, 'clean')
  assert.equal(clean.status, 0, clean.stderr)
  const cleanTask = readTask(cleanRoot, cleanId)
  assert.equal(cleanTask.workspace_proof.generation, 1)
  assert.equal(cleanTask.verification.gate.clean.status, 'pass')

  const mutateRoot = temporaryRepo()
  const mutateId = createTask(mutateRoot, plan([
    {
      name: 'mutate',
      command: [
        process.execPath,
        '-e',
        "require('fs').writeFileSync('tracked.txt', 'mutated\\n')",
      ],
    },
  ]))
  const mutated = verify(mutateRoot, mutateId, 'mutate')
  assert.notEqual(mutated.status, 0)
  const body = JSON.parse(mutated.stdout)
  assert.equal(body.verification.failure_reason, 'workspace_mutated')
  assert.equal(body.verification.command_outcome.status, 'pass')
  assert.equal(body.verification.workspace_effect.status, 'in_scope_mutation')
  assert.equal(readTask(mutateRoot, mutateId).workspace_proof.generation, 2)
})

test('dirty baseline warning separates in-scope and ambient paths', () => {
  const cwd = temporaryRepo()
  const id = createTask(cwd, plan([
    { name: 'clean', command: [process.execPath, '-e', 'process.exit(0)'] },
  ]))
  writeFileSync(join(cwd, 'tracked.txt'), 'dirty\n')
  writeFileSync(join(cwd, 'outside.txt'), 'ambient\n')
  const result = verify(cwd, id, 'clean')
  assert.equal(result.status, 0, result.stderr)
  assert.match(
    JSON.parse(result.stdout).warnings.join('\n'),
    /dirty baseline: 1 in scope, 1 ambient covered path\(s\)/,
  )
})

test('out-of-scope mutation creates a violation and submit rejects it', () => {
  const cwd = temporaryRepo()
  const id = createTask(cwd, plan([
    {
      name: 'outside',
      command: [
        process.execPath,
        '-e',
        "require('fs').writeFileSync('outside.txt', 'mutated\\n')",
      ],
    },
  ]))
  const result = verify(cwd, id, 'outside')
  assert.notEqual(result.status, 0)
  const task = readTask(cwd, id)
  assert.equal(task.verification.gate.outside.failure_reason, 'scope_violation')
  assert.equal(task.workspace_proof.unresolved_violations.length, 1)
  assert.equal(task.workspace_proof.unresolved_violations[0].path, 'outside.txt')

  const impactPath = join(cwd, '.latch', 'impact.json')
  writeFileSync(impactPath, JSON.stringify({
    kind: 'none',
    reason: 'fixture',
  }))
  const submitted = run(cwd, [
    'submit', id, '--expect-revision', revision(cwd, id),
    '--changes', 'fixture',
    '--knowledge-impact-file', '.latch/impact.json', '--json',
  ])
  assert.notEqual(submitted.status, 0)
  assert.match(submitted.stderr, /unresolved workspace violation/)
})

test('verify suggests a directory prefix for descendants of an exact missing path', () => {
  const command = [
    process.execPath,
    '-e',
    "require('fs').mkdirSync('candidate', { recursive: true }); require('fs').writeFileSync('candidate/child.txt', 'created\\n')",
  ]
  const createFixture = () => {
    const cwd = temporaryRepo()
    const id = createTask(cwd, plan([
      { name: 'descendant', command },
    ], ['candidate']))
    return { cwd, id }
  }

  const jsonFixture = createFixture()
  const result = verify(jsonFixture.cwd, jsonFixture.id, 'descendant')
  assert.notEqual(result.status, 0)
  const output = JSON.parse(result.stdout)
  assert.equal(output.verification.failure_reason, 'scope_violation')
  assert.match(
    output.warnings.join('\n'),
    /candidate is an exact file path and does not include descendant candidate\/child\.txt/,
  )
  assert.match(output.warnings.join('\n'), /change it to candidate\//)

  const humanFixture = createFixture()
  const human = run(humanFixture.cwd, [
    'verify', humanFixture.id,
    '--expect-revision', revision(humanFixture.cwd, humanFixture.id),
    '--name', 'descendant',
  ])
  assert.notEqual(human.status, 0)
  assert.match(human.stderr, /change it to candidate\//)
})

test('verify-all mutation stales earlier proof, stops later gates, and restoration does not revive old proof', () => {
  const cwd = temporaryRepo()
  const id = createTask(cwd, plan([
    { name: 'first', command: [process.execPath, '-e', 'process.exit(0)'] },
    {
      name: 'second',
      command: [
        process.execPath,
        '-e',
        "require('fs').writeFileSync('tracked.txt', 'mutated\\n')",
      ],
    },
    { name: 'third', command: [process.execPath, '-e', 'process.exit(0)'] },
  ]))
  const result = run(cwd, [
    'verify-all', id, '--expect-revision', revision(cwd, id), '--json',
  ])
  assert.notEqual(result.status, 0)
  const task = readTask(cwd, id)
  assert.equal(task.workspace_proof.generation, 2)
  assert.equal(task.verification.gate.first.status, 'pass')
  assert.equal(task.verification.gate.first.proof.ended_generation, 1)
  assert.equal(task.verification.gate.second.status, 'fail')
  assert.equal(task.verification.gate.third, undefined)
  assert.deepEqual(JSON.parse(result.stdout).remaining, ['first', 'second', 'third'])

  writeFileSync(join(cwd, 'tracked.txt'), 'baseline\n')
  const beforeContextRevision = readTask(cwd, id).revision
  const context = run(cwd, ['context', id, '--json', '--brief'])
  assert.equal(context.status, 0, context.stderr)
  const contextTask = JSON.parse(context.stdout).task
  assert.equal(contextTask.workspace_proof.live_status, 'mismatch')
  assert.equal(
    contextTask.verification_plan.find((gate) => gate.name === 'first').status,
    'stale',
  )
  assert.equal(readTask(cwd, id).revision, beforeContextRevision)
})

test('verify-all rebases a preexisting check correction before rerunning stale gates', () => {
  const cwd = temporaryRepo()
  const id = createTask(cwd, plan([
    { name: 'first', command: [process.execPath, '-e', 'process.exit(0)'] },
    { name: 'second', command: [process.execPath, '-e', 'process.exit(0)'] },
  ]))
  const initial = run(cwd, [
    'verify-all', id, '--expect-revision', revision(cwd, id), '--json',
  ])
  assert.equal(initial.status, 0, initial.stderr)
  assert.equal(readTask(cwd, id).phase, 'check')
  assert.equal(readTask(cwd, id).workspace_proof.generation, 1)

  writeFileSync(join(cwd, 'tracked.txt'), 'corrected\n')
  const corrected = run(cwd, [
    'verify-all', id, '--expect-revision', revision(cwd, id), '--json',
  ])
  assert.equal(corrected.status, 0, corrected.stderr)
  const output = JSON.parse(corrected.stdout)
  assert.deepEqual(output.executed.map((item) => item.name), ['first', 'second'])
  assert.match(
    output.warnings.join('\n'),
    /Workspace baseline changed before verify-all; proof generation advanced to 2/,
  )
  assert.deepEqual(output.remaining, [])

  const task = readTask(cwd, id)
  assert.equal(task.workspace_proof.generation, 2)
  assert.equal(task.verification.gate.first.proof.ended_generation, 2)
  assert.equal(task.verification.gate.second.proof.ended_generation, 2)
})

test('submit invalidates a live mismatch and capture failure records evidence_error without running gate', () => {
  const cwd = temporaryRepo()
  const id = createTask(cwd, plan([
    {
      name: 'clean',
      command: [process.execPath, '-e', 'process.exit(0)'],
    },
  ]))
  const passed = verify(cwd, id, 'clean')
  assert.equal(passed.status, 0, passed.stderr)
  writeFileSync(join(cwd, 'tracked.txt'), 'edited after proof\n')
  writeFileSync(join(cwd, '.latch', 'impact.json'), JSON.stringify({
    kind: 'none',
    reason: 'fixture',
  }))
  const submit = run(cwd, [
    'submit', id, '--expect-revision', revision(cwd, id),
    '--changes', 'fixture',
    '--knowledge-impact-file', '.latch/impact.json', '--json',
  ])
  assert.notEqual(submit.status, 0)
  assert.match(submit.stderr, /generation advanced/)
  const invalidated = readTask(cwd, id)
  assert.equal(invalidated.workspace_proof.generation, 2)
  assert.equal(invalidated.verification.gate.clean.proof.ended_generation, 1)

  const captureRoot = temporaryRepo()
  const captureMarker = join(captureRoot, 'not-run.txt')
  const captureId = createTask(captureRoot, plan([
    {
      name: 'capture',
      command: [
        process.execPath,
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(captureMarker)}, 'ran')`,
      ],
    },
  ]))
  renameSync(join(captureRoot, '.git'), join(captureRoot, '.git-disabled'))
  const failed = verify(captureRoot, captureId, 'capture')
  assert.notEqual(failed.status, 0)
  assert.equal(readTask(captureRoot, captureId).verification.gate.capture.failure_reason, 'evidence_error')
  assert.equal(readFileSync(taskPath(captureRoot, captureId), 'utf8').includes('proof_generation'), false)
  assert.throws(() => readFileSync(captureMarker), /ENOENT/)
})
