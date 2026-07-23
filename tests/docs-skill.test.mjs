import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lifecycleReference = 'skills/latch/references/task-lifecycle.md'
const actorReference = 'skills/latch/references/session-actors-and-handoff.md'
const groupsReference = 'skills/latch/references/groups.md'
const knowledgeReference = 'skills/latch/references/knowledge-and-context.md'
const migrationReference = 'skills/latch/references/migration.md'
const skillReferences = [
  lifecycleReference,
  actorReference,
  groupsReference,
  knowledgeReference,
  migrationReference,
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
  assert.ok(Buffer.byteLength(skill, 'utf8') <= 7000)
  for (const path of skillReferences) {
    assert.equal(existsSync(join(root, path)), true, path)
    assert.equal(skill.includes(path.replace('skills/latch/', '')), true, path)
  }

  assert.match(text(lifecycleReference), /Show every Standard plan/)
  assert.match(text(lifecycleReference), /approve --feedback/)
  assert.match(text(actorReference), /LATCH_ACTOR/)
  assert.match(text(actorReference), /handoff prompt/)
  assert.match(text(actorReference), /Grok and Codex are equal writable hosts/)
  assert.match(text(actorReference), /GROK_SESSION_ID/)
  assert.match(text(actorReference), /do not invent `LATCH_ACTOR`/i)
  assert.match(skill, /Grok and Codex are equal hosts/)
  assert.match(text(groupsReference), /group_id/)
  assert.match(text(knowledgeReference), /knowledge fingerprint/)
  assert.match(text(knowledgeReference), /context pack/i)
  assert.match(text(migrationReference), /legacy_unclaimed/)
  assert.match(text(migrationReference), /claim <task-id>[\s\S]*--expect-revision <n>[\s\S]*--json/)
  assert.match(text(migrationReference), /downgrade-v2/)
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
  const lifecycle = text(lifecycleReference)
  assert.match(skill, /pure Q&A/)
  assert.match(skill, /show the complete plan[\s\S]*explicit implementation authorization/)
  assert.match(skill, /writer mismatch as fail closed/)
  assert.match(skill, /takeover[\s\S]*never as implementation approval/)
  assert.match(lifecycle, /implementation correction/)
  assert.match(lifecycle, /non-implementation-feedback/)
  assert.match(skill, /every named gate/)
  assert.match(skill, /Run `done` only after explicit user authorization/)
  assert.match(skill, /Run `abandon` only after explicit user authorization/)
  assert.match(skill, /Never perform Git add, commit, push, branch, reset, checkout, or clean/)
})

test('canonical skill provides three executable paths without weakening closeout', () => {
  const skill = text('skills/latch/SKILL.md')
  assert.match(skill, /### Ordinary Light task/)
  assert.match(skill, /checkpoint[\s\S]*--profile light[\s\S]*--authorize-request/)
  assert.match(skill, /### Standard plan/)
  assert.match(skill, /approve <task-id> --expect-revision <n>/)
  assert.match(skill, /### Review closeout fast path/)
  assert.match(skill, /phase: review[\s\S]*every gate is `pass`[\s\S]*`stale` and `pending` are zero/)
  assert.match(skill, /context <task-id> --json --status/)
  assert.match(skill, /takeover <task-id> --expect-revision <n>/)
  assert.match(skill, /done <task-id> --expect-revision <n>/)
  assert.match(skill, /Takeover only transfers writer ownership; it does not reapprove a plan or authorize `done`/)
  assert.match(skill, /Run `done` only when the user explicitly authorizes completion\/archive/)
  assert.match(skill, /Git delivery remains separate/)
  assert.match(skill, /Do not load `--brief --history timeline`[\s\S]*gates are missing, stale, pending, or failed/)
})

test('canonical skill bounds large command output without creating a new workflow', () => {
  const skill = text('skills/latch/SKILL.md')
  assert.match(skill, /above 50 entries/i)
  assert.match(skill, /total, status counts, and at most eight representative paths/)
  assert.match(skill, /Avoid a full `git diff` unless code review/)
  assert.match(skill, /never join them with `;` into one tool result/)
  assert.match(skill, /Do not rerun an already passed, non-stale full build/)
})

test('task lifecycle avoids redundant gate plans without allowing execution skips', () => {
  const lifecycle = text(lifecycleReference)
  assert.match(lifecycle, /every gate must add distinct proof/)
  assert.match(lifecycle, /final comprehensive gate[\s\S]*typecheck, build, or the full test suite/)
  assert.match(lifecycle, /development diagnostics[\s\S]*distinct acceptance requirement/)
  assert.match(lifecycle, /Once approved, never skip a named gate/)
  assert.match(lifecycle, /Run every named gate from the approved plan/)
})

test('current docs describe compact verification, artifact, and warning commands', () => {
  const skill = text('skills/latch/SKILL.md')
  const handBook = text('docs/HANDBOOK.md')
  const contract = text('docs/prd/2026-07-15-latch-final-product-contract.md')
  for (const content of [skill, handBook, contract]) {
    assert.match(content, /verify-all/)
    assert.match(content, /artifact add\|remove|artifact add/)
    assert.match(content, /--verbose-warnings/)
  }
  assert.match(handBook, /首个失败 gate[\s\S]*停止/)
  assert.match(handBook, /最多 8 个样本/)
  assert.match(contract, /每项仍独立记录 event 和 revision/)
})

test('inline Light shortcuts stay consistent across instructions and current docs', () => {
  const skill = text('skills/latch/SKILL.md')
  const lifecycle = text(lifecycleReference)
  const knowledge = text(knowledgeReference)
  const migration = text(migrationReference)
  const install = text('docs/AI_INSTALL.md')
  const handBook = text('docs/HANDBOOK.md')

  for (const content of [skill, migration, install, handBook]) {
    assert.match(content, /--authorize-request/)
    assert.match(content, /--scope-summary/)
    assert.match(content, /--scope-path/)
  }
  for (const content of [lifecycle, knowledge, install, handBook]) {
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
  assert.match(skill, /if neither exists, do not call/i)
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

test('cross-session planning recovery stays artifact-first and bounded', () => {
  const agents = text('AGENTS.md')
  const lifecycle = text(lifecycleReference)
  const handoff = text(actorReference)
  const groups = text(groupsReference)

  assert.match(agents, /常规恢复不得读取其他 Codex 会话/)
  for (const content of [agents, groups]) {
    assert.match(
      content,
      /list --group <(?:group-)?id> --include-archive --json --brief/,
    )
    assert.match(content, /context <task-id> --json --status/)
  }
  assert.match(agents, /不得同时展开多张完整 context 或原始 event/)
  assert.match(handoff, /Read-only orientation does not authorize claim, takeover/)
  assert.match(handoff, /Starting a different task.*is not a takeover/)
  assert.match(groups, /Do not create a planning or anchor task solely/)
  assert.match(agents, /不得只为保存聊天连续性创建 planning 或 anchor task/)
  assert.match(lifecycle, /concrete next task\/action in `followup`/)
  assert.match(agents, /`followup` 必须写具体下一张 task、下一项动作/)
  assert.match(groups, /Group membership does not encode task order/)
  assert.match(groups, /do not generate an automatic group-level next task/)
})

test('cross-session handoff requires takeover separate from implementation approval', () => {
  const handBook = text('docs/HANDBOOK.md')
  const actor = text('docs/prd/2026-07-15-latch-actor-writer-affinity-draft.md')
  const skill = text('skills/latch/SKILL.md')
  const handoff = text(actorReference)
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
