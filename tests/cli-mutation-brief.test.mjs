import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  MUTATION_JSON_BYTE_BUDGET,
  MUTATION_SAMPLE_LIMIT,
  compactMutationStrings,
  compactUnverifiedItems,
  compactVerification,
  compactVerifyAll,
  enforceMutationBudget,
} from '../dist/core/task-view/mutation.js'
import {
  cleanupTemporaryDirectories,
  init,
  plan,
  readTask,
  run,
  temporaryDirectory,
  writePlan,
} from './cli-test-support.mjs'

const mutationCommands = [
  'checkpoint',
  'takeover',
  'save',
  'append-scope',
  'update-verification-command',
  'resolve-open-questions',
  'approve',
  'verify',
  'verify-all',
  'reconcile',
  'reopen-review',
  'artifact',
  'submit',
  'patch-submission-knowledge-impact',
  'done',
  'abandon',
]

const fixture = JSON.parse(
  readFileSync('tests/fixtures/mutation-v3-maximum.json', 'utf8'),
)

test.afterEach(cleanupTemporaryDirectories)

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

function temporaryRepo() {
  const cwd = temporaryDirectory()
  git(cwd, ['init', '-q'])
  writeFileSync(join(cwd, '.gitignore'), '.latch/\nplan*.json\nimpact.json\ncloseout.json\n')
  writeFileSync(join(cwd, 'work.txt'), 'baseline\n')
  git(cwd, ['add', '.gitignore', 'work.txt'])
  git(cwd, [
    '-c', 'user.name=Latch Test',
    '-c', 'user.email=latch@example.com',
    'commit', '-qm', 'baseline',
  ])
  init(cwd)
  return cwd
}

function json(result, expectedStatus = 0) {
  assert.equal(result.status, expectedStatus, result.stderr)
  return JSON.parse(result.stdout)
}

function checkpoint(cwd, overrides, extra = []) {
  const result = run(cwd, [
    'checkpoint', 'Mutation brief fixture',
    '--plan-file', writePlan(cwd, plan(overrides)),
    '--json',
    ...extra,
  ])
  return json(result)
}

function approve(cwd, taskId) {
  const revision = readTask(cwd, taskId).revision
  return json(run(cwd, [
    'approve', taskId,
    '--expect-revision', String(revision),
    '--reason', 'approve compact mutation fixture',
    '--json',
  ]))
}

function assertBriefEnvelope(value) {
  assert.equal(value.schema_version, 3)
  assert.equal(typeof value.generated_at, 'string')
  assert.equal(typeof value.task_id, 'string')
  assert.equal(typeof value.revision, 'number')
  assert.equal(typeof value.phase, 'string')
  assert.equal(typeof value.next_action, 'object')
  assert.equal(typeof value.warning_count, 'number')
  assert.ok(Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, 'utf8') <= 4096)
  assert.equal('shared_worktree' in value, false)
  assert.equal('workspace_proof' in value, false)
  assert.equal('warnings' in value, false)
}

test('task mutations expose --brief and reject it without --json before writes', () => {
  const cwd = temporaryDirectory()
  for (const command of mutationCommands) {
    const help = run(cwd, [command, '--help'])
    assert.equal(help.status, 0, `${command}: ${help.stderr}`)
    assert.match(help.stdout, /--brief/, command)

    const rejected = run(cwd, [command, '--brief'])
    assert.notEqual(rejected.status, 0, command)
    assert.match(rejected.stderr, /--brief requires --json/, command)
  }
  assert.equal(existsSync(join(cwd, '.latch')), false)

  const template = run(cwd, [
    'checkpoint', '--print-plan-template', 'light', '--json', '--brief',
  ])
  assert.notEqual(template.status, 0)
  assert.match(template.stderr, /--brief/)
  assert.equal(existsSync(join(cwd, '.latch')), false)
})

test('checkpoint brief is compact while default mutation JSON stays detailed', () => {
  const cwd = temporaryRepo()
  const brief = checkpoint(cwd, {
    workspace_scope: { paths: ['work.txt'] },
  }, ['--brief'])
  assertBriefEnvelope(brief)
  assert.equal(brief.phase, 'plan')
  assert.equal(brief.proof_generation, null)
  assert.equal(brief.proof_live_status, null)

  const detailed = checkpoint(cwd, {
    workspace_scope: { paths: ['work.txt'] },
  })
  assert.equal(typeof detailed.shared_worktree, 'object')
  assert.deepEqual(detailed.warnings, [])
  assert.equal('warning_count' in detailed, false)
})

test('verify-all brief omits successful streams and retains bounded failure diagnostics', () => {
  const passingRoot = temporaryRepo()
  const passing = checkpoint(passingRoot, {
    workspace_scope: { paths: ['work.txt'] },
    verification_plan: [{
      name: 'passing-gate',
      command: [process.execPath, '-e', "process.stdout.write('pass output')"],
      kind: 'gate',
    }],
  })
  approve(passingRoot, passing.task_id)
  const passed = json(run(passingRoot, [
    'verify-all', passing.task_id,
    '--expect-revision', String(readTask(passingRoot, passing.task_id).revision),
    '--json', '--brief',
  ]))
  assertBriefEnvelope(passed)
  assert.equal(passed.executed.total, 1)
  assert.equal(passed.executed.sample[0].status, 'pass')
  assert.equal('stdout' in passed.executed.sample[0], false)
  assert.equal('stderr' in passed.executed.sample[0], false)
  assert.equal('failed_execution' in passed, false)

  const failingRoot = temporaryRepo()
  const failing = checkpoint(failingRoot, {
    workspace_scope: { paths: ['work.txt'] },
    verification_plan: [{
      name: 'failing-gate',
      command: [
        process.execPath,
        '-e',
        "process.stdout.write('x'.repeat(20000)); process.stderr.write('y'.repeat(20000)); process.exit(1)",
      ],
      kind: 'gate',
    }],
  })
  approve(failingRoot, failing.task_id)
  const failedResult = run(failingRoot, [
    'verify-all', failing.task_id,
    '--expect-revision', String(readTask(failingRoot, failing.task_id).revision),
    '--json', '--brief',
  ])
  const failed = json(failedResult, 1)
  assertBriefEnvelope(failed)
  assert.equal(failed.failed, 'failing-gate')
  assert.equal(failed.failed_execution.status, 'fail')
  assert.ok(failed.failed_execution.stdout.summary.head_bytes <= 256)
  assert.ok(failed.failed_execution.stderr.summary.tail_bytes <= 256)
  assert.equal(failed.failed_execution.stdout.summary.truncated, true)
  assert.ok(failed.failed_execution.stdout.summary.omitted_bytes > 0)
})

test('submit brief hands off closeout items and archive responses name the last open phase', () => {
  const cwd = temporaryRepo()
  const created = checkpoint(cwd, {
    workspace_scope: { paths: ['work.txt'] },
    verification_plan: [],
  })
  approve(cwd, created.task_id)
  const submitted = json(run(cwd, [
    'submit', created.task_id,
    '--expect-revision', String(readTask(cwd, created.task_id).revision),
    '--changes', 'exercise compact closeout handoff',
    '--unverified-item', 'browser interaction remains',
    '--unverified-item', 'real data remains',
    '--knowledge-impact-none', 'fixture has no knowledge impact',
    '--no-verify', '--reason', 'fixture plan has no gates',
    '--json', '--brief',
  ]))
  assertBriefEnvelope(submitted)
  assert.equal(submitted.unverified_items.total, 2)
  assert.deepEqual(
    submitted.unverified_items.sample.map((item) => item.item_id),
    ['U1', 'U2'],
  )
  assert.deepEqual(
    readTask(cwd, created.task_id).submission.unverified_items.map(
      (item) => item.summary,
    ),
    ['browser interaction remains', 'real data remains'],
  )

  writeFileSync(join(cwd, 'closeout.json'), `${JSON.stringify({
    resolutions: [
      { item_id: 'U1', outcome: 'resolved', resolution: 'browser observed' },
      { item_id: 'U2', outcome: 'resolved', resolution: 'real data observed' },
    ],
  })}\n`)
  const archived = json(run(cwd, [
    'done', created.task_id,
    '--expect-revision', String(submitted.revision),
    '--closeout-file', 'closeout.json',
    '--json', '--brief',
  ]))
  assertBriefEnvelope(archived)
  assert.equal(archived.archived, true)
  assert.equal(archived.outcome, 'done')
  assert.equal(archived.phase, 'review')
  assert.equal(archived.last_open_phase, 'review')
  assert.deepEqual(archived.next_action, {
    kind: 'stop',
    reason: 'archived_read_only',
  })
})

test('normative maximum compact mutation fixture stays under 4096 UTF-8 bytes', () => {
  assert.equal(fixture.byte_budget, MUTATION_JSON_BYTE_BUDGET)
  assert.equal(fixture.sample_limit, MUTATION_SAMPLE_LIMIT)
  const count = fixture.synthetic_input.repeat_count
  const longText = fixture.synthetic_input.long_text.repeat(20)
  const verification = {
    name: longText,
    status: 'fail',
    exit_code: 1,
    duration_ms: 100,
    failure_reason: 'command_failed',
    stdout: {
      bytes: Buffer.byteLength(longText.repeat(20)),
      summary: {
        limit_bytes: 16384,
        head_limit_bytes: 4096,
        tail_limit_bytes: 12288,
        head_bytes: Buffer.byteLength(longText.repeat(10)),
        tail_bytes: Buffer.byteLength(longText.repeat(10)),
        head: longText.repeat(10),
        tail: longText.repeat(10),
        omitted_bytes: 1000,
        truncated: true,
        invalid_utf8: false,
      },
    },
    stderr: {
      bytes: Buffer.byteLength(longText.repeat(20)),
      summary: {
        limit_bytes: 16384,
        head_limit_bytes: 4096,
        tail_limit_bytes: 12288,
        head_bytes: Buffer.byteLength(longText.repeat(10)),
        tail_bytes: Buffer.byteLength(longText.repeat(10)),
        head: longText.repeat(10),
        tail: longText.repeat(10),
        omitted_bytes: 1000,
        truncated: true,
        invalid_utf8: false,
      },
    },
  }
  const projected = enforceMutationBudget({
    schema_version: 3,
    generated_at: '2026-08-17T00:00:00.000Z',
    task_id: fixture.synthetic_input.long_task_id,
    previous_revision: 41,
    revision: 42,
    phase: 'check',
    next_action: { kind: 'stop', reason: 'implementation_diagnosis' },
    warning_count: count,
    warning_summary: compactMutationStrings(
      Array.from({ length: count }, () => longText),
    ),
    proof_generation: 3,
    proof_live_status: 'mismatch',
    unresolved_violations: count,
    unverified_items: compactUnverifiedItems(
      Array.from({ length: count }, (_, index) => ({
        item_id: `U${index + 1}`,
        summary: longText,
      })),
    ),
    executed: compactVerifyAll(
      Array.from({ length: count }, (_, index) => ({
        output: { ...verification, name: `${longText}-${index}` },
        revision: index + 1,
      })),
    ),
    failed_execution: {
      ...compactVerification(verification, true),
      revision: count,
    },
    remaining: compactMutationStrings(
      Array.from({ length: count }, (_, index) => `${longText}-${index}`),
    ),
  })
  const bytes = Buffer.byteLength(`${JSON.stringify(projected, null, 2)}\n`, 'utf8')
  assert.ok(bytes <= MUTATION_JSON_BYTE_BUDGET, `${bytes} exceeds budget`)
  assert.equal(projected.task_id, fixture.synthetic_input.long_task_id)
  assert.deepEqual(projected.next_action, {
    kind: 'stop',
    reason: 'implementation_diagnosis',
  })
  assert.ok(projected.unverified_items.sample.length <= MUTATION_SAMPLE_LIMIT)
  assert.ok(projected.executed.sample.length <= MUTATION_SAMPLE_LIMIT)
  assert.equal(JSON.parse(JSON.stringify(projected)).task_id, projected.task_id)
})
