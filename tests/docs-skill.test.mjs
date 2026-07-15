import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const currentDocs = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/INDEX.md',
  'docs/HANDBOOK.md',
  'docs/DESIGN.md',
  'docs/AI_INSTALL.md',
  'docs/ARTIFACTS.md',
  'docs/SCENARIOS.md',
  'docs/ADOPTER_SYNC.md',
  'skills/latch/SKILL.md',
]

function text(path) {
  return readFileSync(join(root, path), 'utf8')
}

test('canonical skill has valid minimal frontmatter', () => {
  const content = text('skills/latch/SKILL.md')
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(match)
  const lines = match[1].split('\n')
  assert.equal(lines.some((line) => line.startsWith('name: latch')), true)
  assert.equal(lines.some((line) => line.startsWith('description: ')), true)
  assert.deepEqual(
    lines.map((line) => line.split(':', 1)[0]).sort(),
    ['description', 'name'],
  )
})

test('canonical skill is the only tracked repo skill source', () => {
  assert.equal(existsSync(join(root, 'skills/latch/SKILL.md')), true)
  for (const duplicate of [
    '.agents/skills/latch/SKILL.md',
    '.opencode/skills/latch/SKILL.md',
    'docs/templates/LATCH_SKILL.md',
  ])
    assert.equal(existsSync(join(root, duplicate)), false, duplicate)
})

test('current docs contain no local absolute path or removed command examples', () => {
  const removedCommands = /latch (?:start|next|resume|log|finish)(?:\s|`|$)/
  for (const path of currentDocs) {
    const content = text(path)
    assert.doesNotMatch(content, /\/Users\//, path)
    assert.doesNotMatch(content, removedCommands, path)
    assert.doesNotMatch(content, /triage\s*->|brainstorm\s*->|grill\s*->/, path)
  }
})

test('docs index relative markdown links resolve', () => {
  const indexPath = join(root, 'docs/INDEX.md')
  const index = readFileSync(indexPath, 'utf8')
  for (const match of index.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1]
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue
    assert.equal(existsSync(resolve(dirname(indexPath), target)), true, target)
  }
})

test('skill scripts manage links without copied docs snapshots', () => {
  const link = text('scripts/link-latch-skill.sh')
  const check = text('scripts/check-latch-skill.sh')
  assert.match(link, /ln -s/)
  assert.doesNotMatch(link, /\bcp\b/)
  assert.doesNotMatch(link, /rm -rf/)
  assert.match(link, /Refusing to replace non-symlink path/)
  assert.match(check, /-L/)
  assert.equal(lstatSync(join(root, 'skills/latch')).isDirectory(), true)
})
