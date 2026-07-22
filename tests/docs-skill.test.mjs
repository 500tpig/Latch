import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillReferences = [
  'skills/latch/references/session-actors-and-handoff.md',
  'skills/latch/references/groups.md',
  'skills/latch/references/knowledge-and-context.md',
  'skills/latch/references/migration.md',
]
const currentDocs = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/INDEX.md',
  'docs/HANDBOOK.md',
  'docs/DESIGN.md',
  'docs/AI_INSTALL.md',
  'docs/prd/2026-07-15-latch-final-product-contract.md',
  'docs/prd/2026-07-15-latch-workflow-triggers-draft.md',
  'docs/prd/2026-07-15-latch-actor-writer-affinity-draft.md',
  'docs/prd/2026-07-15-latch-light-proof-package-draft.md',
  'docs/prd/2026-07-15-latch-group-minimal-draft.md',
  'docs/prd/2026-07-15-latch-knowledge-freshness-draft.md',
  'docs/prd/2026-07-15-latch-context-benchmark-draft.md',
  'docs/prd/2026-07-15-latch-migration-cli-draft.md',
  'docs/ARTIFACTS.md',
  'docs/SCENARIOS.md',
  'docs/ADOPTER_SYNC.md',
  'skills/latch/SKILL.md',
  ...skillReferences,
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

test('canonical skill stays lean and routes every low-frequency reference', () => {
  const skill = text('skills/latch/SKILL.md')
  assert.ok(Buffer.byteLength(skill, 'utf8') <= 9000)
  for (const path of skillReferences) {
    assert.equal(existsSync(join(root, path)), true, path)
    assert.equal(skill.includes(path.replace('skills/latch/', '')), true, path)
  }

  assert.match(text(skillReferences[0]), /LATCH_ACTOR/)
  assert.match(text(skillReferences[0]), /handoff prompt/)
  assert.match(text(skillReferences[1]), /group_id/)
  assert.match(text(skillReferences[2]), /knowledge fingerprint/)
  assert.match(text(skillReferences[2]), /context pack/i)
  assert.match(text(skillReferences[3]), /legacy_unclaimed/)
  assert.match(text(skillReferences[3]), /claim <task-id>[\s\S]*--expect-revision <n>[\s\S]*--json/)
  assert.match(text(skillReferences[3]), /downgrade-v2/)
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

test('current contract and instruction surface use the final A/B/C rules', () => {
  const index = text('docs/INDEX.md')
  const handBook = text('docs/HANDBOOK.md')
  const agents = text('AGENTS.md')
  const skill = text('skills/latch/SKILL.md')
  assert.match(index, /2026-07-15-latch-final-product-contract\.md/)
  assert.doesNotMatch(index, /Latch v2 PRD\]\(prd\/2026-07-10-latch-v2\.md\)[\s\S]*唯一产品契约/)
  for (const content of [handBook, agents, skill]) {
    assert.match(content, /A[：:].*grill/i)
    assert.match(content, /B[：:].*light/i)
    assert.match(content, /C[：:].*standard/i)
  }
})

test('canonical skill keeps normal lifecycle safety rules in the main file', () => {
  const skill = text('skills/latch/SKILL.md')
  assert.match(skill, /pure Q&A/)
  assert.match(skill, /Show every plan[\s\S]*explicit implementation authorization/)
  assert.match(skill, /writer mismatch as fail closed/)
  assert.match(skill, /takeover[\s\S]*never as implementation approval/)
  assert.match(skill, /implementation correction/)
  assert.match(skill, /non-implementation-feedback/)
  assert.match(skill, /every named gate/)
  assert.match(skill, /Run `done` only after explicit user authorization/)
  assert.match(skill, /Run `abandon` only after explicit user authorization/)
  assert.match(skill, /Never perform Git add, commit, push, branch, reset, checkout, or clean/)
})

test('inline Light shortcuts stay consistent across instructions and current docs', () => {
  const skill = text('skills/latch/SKILL.md')
  const knowledge = text('skills/latch/references/knowledge-and-context.md')
  const migration = text('skills/latch/references/migration.md')
  const install = text('docs/AI_INSTALL.md')
  const handBook = text('docs/HANDBOOK.md')

  for (const content of [skill, migration, install, handBook]) {
    assert.match(content, /--authorize-request/)
    assert.match(content, /--scope-summary/)
    assert.match(content, /--scope-path/)
  }
  for (const content of [skill, knowledge, install, handBook]) {
    assert.match(content, /--knowledge-impact-none/)
    assert.match(content, /--knowledge-impact-file/)
  }
  assert.match(knowledge, /patch-submission-knowledge-impact[\s\S]*--knowledge-impact-file/)
  assert.match(migration, /--authorization-file[\s\S]*complex authorization/)
})

test('startup reads context and project docs only when conditions require them', () => {
  const skill = text('skills/latch/SKILL.md')
  const agents = text('AGENTS.md')
  const handBook = text('docs/HANDBOOK.md')

  for (const content of [skill, agents, handBook]) {
    assert.match(content, /current_task_id/)
    assert.match(content, /task ID/)
    assert.match(content, /docs\/INDEX\.md/)
  }
  assert.match(skill, /If neither exists, do not call/)
  assert.match(agents, /两者都没有时，不得调用/)
  assert.match(handBook, /不含 `current_task_id`[\s\S]*不得调用/)
  assert.match(skill, /only when the task affects product contracts/)
  assert.match(agents, /只有任务涉及产品契约/)
  assert.match(handBook, /简单且证据充分的改动不固定读取项目文档/)
})

test('continuous mutation flows reuse returned revision without redundant context reads', () => {
  const skill = text('skills/latch/SKILL.md')
  const agents = text('AGENTS.md')
  const handBook = text('docs/HANDBOOK.md')

  for (const content of [skill, agents, handBook]) {
    assert.match(content, /JSON[\s\S]*`revision`/)
    assert.match(content, /--expect-revision/)
    assert.match(content, /revision conflict/)
    assert.match(content, /user input boundary|用户输入边界/)
    assert.match(content, /do not reread context|不得只为获取 revision 重读 context/)
  }
})

test('cross-session handoff requires takeover separate from implementation approval', () => {
  const handBook = text('docs/HANDBOOK.md')
  const actor = text('docs/prd/2026-07-15-latch-actor-writer-affinity-draft.md')
  const skill = text('skills/latch/SKILL.md')
  const handoff = text('skills/latch/references/session-actors-and-handoff.md')
  for (const content of [handBook, actor, handoff]) {
    assert.match(content, /新对话|new conversation/)
    assert.match(content, /takeover/)
    assert.match(content, /implementation approval|implementation approval|实施批准/)
    assert.match(content, /provenance.*clean|`provenance: clean`/)
  }
  assert.match(skill, /takeover as ownership transfer only, never as implementation approval/)
  assert.match(skill, /references\/session-actors-and-handoff\.md/)
  assert.match(handoff, /task-id/)
  assert.match(handoff, /phase\/revision/)
  assert.match(handoff, /old-writer/)
  assert.match(handoff, /Unfinished work/)
  assert.match(handoff, /Worktree status/)
  assert.match(handoff, /old session must stop writing/)
  assert.match(handoff, /takeover <task-id>[\s\S]*--expect-revision <revision>[\s\S]*--json/)
  assert.match(handoff, /takeover first[\s\S]*returned JSON `revision`[\s\S]*approve/)
  assert.match(handoff, /save <task-id>[\s\S]*--expect-revision <n>[\s\S]*--provenance mixed[\s\S]*--json/)
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
