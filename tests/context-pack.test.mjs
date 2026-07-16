import test from 'node:test'
import assert from 'node:assert/strict'
import {
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
  buildContextPack,
  loadContextPackSections,
  parseContextPackRequest,
} from '../dist/core/context-pack.js'
import {
  createTaskV3,
  initTaskStoreV2,
} from '../dist/core/task-store.js'

const cli = join(process.cwd(), 'dist/cli.js')
const actor = 'codex:session:context-pack'
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-context-pack-'))
  temporaryDirectories.push(directory)
  return directory
}

function write(cwd, path, content) {
  const absolute = join(cwd, path)
  mkdirSync(join(absolute, '..'), { recursive: true })
  writeFileSync(absolute, content)
}

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LATCH_ACTOR: actor },
  })
}

function plan() {
  return {
    goal: '验证 Context pack',
    scope: ['src/core/context-pack.ts'],
    acceptance: ['context pack tests pass'],
    approach: ['使用 schema 3 fixture'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['request -> pack'],
    out_of_scope: ['orientation persistence'],
    verification_plan: [],
    open_questions: [],
  }
}

function knowledgeDocument() {
  return `---
id: module
summary: 模块知识
covers:
  - src/map.txt
status: current
last_fingerprint: null
last_fingerprint_algo: sha256-v1
provenance:
  last_verified_task_id: null
  last_verified_at: null
  optional_commit_sha: null
---

# Module
当前说明。
`
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('pack enforces layer order and counts final astral Unicode output', () => {
  const request = parseContextPackRequest({
    knowledge_paths: [],
    sources: [],
  })
  const { pack, serialized } = buildContextPack(request, [
    { kind: 'expand', content: '尾'.repeat(800), reason: '补证据' },
    { kind: 'excerpt', content: 'excerpt'.repeat(300) },
    { kind: 'sibling', content: 's'.repeat(3_000) },
    { kind: 'map', content: 'm'.repeat(3_000) },
    { kind: 'knowledge', content: 'k'.repeat(3_000), freshness: 'fresh' },
    { kind: 'task', content: '😀'.repeat(5_000) },
  ], { charBudget: 12_000 })

  assert.equal(pack.meta.char_count, [...serialized].length)
  assert.equal(pack.meta.char_budget, 12_000)
  assert.equal(pack.meta.truncated, true)
  assert.ok(pack.meta.char_count <= 12_000)
  assert.ok(serialized.length > pack.meta.char_count)
  assert.deepEqual(
    pack.sections.map((section) => section.kind),
    ['task', 'knowledge', 'map', 'excerpt'],
  )
  assert.ok([...pack.sections[0].content].length <= 4_000)
  const l1 = pack.sections
    .filter((section) => ['knowledge', 'map', 'sibling'].includes(section.kind))
    .reduce((total, section) => total + [...section.content].length, 0)
  assert.ok(l1 <= 6_000)
})

test('orientation is stateless, cumulative, task-bound, and bounded', () => {
  const cwd = temporaryDirectory()
  write(cwd, 'src/expand.txt', 'one 😀')
  const firstRequest = parseContextPackRequest({
    knowledge_paths: [],
    sources: [{
      kind: 'expand',
      path: 'src/expand.txt',
      reason: '首批证据',
    }],
  })
  const first = buildContextPack(
    firstRequest,
    loadContextPackSections(cwd, firstRequest),
  ).pack
  assert.equal(first.meta.expand_batches, 1)
  assert.equal(first.meta.char_budget, 24_000)
  assert.equal(first.meta.expand_chars_cum, [...'one 😀'].length)

  write(cwd, 'src/expand.txt', 'two')
  const secondRequest = parseContextPackRequest({
    orientation: {
      orientation_id: first.meta.orientation_id,
      expand_batches: first.meta.expand_batches,
      expand_chars_cum: first.meta.expand_chars_cum,
    },
    knowledge_paths: [],
    sources: [{
      kind: 'expand',
      path: 'src/expand.txt',
      reason: '第二批证据',
    }],
  })
  const second = buildContextPack(
    secondRequest,
    loadContextPackSections(cwd, secondRequest),
  ).pack
  assert.equal(second.meta.orientation_id, first.meta.orientation_id)
  assert.equal(second.meta.expand_batches, 2)
  assert.equal(
    second.meta.expand_chars_cum,
    first.meta.expand_chars_cum + [...'two'].length,
  )

  assert.throws(
    () => parseContextPackRequest({
      task_id: 'other-task',
      orientation: {
        orientation_id: first.meta.orientation_id,
        expand_batches: 1,
        expand_chars_cum: 5,
      },
      knowledge_paths: [],
      sources: [],
    }),
    /task_id does not match/,
  )
  assert.throws(
    () => buildContextPack(firstRequest, [{
      kind: 'expand',
      content: '😀'.repeat(8_001),
      reason: '过大',
    }]),
    /exceeds 8000/,
  )
  assert.throws(
    () => buildContextPack({
      ...firstRequest,
      orientation: {
        orientation_id: first.meta.orientation_id,
        expand_batches: 6,
        expand_chars_cum: 47_999,
      },
    }, [{ kind: 'expand', content: 'two', reason: '累计过大' }]),
    /exceeds 48000/,
  )
})

test('source loading rejects escapes, symlinks, and invalid line ranges', () => {
  const cwd = temporaryDirectory()
  write(cwd, 'src/file.txt', 'one\ntwo\nthree')
  const ranged = parseContextPackRequest({
    knowledge_paths: [],
    sources: [{
      kind: 'excerpt',
      path: 'src/file.txt',
      start_line: 2,
      end_line: 3,
    }],
  })
  assert.equal(loadContextPackSections(cwd, ranged)[0].content, 'two\nthree')

  const escaped = parseContextPackRequest({
    knowledge_paths: [],
    sources: [{ kind: 'map', path: '../outside.txt' }],
  })
  assert.throws(() => loadContextPackSections(cwd, escaped), /Invalid context source path/)

  symlinkSync(join(cwd, 'src/file.txt'), join(cwd, 'src/link.txt'))
  const linked = parseContextPackRequest({
    knowledge_paths: [],
    sources: [{ kind: 'map', path: 'src/link.txt' }],
  })
  assert.throws(() => loadContextPackSections(cwd, linked), /not a regular file/)

  const invalidRange = parseContextPackRequest({
    knowledge_paths: [],
    sources: [{ kind: 'excerpt', path: 'src/file.txt', start_line: 4 }],
  })
  assert.throws(() => loadContextPackSections(cwd, invalidRange), /line range exceeds/)
})

test('CLI combines task, freshness, siblings, and requested sources without writes', () => {
  const cwd = temporaryDirectory()
  write(cwd, 'src/map.txt', 'map one\nmap two\nmap three')
  write(cwd, 'src/excerpt.txt', 'skip\nexcerpt')
  write(cwd, 'src/expand.txt', 'expanded')
  write(cwd, 'docs/module.md', knowledgeDocument())
  const store = initTaskStoreV2(cwd)
  const target = createTaskV3(store, {
    title: 'Context target',
    plan: plan(),
    profile: 'standard',
    groupId: 'Wave:Context',
  }, actor).task
  createTaskV3(store, {
    title: 'Context sibling',
    plan: plan(),
    profile: 'standard',
    groupId: 'Wave:Context',
  }, actor)
  write(cwd, 'request.json', `${JSON.stringify({
    task_id: target.id,
    knowledge_paths: ['docs/module.md'],
    sources: [
      { kind: 'map', path: 'src/map.txt', start_line: 1, end_line: 2 },
      { kind: 'excerpt', path: 'src/excerpt.txt', start_line: 2 },
      { kind: 'expand', path: 'src/expand.txt', reason: '补充实现证据' },
    ],
  }, null, 2)}\n`)

  const tracked = [
    join(cwd, '.latch', 'tasks', target.id, 'task.json'),
    join(cwd, '.latch', 'tasks', target.id, 'events.jsonl'),
    join(cwd, '.latch', 'state.json'),
  ]
  const before = tracked.map((path) => readFileSync(path, 'utf8'))
  const result = run(cwd, [
    'context', 'pack', '--input-file', 'request.json',
  ])
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.meta.task_id, target.id)
  assert.equal(output.meta.char_budget, 24_000)
  assert.equal(output.meta.char_count, [...result.stdout].length)
  assert.deepEqual(
    output.sections.map((section) => section.kind),
    ['task', 'knowledge', 'map', 'sibling', 'excerpt', 'expand'],
  )
  assert.equal(output.sections[1].freshness, 'baseline_missing')
  assert.equal(output.sections[2].content, 'map one\nmap two')
  assert.equal(output.sections[4].content, 'excerpt')
  assert.equal(output.meta.expand_batches, 1)
  assert.deepEqual(
    tracked.map((path) => readFileSync(path, 'utf8')),
    before,
  )
})
