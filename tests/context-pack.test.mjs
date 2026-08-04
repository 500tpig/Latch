import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildContextPack,
  loadContextPackSections,
  parseContextPackRequest,
} from '../dist/core/context-pack.js'
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
