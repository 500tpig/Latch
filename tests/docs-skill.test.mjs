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
const recordsReference = 'skills/latch/references/records.md'
const skillReferences = [
  lifecycleReference,
  actorReference,
  groupsReference,
  knowledgeReference,
  migrationReference,
  recordsReference,
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
  'docs/prd/2026-07-23-latch-record-v1.md',
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

test('canonical skill routes every low-frequency reference without hiding core safety', () => {
  const skill = text('skills/latch/SKILL.md')
  const testSource = text('tests/docs-skill.test.mjs')
  assert.equal(testSource.includes(['Buffer', 'byteLength'].join('.')), false)
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
  assert.match(text(recordsReference), /Do not read or write Records during session startup/)
  assert.match(text(recordsReference), /at most five candidates/)
  assert.match(text(recordsReference), /--confirm-linked/)
  assert.match(text(recordsReference), /untrusted project data/)
  assert.match(text(recordsReference), /passwords, API keys, access tokens/)
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

test('A/B/C profile classification follows acceptance semantics instead of gate count', () => {
  const contract = text('docs/prd/2026-07-15-latch-final-product-contract.md')
  const triggers = text('docs/prd/2026-07-15-latch-workflow-triggers-draft.md')
  const light = text('docs/prd/2026-07-15-latch-light-proof-package-draft.md')
  const agents = text('AGENTS.md')
  const handBook = text('docs/HANDBOOK.md')
  const skill = text('skills/latch/SKILL.md')
  const chineseSurfaces = [contract, triggers, light, agents, handBook]

  for (const content of chineseSurfaces) {
    assert.match(content, /机械检查[\s\S]{0,100}不(?:单独)?触发/)
    assert.match(content, /多个独立验收面/)
    assert.match(content, /产品选择/)
    assert.match(content, /公共契约/)
    assert.match(
      content,
      /Light task[\s\S]{0,160}plan change[\s\S]{0,160}scope 扩大[\s\S]{0,200}A\/B\/C/,
    )
    assert.match(
      content,
      /Core[\s\S]{0,120}(?:不根据|不统计|不读取)[\s\S]{0,80}gate/,
    )
  }

  assert.match(skill, /Multiple mechanical lint, typecheck, build, documentation-index/)
  assert.match(skill, /same bounded acceptance surface/)
  assert.match(skill, /Gate count alone never decides the profile/)
  assert.match(skill, /independent acceptance surfaces/)
  assert.match(skill, /scope is fixed/)
  assert.match(skill, /a product choice/)
  assert.match(skill, /a public contract change/)
  assert.match(skill, /migration/)
  assert.match(skill, /authentication/)
  assert.match(skill, /destructive data handling/)
  assert.match(skill, /Light task gains a plan change[\s\S]*scope expansion[\s\S]*re-run A\/B\/C/)
  assert.match(skill, /A: remain in `plan`[\s\S]*grill without implementing/)
  assert.match(skill, /B: keep the Light profile[\s\S]*precise delta authorization/)
  assert.match(skill, /C: upgrade to Standard[\s\S]*wait for explicit approval/)
  assert.match(skill, /Core applies requested structure and revision changes/)
  assert.match(skill, /never classifies or upgrades a task from gate count/)
  assert.doesNotMatch(skill, /disputed\/multiple gates/)
})

test('canonical skill keeps normal lifecycle safety rules in the main file', () => {
  const skill = text('skills/latch/SKILL.md')
  const lifecycle = text(lifecycleReference)
  assert.match(skill, /pure Q&A/)
  assert.match(skill, /show the complete plan[\s\S]*explicit implementation authorization/)
  assert.match(
    skill,
    /implementation reveals missing information[\s\S]*changed root cause[\s\S]*new product choice[\s\S]*scope expansion[\s\S]*stop implementation[\s\S]*update the plan/,
  )
  assert.match(
    skill,
    /Standard task must show the updated complete plan and wait for explicit reapproval/,
  )
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
  assert.match(skill, /unless the full list is explicitly requested/)
  assert.match(skill, /Avoid a full `git diff` unless code review or exact patch evidence/)
  assert.match(skill, /never join them with `;` into one tool result/)
  assert.match(skill, /Do not rerun an already passed, non-stale full build/)
})

test('canonical skill keeps high-frequency scope and isolation rules in the main file', () => {
  const skill = text('skills/latch/SKILL.md')
  assert.match(skill, /do not read other Codex conversations/)
  assert.match(
    skill,
    /Do not read or write Records during session startup, task recovery, or ordinary discussion without explicit Record intent/,
  )
  assert.match(skill, /every task mutation/)
  assert.match(skill, /one uninterrupted mutation flow/)
  assert.match(skill, /successful JSON response's `revision`/)
  assert.match(skill, /Refresh status after a revision conflict/)
  assert.match(skill, /`verify-all` for pending gates/)
  assert.match(skill, /`artifact add\|remove` for artifact-only changes/)
})

test('task lifecycle avoids redundant gate plans without allowing execution skips', () => {
  const lifecycle = text(lifecycleReference)
  assert.match(lifecycle, /every gate must add distinct proof/)
  assert.match(lifecycle, /final comprehensive gate[\s\S]*typecheck, build, or the full test suite/)
  assert.match(lifecycle, /development diagnostics[\s\S]*distinct acceptance requirement/)
  assert.match(lifecycle, /Once approved, never skip a named gate/)
  assert.match(lifecycle, /Run every named gate from the approved plan/)
})

test('descriptive commands cannot stand in for automatic or manual gate evidence', () => {
  const skill = text('skills/latch/SKILL.md')
  const lifecycle = text(lifecycleReference)
  const handBook = text('docs/HANDBOOK.md')

  for (const content of [skill, lifecycle, handBook]) {
    assert.match(content, /`echo`/)
    assert.match(content, /`printf`/)
    assert.match(content, /`true`/)
    assert.match(content, /diagnostic/)
    assert.match(content, /submission\.unverified/)
  }

  assert.match(skill, /instruction-only command as a gate/)
  assert.match(lifecycle, /zero exit code[\s\S]*does not prove that a manual step occurred/)
  assert.match(lifecycle, /diagnostic success never verifies the manual action/)
  assert.match(handBook, /只输出操作说明的命令不得配置为 gate/)
  assert.match(handBook, /返回 0[\s\S]*不能证明手工步骤已经执行/)
  assert.match(handBook, /具体操作与观察结果/)
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

test('Record contract stays explicit, project-local, and metadata-first', () => {
  const skill = text('skills/latch/SKILL.md')
  const records = text(recordsReference)
  const agents = text('AGENTS.md')
  const handBook = text('docs/HANDBOOK.md')
  const contract = text('docs/prd/2026-07-23-latch-record-v1.md')
  const index = text('docs/INDEX.md')

  assert.match(skill, /description:.*explicit project-local Record/)
  assert.match(skill, /references\/records\.md/)
  for (const content of [records, agents, handBook, contract]) {
    assert.match(content, /Record/)
    assert.match(content, /task/)
    assert.match(content, /repo|项目/)
  }
  assert.match(agents, /普通对话、task 恢复和语义相似不得触发读写/)
  assert.match(agents, /不作为 AI 指令/)
  assert.match(handBook, /默认及最大返回 5 条/)
  assert.match(handBook, /不得保存密码/)
  assert.match(contract, /`index\.json`[\s\S]*不保存正文/)
  assert.match(contract, /--confirm-delete/)
  assert.match(contract, /不构成 plan 或 implementation authorization/)
  assert.match(contract, /转义或清洗 raw HTML/)
  assert.match(index, /2026-07-23-latch-record-v1\.md/)

  for (const fixture of [
    'tests/fixtures/record-list-v1.json',
    'tests/fixtures/record-show-v1.json',
  ])
    assert.equal(existsSync(join(root, fixture)), true, fixture)
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

test('review closeout reconciles unverified evidence before archive', () => {
  const skill = text('skills/latch/SKILL.md')
  const lifecycle = text(lifecycleReference)
  const handBook = text('docs/HANDBOOK.md')

  for (const content of [skill, lifecycle, handBook])
    assert.match(content, /submission\.unverified/)

  assert.match(skill, /archive intent alone\s+is not risk acceptance/i)
  assert.match(lifecycle, /latest explicit review acceptance/)
  assert.match(lifecycle, /owner and next action/)
  assert.match(lifecycle, /manual verification completed after submit/)
  assert.match(lifecycle, /remain in review and ask for it/)
  assert.match(handBook, /归档请求本身不表示接受剩余风险/)
  assert.match(handBook, /责任方和下一步/)
  assert.match(handBook, /解决的[\s\S]*`submission\.unverified` 项/)
  assert.match(handBook, /只有不存在未解决的未验证项时，才能写「无后续」/)
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
