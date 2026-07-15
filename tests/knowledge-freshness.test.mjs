import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  checkKnowledgeDocument,
  fingerprintKnowledgeDocument,
} from '../dist/core/knowledge.js'
import {
  createTaskV3,
  initTaskStoreV2,
} from '../dist/core/task-store.js'

const cli = join(process.cwd(), 'dist/cli.js')
const actor = 'codex:session:knowledge'
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-knowledge-'))
  temporaryDirectories.push(directory)
  return directory
}

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LATCH_ACTOR: actor },
  })
}

function write(cwd, path, content) {
  const absolute = join(cwd, path)
  mkdirSync(join(absolute, '..'), { recursive: true })
  writeFileSync(absolute, content)
}

function frontmatter(overrides = {}) {
  const value = {
    id: 'module',
    summary: '模块知识',
    covers: ['src/'],
    status: 'current',
    last_fingerprint: null,
    last_fingerprint_algo: 'sha256-v1',
    provenance: {
      last_verified_task_id: null,
      last_verified_at: null,
      optional_commit_sha: null,
    },
    ...overrides,
  }
  const covers = value.covers.length === 0
    ? 'covers: []'
    : `covers:\n${value.covers.map((cover) => `  - ${cover}`).join('\n')}`
  return `---\nid: ${value.id}\nsummary: ${value.summary}\n${covers}\nstatus: ${value.status}\nlast_fingerprint: ${value.last_fingerprint ?? 'null'}\nlast_fingerprint_algo: ${value.last_fingerprint_algo}\nprovenance:\n  last_verified_task_id: ${value.provenance.last_verified_task_id ?? 'null'}\n  last_verified_at: ${value.provenance.last_verified_at ?? 'null'}\n  optional_commit_sha: ${value.provenance.optional_commit_sha ?? 'null'}\n---\n\n# Module\n`
}

function expectedFingerprint(cwd, paths) {
  const aggregate = createHash('sha256')
  for (const path of paths) {
    const content = readFileSync(join(cwd, path))
    aggregate.update(path)
    aggregate.update('\u0000')
    aggregate.update(createHash('sha256').update(content).digest('hex'))
    aggregate.update('\n')
  }
  return aggregate.digest('hex')
}

function plan() {
  return {
    goal: '验证知识 freshness',
    scope: ['src/core/knowledge.ts'],
    acceptance: ['knowledge tests pass'],
    approach: ['使用 schema 3 fixture'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['submit -> knowledge check'],
    out_of_scope: ['baseline writeback'],
    verification_plan: [],
    open_questions: [],
  }
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('sha256-v1 expands exact, directory, and glob covers deterministically', () => {
  const cwd = temporaryDirectory()
  write(cwd, 'src/a.ts', 'alpha\n')
  write(cwd, 'src/nested/b.vue', 'beta\n')
  write(cwd, 'src/nested/c.ts', 'gamma\n')
  write(cwd, 'src/😀.ts', 'unicode\n')
  write(cwd, 'src/dist/ignored.ts', 'ignored\n')
  write(cwd, 'src/node_modules/ignored.ts', 'ignored\n')
  write(cwd, 'docs/module.md', frontmatter({
    covers: ['src/a.ts', 'src/', 'src/**/*.{ts,vue}'],
  }))

  const result = fingerprintKnowledgeDocument(cwd, 'docs/module.md')
  assert.deepEqual(result.files, [
    'src/a.ts',
    'src/nested/b.vue',
    'src/nested/c.ts',
    'src/😀.ts',
  ])
  assert.equal(result.fingerprint, expectedFingerprint(cwd, result.files))
  assert.equal(result.algorithm, 'sha256-v1')
})

test('freshness handles missing baseline, stale, retired, errors, and empty covers', () => {
  const cwd = temporaryDirectory()
  write(cwd, 'src/a.ts', 'alpha\n')
  write(cwd, 'docs/module.md', frontmatter({ covers: ['src/a.ts'] }))

  const missing = checkKnowledgeDocument(cwd, 'docs/module.md')
  assert.equal(missing.freshness, 'baseline_missing')
  assert.equal(missing.review_needed, true)

  write(cwd, 'docs/module.md', frontmatter({
    covers: ['src/a.ts'],
    last_fingerprint: missing.fingerprint,
  }))
  assert.equal(checkKnowledgeDocument(cwd, 'docs/module.md').freshness, 'fresh')

  write(cwd, 'src/a.ts', 'changed\n')
  assert.equal(checkKnowledgeDocument(cwd, 'docs/module.md').freshness, 'stale')

  write(cwd, 'docs/module.md', frontmatter({
    covers: ['src/missing.ts'],
    status: 'current',
  }))
  const errored = checkKnowledgeDocument(cwd, 'docs/module.md')
  assert.equal(errored.freshness, 'error')
  assert.match(errored.error, /matched no regular files/)

  write(cwd, 'docs/module.md', frontmatter({
    covers: ['src/missing.ts'],
    status: 'retired',
  }))
  assert.equal(checkKnowledgeDocument(cwd, 'docs/module.md').freshness, 'retired')

  write(cwd, 'docs/module.md', frontmatter({ covers: [] }))
  const empty = fingerprintKnowledgeDocument(cwd, 'docs/module.md')
  assert.equal(
    empty.fingerprint,
    createHash('sha256').update('').digest('hex'),
  )
  assert.deepEqual(empty.warnings, ['covers_empty'])

  write(cwd, 'docs/plain.md', '# no frontmatter\n')
  assert.equal(
    checkKnowledgeDocument(cwd, 'docs/plain.md').freshness,
    'baseline_missing',
  )
})

test('knowledge paths reject escapes, unsupported globs, and symlink covers', () => {
  const cwd = temporaryDirectory()
  write(cwd, 'src/a.ts', 'alpha\n')
  write(cwd, 'docs/module.md', frontmatter({ covers: ['../outside.ts'] }))
  assert.throws(
    () => fingerprintKnowledgeDocument(cwd, 'docs/module.md'),
    /Invalid knowledge cover/,
  )

  write(cwd, 'docs/module.md', frontmatter({ covers: ['src/[ab].ts'] }))
  assert.throws(
    () => fingerprintKnowledgeDocument(cwd, 'docs/module.md'),
    /Unsupported knowledge cover glob/,
  )

  write(cwd, 'docs/module.md', '---\nid: first\nid: duplicate\n---\n')
  assert.throws(
    () => checkKnowledgeDocument(cwd, 'docs/module.md'),
    /Invalid knowledge frontmatter/,
  )

  symlinkSync(join(cwd, 'src/a.ts'), join(cwd, 'src/link.ts'))
  write(cwd, 'docs/module.md', frontmatter({ covers: ['src/link.ts'] }))
  assert.throws(
    () => fingerprintKnowledgeDocument(cwd, 'docs/module.md'),
    /symlink/,
  )
  assert.throws(
    () => checkKnowledgeDocument(cwd, '../module.md'),
    /Invalid knowledge path/,
  )
})

test('CLI checks paths without initializing storage and follows updated task artifacts', () => {
  const cwd = temporaryDirectory()
  write(cwd, 'src/a.ts', 'alpha\n')
  write(cwd, 'docs/module.md', frontmatter({ covers: ['src/a.ts'] }))
  const before = readFileSync(join(cwd, 'docs/module.md'), 'utf8')

  const direct = run(cwd, [
    'knowledge', 'check', '--path', 'docs/module.md', '--json',
  ])
  assert.equal(direct.status, 0, direct.stderr)
  assert.equal(JSON.parse(direct.stdout).knowledge.freshness, 'baseline_missing')
  assert.equal(existsSync(join(cwd, '.latch')), false)
  assert.equal(readFileSync(join(cwd, 'docs/module.md'), 'utf8'), before)

  const store = initTaskStoreV2(cwd)
  const task = createTaskV3(store, {
    title: 'Knowledge task',
    plan: plan(),
    profile: 'standard',
    workBasis: {
      kind: 'implementation_authorization',
      source: 'user_request',
      reason: '检查知识 artifact',
      scope: { summary: '检查知识 artifact' },
    },
    artifacts: [{ kind: 'knowledge', path: 'docs/module.md' }],
  }, actor).task
  write(cwd, 'impact.json', JSON.stringify({
    kind: 'updated',
    summary: '更新模块知识',
    artifact_refs: [{ kind: 'knowledge', path: 'docs/module.md' }],
  }))
  const submitted = run(cwd, [
    'submit', task.id, '--expect-revision', '1',
    '--changes', '更新知识', '--unverified', '',
    '--knowledge-impact-file', 'impact.json',
    '--no-verify', '--reason', 'plan 无 gate', '--json',
  ])
  assert.equal(submitted.status, 0, submitted.stderr)

  const taskPath = join(cwd, '.latch', 'tasks', task.id, 'task.json')
  const eventsPath = join(cwd, '.latch', 'tasks', task.id, 'events.jsonl')
  const statePath = join(cwd, '.latch', 'state.json')
  const beforeCheck = [taskPath, eventsPath, statePath].map((path) =>
    readFileSync(path, 'utf8'),
  )

  const checked = run(cwd, [
    'knowledge', 'check', '--task', task.id, '--json',
  ])
  assert.equal(checked.status, 0, checked.stderr)
  const output = JSON.parse(checked.stdout)
  assert.equal(output.task_id, task.id)
  assert.equal(output.documents[0].artifact.path, 'docs/module.md')
  assert.equal(output.documents[0].freshness, 'baseline_missing')
  assert.deepEqual(
    [taskPath, eventsPath, statePath].map((path) => readFileSync(path, 'utf8')),
    beforeCheck,
  )
})
