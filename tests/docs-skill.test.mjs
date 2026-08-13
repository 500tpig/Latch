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

const maxTextAssertionMessageLength = 500

function assertTextMatches(content, pattern, message) {
  pattern.lastIndex = 0
  const matches = pattern.test(content)
  pattern.lastIndex = 0
  if (matches) return

  const failureMessage = String(message ?? `Expected text to match ${pattern}`).slice(
    0,
    maxTextAssertionMessageLength,
  )
  assert.fail(failureMessage)
}

test('bounded text assertions omit full document content on mismatch', () => {
  const actualMarker = 'FULL_DOCUMENT_ACTUAL_MARKER'
  const content = actualMarker.repeat(2_000)
  let failure

  try {
    assertTextMatches(content, /missing-contract/, 'HANDBOOK contract is missing')
  } catch (error) {
    failure = error
  }

  assert.ok(failure instanceof assert.AssertionError)
  assert.equal(failure.message, 'HANDBOOK contract is missing')
  assert.ok(failure.message.length <= maxTextAssertionMessageLength)
  assert.doesNotMatch(failure.message, new RegExp(actualMarker))
})

function estimatedInstructionTokens(content) {
  let han = 0
  let other = 0
  for (const character of content) {
    if (/\p{Script=Han}/u.test(character)) han += 1
    else other += 1
  }
  return Math.round(han + other / 4)
}

function classifyInstructionEstimate(surface, estimate) {
  if (estimate > surface.hard_cap) {
    return {
      status: 'hard-cap-exceeded',
      message: `${surface.name} exceeds its hard cap; redesign or split the instruction surface; do not only raise hard_cap.`,
    }
  }
  if (estimate > surface.reviewed_baseline) {
    return {
      status: 'review-required',
      message: `${surface.name} exceeds its reviewed baseline; update reviewed_baseline and review_reason after review.`,
    }
  }
  return {
    status: 'within-reviewed-baseline',
    message: `${surface.name} remains within its reviewed baseline.`,
  }
}

test('high-frequency instruction growth requires a reviewed aggregate baseline', () => {
  const fixturePath = 'tests/fixtures/instruction-budget-v1.json'
  const budget = JSON.parse(text(fixturePath))

  assert.equal(budget.schema_version, 1)
  assert.equal(budget.estimator, 'unicode-han-1-other-0.25-v1')
  assertTextMatches(budget.estimator_note, /stable engineering estimate/i)
  assertTextMatches(budget.estimator_note, /not a model token count or tokenizer output/i)
  assert.equal(budget.policy, 'reviewed-aggregate-ratchet')
  assert.deepEqual(
    budget.surfaces.map(({ name }) => name),
    ['always-loaded', 'planning-path'],
  )
  assert.deepEqual(
    budget.surfaces.map(({ paths }) => paths),
    [
      ['AGENTS.md', 'skills/latch/SKILL.md'],
      ['AGENTS.md', 'skills/latch/SKILL.md', lifecycleReference],
    ],
  )

  for (const surface of budget.surfaces) {
    assert.equal(Number.isInteger(surface.reviewed_baseline), true)
    assert.ok(surface.reviewed_baseline > 0)
    assert.equal(Number.isInteger(surface.hard_cap), true)
    assert.ok(surface.hard_cap > surface.reviewed_baseline + 1)
    assert.ok(surface.review_reason.trim().length >= 20)
    assertTextMatches(surface.review_reason, /re-reviewed/i)
    assertTextMatches(surface.review_reason, new RegExp(String(surface.reviewed_baseline)))
    const estimate = surface.paths.reduce(
      (total, path) => total + estimatedInstructionTokens(text(path)),
      0,
    )
    const currentOutcome = classifyInstructionEstimate(surface, estimate)
    assert.equal(
      currentOutcome.status,
      'within-reviewed-baseline',
      currentOutcome.message,
    )

    const shrinkOutcome = classifyInstructionEstimate(
      surface,
      Math.max(0, surface.reviewed_baseline - 1),
    )
    assert.equal(shrinkOutcome.status, 'within-reviewed-baseline')

    const reviewRequired = classifyInstructionEstimate(
      surface,
      surface.reviewed_baseline + 1,
    )
    assert.equal(reviewRequired.status, 'review-required')
    assertTextMatches(reviewRequired.message, /update reviewed_baseline and review_reason/i)

    const hardCapExceeded = classifyInstructionEstimate(
      surface,
      surface.hard_cap + 1,
    )
    assert.equal(hardCapExceeded.status, 'hard-cap-exceeded')
    assertTextMatches(
      hardCapExceeded.message,
      /redesign or split.*do not only raise hard_cap/i,
    )
    assert.notEqual(reviewRequired.status, hardCapExceeded.status)
  }
})

test('always-loaded scope safety semantics stay in the canonical skill', () => {
  const skill = text('skills/latch/SKILL.md')
  const semantics = [
    ['repo-relative POSIX scope paths', /`workspace_scope\.paths` must be repo-relative POSIX paths/],
    ['exact files omit slash', /Files omit `\//],
    ['directory prefixes include slash', /directories end in `\/`/],
    [
      'existing directories without slash fail before mutation',
      /existing directories without `\/` fail/,
    ],
    ['missing paths remain valid', /missing\s+paths remain valid/],
    [
      'scope is not inferred from prose authorization or artifacts',
      /Never infer scope or authorization from prose, paths, (?:or )?titles/,
    ],
    ['plan delta commands stay fail closed', /Plan-delta commands are fail closed/],
  ]

  for (const [name, pattern] of semantics) assertTextMatches(skill, pattern, name)
})

test('current docs describe the delivered append-scope lifecycle contract', () => {
  const handbook = text('docs/HANDBOOK.md')
  const design = text('docs/DESIGN.md')
  for (const content of [handbook, design]) {
    assertTextMatches(content, /`append-scope`/)
    assertTextMatches(content, /scope-only/)
    assertTextMatches(content, /user_delta/)
    assertTextMatches(content, /user_approve/)
    assertTextMatches(content, /workspace_proof/)
  }
  assertTextMatches(handbook, /latch append-scope <task-id> --expect-revision <revision>/)
  assertTextMatches(handbook, /不修改 `goal`[\s\S]*`verification_plan`/)
  assertTextMatches(design, /不采集 workspace[\s\S]*历史 sidecar/)
})

test('current docs describe the delivered update-verification-command lifecycle contract', () => {
  const handbook = text('docs/HANDBOOK.md')
  const design = text('docs/DESIGN.md')
  for (const content of [handbook, design]) {
    assertTextMatches(content, /`update-verification-command`/)
    assertTextMatches(content, /gate-command-only/)
    assertTextMatches(content, /user_delta/)
    assertTextMatches(content, /user_approve/)
  }
  assertTextMatches(
    handbook,
    /latch update-verification-command <task-id> --expect-revision <revision>/,
  )
  assertTextMatches(handbook, /exact name[\s\S]*`kind: gate`/)
  assertTextMatches(handbook, /保留既有 baseline/)
  assertTextMatches(design, /保留既有 `workspace_proof` baseline/)
  assertTextMatches(design, /不运行新旧 gate command/)
})

test('current docs describe the delivered resolve-open-questions lifecycle contract', () => {
  const handbook = text('docs/HANDBOOK.md')
  const design = text('docs/DESIGN.md')
  for (const content of [handbook, design]) {
    assertTextMatches(content, /`resolve-open-questions`/)
    assertTextMatches(content, /decision_recorded/)
    assertTextMatches(content, /workspace_proof/)
  }
  assertTextMatches(
    handbook,
    /latch resolve-open-questions <task-id> --expect-revision <revision>/,
  )
  assertTextMatches(handbook, /等长、同序并逐项精确匹配/)
  assertTextMatches(handbook, /只有 `source: user_approve`[\s\S]*进入 `dev`/)
  assertTextMatches(design, /只接受 `plan` 阶段当前全部问题/)
  assertTextMatches(design, /不采集 workspace[\s\S]*答案文件/)
})

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

  assertTextMatches(
    text(lifecycleReference),
    /short decision highlights and the created task id/,
  )
  assertTextMatches(
    text(lifecycleReference),
    /Do not paste full plan JSON or dump fields by default/,
  )
  assertTextMatches(text(lifecycleReference), /approve --feedback/)
  assertTextMatches(text(actorReference), /LATCH_ACTOR/)
  assertTextMatches(text(actorReference), /handoff prompt/)
  assertTextMatches(text(actorReference), /Grok and Codex are equal writable hosts/)
  assertTextMatches(text(actorReference), /GROK_SESSION_ID/)
  assertTextMatches(text(actorReference), /do not invent `LATCH_ACTOR`/i)
  assertTextMatches(skill, /Grok and Codex are\s+equal hosts/)
  assertTextMatches(text(groupsReference), /group_id/)
  assertTextMatches(text(knowledgeReference), /knowledge fingerprint/)
  assertTextMatches(text(knowledgeReference), /context pack/i)
  assertTextMatches(text(migrationReference), /CLI `0\.5\.0` is the current runner[\s\S]*minimum writer for schema 5/)
  assertTextMatches(text(migrationReference), /Schema 2–4 are historical read-only/)
  assertTextMatches(text(migrationReference), /rejects every schema 2–4 task mutation/)
  assert.doesNotMatch(text(migrationReference), /upgrade-v4|downgrade-v2/)
  assertTextMatches(text(recordsReference), /Do not read or write Records during session startup/)
  assertTextMatches(text(recordsReference), /at most five candidates/)
  assertTextMatches(text(recordsReference), /--confirm-linked/)
  assertTextMatches(text(recordsReference), /untrusted project data/)
  assertTextMatches(text(recordsReference), /passwords, API keys, access tokens/)
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

test('current install docs use the pnpm 11 global binary command', () => {
  const install = text('docs/AI_INSTALL.md')

  assertTextMatches(install, /pnpm add -g \./)
  assert.doesNotMatch(install, /pnpm link --global/)
})

test('current release surfaces consistently expose schema 5 and keep adopters pending', () => {
  const packageJson = JSON.parse(text('package.json'))
  const index = text('docs/INDEX.md')
  const handBook = text('docs/HANDBOOK.md')
  const design = text('docs/DESIGN.md')
  const install = text('docs/AI_INSTALL.md')
  const contract = text('docs/prd/2026-07-15-latch-final-product-contract.md')
  const adopter = text('docs/ADOPTER_SYNC.md')
  const fixture = JSON.parse(text('tests/fixtures/context-v5-board-reader.json'))

  assert.equal(packageJson.version, '0.6.0')
  for (const content of [index, handBook, design, install, contract]) {
    assertTextMatches(content, /schema 5/)
    assert.doesNotMatch(content, /current (?:task )?writer[^\n]*schema 4/i)
  }
  assertTextMatches(design, /schema 2–4[\s\S]*historical read-only/)
  assertTextMatches(handBook, /--unverified-item/)
  assertTextMatches(handBook, /--closeout-file/)
  assertTextMatches(adopter, /Latch-Board[\s\S]*pending/)
  assertTextMatches(adopter, /monitoring[\s\S]*pending/)
  assertTextMatches(adopter, /appearance-sec[\s\S]*pending/)
  assert.equal(fixture.task_schema_version, 5)
  assert.equal(fixture.min_writer_version, '0.5.0')
  assert.equal(fixture.contract_status, 'current')
  assert.equal(fixture.external_adopter_status, 'pending')
  assert.deepEqual(fixture.views.review_stale.status.next_action, {
    kind: 'command',
    command: 'reopen-review',
  })
  assert.deepEqual(fixture.views.review_stale.status.after_takeover_next_action, {
    kind: 'command',
    command: 'reopen-review',
  })
})

test('review stale recovery is consistent across current docs and canonical skill', () => {
  const skill = text('skills/latch/SKILL.md')
  assertTextMatches(skill, /`reopen_review`[\s\S]*task lifecycle/)
  assertTextMatches(text(lifecycleReference), /reopen-review/)
  assertTextMatches(text(lifecycleReference), /reopen_review/)
  for (const content of [
    text(lifecycleReference),
    text('docs/HANDBOOK.md'),
    text('docs/DESIGN.md'),
  ]) {
    assertTextMatches(content, /reopen-review/)
    assertTextMatches(content, /verify-all/)
    assertTextMatches(content, /submission/)
  }
  // envelope 3 machine routing uses typed reopen-review; Board summary may still
  // expose schema5_view.reviewer_next_action string reopen_review.
  assertTextMatches(text('docs/HANDBOOK.md'), /reviewer_next_action/)
  assertTextMatches(text('docs/DESIGN.md'), /after_takeover_next_action/)
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
  assertTextMatches(index, /2026-07-15-latch-final-product-contract\.md/)
  assert.doesNotMatch(index, /Latch v2 PRD\]\(prd\/2026-07-10-latch-v2\.md\)[\s\S]*唯一产品契约/)
  for (const content of [handBook, agents, skill]) {
    assertTextMatches(content, /A[：:][\s\S]{0,100}grill/i)
    assertTextMatches(content, /B[：:][\s\S]{0,100}light/i)
    assertTextMatches(content, /C[：:][\s\S]{0,220}standard/i)
  }
})

test('decided design status sync stays Light and adjacent Standard approval fails closed', () => {
  const surfaces = [
    text('docs/prd/2026-07-15-latch-final-product-contract.md'),
    text('docs/HANDBOOK.md'),
    text('docs/DESIGN.md'),
    text('AGENTS.md'),
    text('skills/latch/SKILL.md'),
  ]

  for (const content of surfaces) {
    assertTextMatches(content, /frozen|已冻结/)
    assertTextMatches(content, /`open_questions`/)
    assertTextMatches(content, /explicitly approved|明确批准/)
    assertTextMatches(content, /artifact status|artifact 状态/)
    assertTextMatches(content, /index metadata|索引元数据/)
    assertTextMatches(content, /Light|light task/)
    assertTextMatches(content, /product choice|产品选择/)
    assertTextMatches(content, /source task|来源.*task/i)
    assertTextMatches(content, /writer/)
    assertTextMatches(content, /scope/)
    assertTextMatches(content, /checkpoint/)
    assertTextMatches(content, /material|材料/)
    assertTextMatches(content, /warning/)
    assertTextMatches(content, /ordinary write request|普通写入请求/)
  }

  const routed = `${text('skills/latch/SKILL.md')}\n${text('docs/HANDBOOK.md')}`
  assertTextMatches(routed, /`proposed`[\s\S]*`approved`[\s\S]*Standard/)
  assertTextMatches(routed, /same task|同一 task/)
  assertTextMatches(routed, /reverify|重新验证/)
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
    assertTextMatches(content, /机械检查[\s\S]{0,100}不(?:单独)?触发/)
    assertTextMatches(content, /多个独立验收面/)
    assertTextMatches(content, /产品选择/)
    assertTextMatches(content, /公共契约/)
    assertTextMatches(
      content,
      /Light task[\s\S]{0,160}plan change[\s\S]{0,160}scope 扩大[\s\S]{0,200}A\/B\/C/,
    )
    assertTextMatches(
      content,
      /Core[\s\S]{0,120}(?:不根据|不统计|不读取)[\s\S]{0,80}gate/,
    )
  }

  assertTextMatches(skill, /Mechanical lint, typecheck, build, or documentation-index/)
  assertTextMatches(skill, /do not alone\s+trigger C/)
  assertTextMatches(skill, /gate count never selects a profile/)
  assertTextMatches(skill, /independent acceptance surfaces/)
  assertTextMatches(skill, /fixed, low-risk scope/)
  assertTextMatches(skill, /a product choice/)
  assertTextMatches(skill, /public\s+contract/)
  assertTextMatches(skill, /migration/)
  assertTextMatches(skill, /authentication/)
  assertTextMatches(skill, /destructive data handling/)
  assertTextMatches(
    skill,
    /implementation reveals missing[\s\S]*plan change[\s\S]*scope\s+expansion[\s\S]*re-run A\/B\/C/,
  )
  assertTextMatches(skill, /A stays in grill/)
  assertTextMatches(skill, /B needs a precise delta\s+authorization/)
  assertTextMatches(
    skill,
    /C shows short decision highlights[\s\S]*normally the created task id[\s\S]*reapproval/,
  )
  assertTextMatches(skill, /Core applies structure and\s+revision changes/)
  assertTextMatches(skill, /never classifies from gate count/)
  assert.doesNotMatch(skill, /disputed\/multiple gates/)
})

test('canonical skill routes lifecycle safety without weakening it', () => {
  const skill = text('skills/latch/SKILL.md')
  const lifecycle = text(lifecycleReference)
  const routed = `${skill}\n${lifecycle}`
  assertTextMatches(skill, /pure Q&A/i)
  assertTextMatches(skill, /Chat shows only the goal[\s\S]*material scope/)
  assertTextMatches(skill, /After explicit implementation authorization/)
  assertTextMatches(skill, /Do not paste the plan JSON by\s+default/)
  assertTextMatches(
    routed,
    /implementation reveals missing[\s\S]*changed root cause[\s\S]*new product choice[\s\S]*scope\s+expansion[\s\S]*stop/,
  )
  assertTextMatches(
    skill,
    /C shows short decision highlights[\s\S]*normally the created task id[\s\S]*reapproval/,
  )
  assertTextMatches(skill, /writer mismatch is fail closed/)
  assertTextMatches(skill, /Takeover transfers writer ownership only, never implementation approval/)
  assertTextMatches(lifecycle, /implementation correction/)
  assertTextMatches(lifecycle, /non-implementation-feedback/)
  assertTextMatches(skill, /every named gate/)
  assertTextMatches(skill, /Run `done` only after explicit completion\/archive authorization/)
  assertTextMatches(skill, /`abandon`[\s\S]*only after explicit cancellation authorization/)
  assertTextMatches(skill, /Never perform Git add, commit, push, branch, reset, checkout, or clean/)
})

test('canonical skill keeps execution paths and routes low-frequency closeout', () => {
  const skill = text('skills/latch/SKILL.md')
  const lifecycle = text(lifecycleReference)
  const actor = text(actorReference)
  assertTextMatches(skill, /### Ordinary Light task/)
  assertTextMatches(skill, /checkpoint[\s\S]*--profile light[\s\S]*--authorize-request/)
  assertTextMatches(skill, /### Standard plan/)
  assertTextMatches(skill, /Chat shows only the goal/)
  assertTextMatches(skill, /Latch-Board or `context <task-id>`/)
  assertTextMatches(skill, /approve <task-id> --expect-revision <n>/)
  assertTextMatches(skill, /### Review, recovery, and closeout/)
  assertTextMatches(skill, /task lifecycle/)
  assertTextMatches(actor, /takeover <task-id> --expect-revision <revision>/)
  assertTextMatches(lifecycle, /Before `done`[\s\S]*submission\.unverified_items/)
  assertTextMatches(lifecycle, /--closeout-file <path>/)
  assertTextMatches(skill, /Takeover transfers writer ownership only, never implementation approval/)
  assertTextMatches(skill, /Run `done` only after explicit completion\/archive authorization/)
  assertTextMatches(skill, /Git\s+delivery remains separate/)
  assertTextMatches(lifecycle, /exactly one resolution[\s\S]*for every item ID/)
})

test('canonical skill bounds large command output without creating a new workflow', () => {
  const skill = text('skills/latch/SKILL.md')
  const lifecycle = text(lifecycleReference)
  assertTextMatches(skill, /above 50 (?:worktree )?entries/i)
  assertTextMatches(skill, /totals, status counts, and at most eight paths/)
  assertTextMatches(skill, /unless the full list is requested/)
  assertTextMatches(skill, /Avoid a full `git diff` unless review or exact\s+patch evidence/)
  assertTextMatches(skill, /never join high-output commands with `;`/)
  assertTextMatches(lifecycle, /Do not rerun an already passed, non-stale full build/)
})

test('canonical skill keeps high-frequency scope and isolation rules in the main file', () => {
  const skill = text('skills/latch/SKILL.md')
  assertTextMatches(skill, /do not read other Codex conversations/i)
  assertTextMatches(
    skill,
    /Do not read or write\s+Records during startup, task recovery, or ordinary discussion without explicit\s+Record intent/,
  )
  assertTextMatches(skill, /every task mutation/)
  assertTextMatches(skill, /one uninterrupted mutation\s+flow/)
  assertTextMatches(skill, /successful JSON response's `revision`/)
  assertTextMatches(skill, /Refresh status after a revision conflict/)
  assertTextMatches(skill, /`verify-all` for pending gates/)
  assertTextMatches(skill, /`artifact add\|remove` for artifact-only changes/)
})

test('dev and check corrections use verify-all instead of review feedback', () => {
  const contents = [
    text('skills/latch/SKILL.md'),
    text(lifecycleReference),
    text('docs/HANDBOOK.md'),
  ]
  for (const content of contents) {
    assertTextMatches(content, /`dev` or `check`|`dev` 或 `check`/)
    assertTextMatches(content, /`approve --feedback`/)
    assertTextMatches(content, /`verify-all`/)
    assertTextMatches(content, /proof generation/)
  }
})

test('task lifecycle avoids redundant gate plans without allowing execution skips', () => {
  const lifecycle = text(lifecycleReference)
  assertTextMatches(lifecycle, /every gate must add distinct proof/)
  assertTextMatches(lifecycle, /final comprehensive gate[\s\S]*typecheck, build, or the full test suite/)
  assertTextMatches(lifecycle, /development diagnostics[\s\S]*distinct acceptance requirement/)
  assertTextMatches(lifecycle, /Once approved, never skip a named gate/)
  assertTextMatches(lifecycle, /Run every named gate from the approved plan/)
})

test('descriptive commands cannot stand in for automatic or manual gate evidence', () => {
  const skill = text('skills/latch/SKILL.md')
  const lifecycle = text(lifecycleReference)
  const handBook = text('docs/HANDBOOK.md')

  for (const content of [lifecycle, handBook]) {
    assertTextMatches(content, /`echo`/)
    assertTextMatches(content, /`printf`/)
    assertTextMatches(content, /`true`/)
    assertTextMatches(content, /diagnostic/)
    assertTextMatches(content, /submission\.unverified/)
  }

  assertTextMatches(skill, /instruction-only commands[\s\S]*are not evidence/)
  assertTextMatches(lifecycle, /zero exit code[\s\S]*does not prove that a manual step occurred/)
  assertTextMatches(lifecycle, /diagnostic success never verifies the manual action/)
  assertTextMatches(handBook, /只输出操作说明的命令不得配置为 gate/)
  assertTextMatches(handBook, /返回 0[\s\S]*不能证明手工步骤已经执行/)
  assertTextMatches(handBook, /具体操作与观察结果/)
})

test('current docs describe compact verification, artifact, and warning commands', () => {
  const skill = text('skills/latch/SKILL.md')
  const handBook = text('docs/HANDBOOK.md')
  const contract = text('docs/prd/2026-07-15-latch-final-product-contract.md')
  for (const content of [skill, handBook, contract]) {
    assertTextMatches(content, /verify-all/)
    assertTextMatches(content, /artifact add\|remove|artifact add/)
    assertTextMatches(content, /--verbose-warnings/)
  }
  assertTextMatches(handBook, /首个失败 gate[\s\S]*停止/)
  assertTextMatches(handBook, /最多 8 个样本/)
  assertTextMatches(contract, /每项仍独立记录 event 和 revision/)
})

test('current docs and canonical skill describe the bounded gate output contract', () => {
  const skill = text('skills/latch/SKILL.md')
  const handBook = text('docs/HANDBOOK.md')
  const design = text('docs/DESIGN.md')
  for (const content of [skill, handBook, design]) {
    assertTextMatches(content, /bounded|有界|固定容量/)
    assertTextMatches(content, /--verbose/)
    assertTextMatches(content, /JSON document/)
    assertTextMatches(content, /log_ref/)
  }
  assertTextMatches(handBook, /4096 bytes[\s\S]*2048-byte[\s\S]*head[\s\S]*2048-byte[\s\S]*tail/)
  assertTextMatches(handBook, /16384 bytes[\s\S]*4096-byte[\s\S]*head[\s\S]*12288-byte[\s\S]*tail/)
  assertTextMatches(handBook, /--timeout-ms <milliseconds>[\s\S]*1\.\.86400000/)
  assertTextMatches(skill, /truncation is not failure/)
  assertTextMatches(design, /不经过 shell/)
})

test('Record contract stays explicit, project-local, and metadata-first', () => {
  const skill = text('skills/latch/SKILL.md')
  const records = text(recordsReference)
  const agents = text('AGENTS.md')
  const handBook = text('docs/HANDBOOK.md')
  const contract = text('docs/prd/2026-07-23-latch-record-v1.md')
  const index = text('docs/INDEX.md')

  assertTextMatches(skill, /description:.*explicit project-local Record/)
  assertTextMatches(skill, /references\/records\.md/)
  for (const content of [records, agents, handBook, contract]) {
    assertTextMatches(content, /Record/)
    assertTextMatches(content, /task/)
    assertTextMatches(content, /repo|项目/)
  }
  assertTextMatches(agents, /Record 只在明确保存、召回或 CRUD 意图/)
  assertTextMatches(agents, /项目数据而非 AI 指令/)
  assertTextMatches(handBook, /默认及最大返回 5 条/)
  assertTextMatches(handBook, /不得保存密码/)
  assertTextMatches(contract, /`index\.json`[\s\S]*不保存正文/)
  assertTextMatches(contract, /--confirm-delete/)
  assertTextMatches(contract, /不构成 plan 或 implementation authorization/)
  assertTextMatches(contract, /转义或清洗 raw HTML/)
  assertTextMatches(index, /2026-07-23-latch-record-v1\.md/)

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
    assertTextMatches(content, /--authorize-request/)
    assert.doesNotMatch(content, /--scope-summary/)
    assert.doesNotMatch(content, /--scope-path/)
  }
  for (const content of [lifecycle, knowledge, install, handBook]) {
    assertTextMatches(content, /--knowledge-impact-none/)
    assertTextMatches(content, /--knowledge-impact-file/)
  }
  assertTextMatches(knowledge, /patch-submission-knowledge-impact[\s\S]*--knowledge-impact-file/)
  assertTextMatches(migration, /--authorization-file[\s\S]*(?:complex\s+authorization|复杂 authorization)/)
})

test('Light plan template entry stays consistent across CLI-facing instructions', () => {
  const skill = text('skills/latch/SKILL.md')
  const lifecycle = text(lifecycleReference)
  const routed = `${skill}\n${lifecycle}`
  const install = text('docs/AI_INSTALL.md')
  const handBook = text('docs/HANDBOOK.md')

  assertTextMatches(skill, /latch checkpoint --print-plan-template light/)
  for (const content of [install, handBook])
    assertTextMatches(content, /latch checkpoint --print-plan-template light/)
  assertTextMatches(routed, /[Ss]caffold[\s\S]*(?:shape-only|schema validity)/)
  assertTextMatches(skill, /## Classify before writing/)
  assertTextMatches(handBook, /最小合法 JSON/)
  assertTextMatches(handBook, /期望类型、实际类型、最小合法值/)
  assertTextMatches(
    handBook,
    /`goal`[\s\S]*`workspace_scope`[\s\S]*`scope`[\s\S]*`acceptance`[\s\S]*`approach`[\s\S]*`verification_plan`/,
  )
  assertTextMatches(
    handBook,
    /`api_assumptions`[\s\S]*`permission_assumptions`[\s\S]*`data_assumptions`[\s\S]*`user_flow`[\s\S]*`out_of_scope`[\s\S]*`open_questions`/,
  )
  assertTextMatches(handBook, /完整 `TaskPlan`/)
  assertTextMatches(routed, /authorizable validation/)
  assertTextMatches(skill, /12 Standard fields/)
  assertTextMatches(handBook, /Standard scaffold 继续包含完整\s+12 字段/)
})

test('startup reads context and project docs only when conditions require them', () => {
  const skill = text('skills/latch/SKILL.md')
  const agents = text('AGENTS.md')
  const handBook = text('docs/HANDBOOK.md')

  for (const content of [skill, agents, handBook]) {
    assertTextMatches(content, /current_task_id/)
    assertTextMatches(content, /task ID/)
    assertTextMatches(content, /docs\/INDEX\.md/)
  }
  assertTextMatches(skill, /if neither exists,\s+do not call context/i)
  assertTextMatches(agents, /两者都没有时[，,]?\s*不得调用/)
  assertTextMatches(handBook, /不含 `current_task_id`[\s\S]*不得调用/)
  assertTextMatches(
    skill,
    /only when the task affects product contracts|only when[\s\S]{0,80}affects product contracts/,
  )
  assertTextMatches(agents, /仅在产品契约/)
  assertTextMatches(handBook, /简单且证据充分的改动不固定读取项目文档/)
})

test('canonical skill stops immediately when Latch is not initialized', () => {
  const skill = text('skills/latch/SKILL.md')

  assertTextMatches(skill, /`not_initialized`: stop/)
  assertTextMatches(skill, /no template\/plan\/`checkpoint`\/`init`/)
  assertTextMatches(skill, /Explicit\s+one-off\/no-Latch proceeds/)
  assertTextMatches(skill, /await init choice/)
})

test('continuous mutation flows reuse returned revision without redundant context reads', () => {
  const skill = text('skills/latch/SKILL.md')
  const agents = text('AGENTS.md')
  const handBook = text('docs/HANDBOOK.md')
  const install = text('docs/AI_INSTALL.md')
  const templateMatch = install.match(
    /<!-- LATCH:BEGIN -->([\s\S]*?)<!-- LATCH:END -->/,
  )
  assert.ok(templateMatch, 'AI_INSTALL must contain the bounded adopter AGENTS template')
  const adopterTemplate = templateMatch[1]

  for (const content of [skill, agents, handBook, install, adopterTemplate]) {
    assertTextMatches(content, /JSON[\s\S]*`revision`/)
    assertTextMatches(content, /--expect-revision/)
    assertTextMatches(content, /`next_action`/)
    assertTextMatches(content, /revision conflict/)
    assertTextMatches(content, /user input\s+boundary|用户输入\s*边界/)
    assertTextMatches(content, /(?:warning[\s\S]{0,40}判断|判断[\s\S]{0,40}warning|judgment[\s\S]{0,40}warning)/)
    assertTextMatches(content, /task (?:meaning|语义) change|task 语义变化/)
    assertTextMatches(
      content,
      /do not reread context only for `revision` or\s+`next_action`|不得(?:只)?为 `revision` 或\s*`next_action` 重读 context/,
    )
    assertTextMatches(content, /never auto-retry a revision\s+conflict|不(?:得)?自动重试 (?:revision )?conflict/)
  }

  assertTextMatches(adopterTemplate, /`latch --version`[\s\S]*`0\.5\.0`/)
  assertTextMatches(adopterTemplate, /`git status --short`[\s\S]*`latch list --json --brief`/)
  assertTextMatches(adopterTemplate, /已知 task ID[\s\S]*`current_task_id`/)
  assertTextMatches(adopterTemplate, /两者都没有时不得调用无 task ID 的 context/)
})

test('cross-session planning recovery stays artifact-first and bounded', () => {
  const agents = text('AGENTS.md')
  const lifecycle = text(lifecycleReference)
  const handoff = text(actorReference)
  const groups = text(groupsReference)

  assertTextMatches(agents, /常规恢复不得读取其他 Codex 会话/)
  for (const content of [agents, groups]) {
    assertTextMatches(
      content,
      /list --group <(?:group-)?id> --include-archive --json --brief/,
    )
    assertTextMatches(content, /context <task-id> --json --status/)
  }
  assertTextMatches(agents, /不得同时展开多张完整 context 或原始 event/)
  assertTextMatches(handoff, /Read-only orientation does not authorize claim, takeover/)
  assertTextMatches(handoff, /Starting a different task.*is not a takeover/)
  assertTextMatches(groups, /Do not create a planning or anchor task solely/)
  assertTextMatches(agents, /不得只为(?:保存)?聊天连续性创建 planning 或 anchor task/)
  assertTextMatches(lifecycle, /exactly one resolution[\s\S]*for every item ID/)
  assertTextMatches(agents, /schema 5 必须通过 `--closeout-file`/)
  assertTextMatches(groups, /Group membership does not encode task order/)
  assertTextMatches(groups, /do not generate an automatic group-level next task/)
})

test('review closeout reconciles unverified evidence before archive', () => {
  const skill = text('skills/latch/SKILL.md')
  const lifecycle = text(lifecycleReference)
  const handBook = text('docs/HANDBOOK.md')

  assertTextMatches(skill, /task lifecycle/)
  assertTextMatches(lifecycle, /submission\.unverified_items/)
  assertTextMatches(handBook, /submission\.unverified_items/)

  assertTextMatches(skill, /archive intent alone[\s\S]{0,30}is not risk[\s\S]{0,20}acceptance/i)
  assertTextMatches(lifecycle, /latest explicit review[\s\S]*acceptance/)
  assertTextMatches(lifecycle, /followup\.owner\.account_uri/)
  assertTextMatches(lifecycle, /absolute credential-free `https:` URL/)
  assertTextMatches(lifecycle, /`accepted_by: "user"` and `recorded_at`/)
  assertTextMatches(lifecycle, /remain in review and ask for it/)
  assertTextMatches(handBook, /归档请求本身不表示接受剩余风险/)
  assertTextMatches(handBook, /`resolved`[\s\S]*观察结果/)
  assertTextMatches(handBook, /`accepted_risk`[\s\S]*明确用户接受/)
  assertTextMatches(handBook, /`followup`[\s\S]*稳定 external[\s\S]*owner/)
})

test('cross-session handoff requires takeover separate from implementation approval', () => {
  const handBook = text('docs/HANDBOOK.md')
  const actor = text('docs/prd/2026-07-15-latch-actor-writer-affinity-draft.md')
  const skill = text('skills/latch/SKILL.md')
  const handoff = text(actorReference)
  for (const content of [handBook, actor, handoff]) {
    assertTextMatches(content, /新对话|new conversation/)
    assertTextMatches(content, /takeover/)
    assertTextMatches(content, /implementation approval|implementation approval|实施批准/)
    assertTextMatches(content, /provenance.*clean|`provenance: clean`/)
  }
  assertTextMatches(skill, /Takeover transfers writer ownership only, never implementation approval/)
  assertTextMatches(skill, /references\/session-actors-and-handoff\.md/)
  assertTextMatches(handoff, /task-id/)
  assertTextMatches(handoff, /phase\/revision/)
  assertTextMatches(handoff, /old-writer/)
  assertTextMatches(handoff, /Unfinished work/)
  assertTextMatches(handoff, /Worktree status/)
  assertTextMatches(handoff, /old session must stop writing/)
  assertTextMatches(handoff, /takeover <task-id>[\s\S]*--expect-revision <revision>[\s\S]*--json/)
  assertTextMatches(handoff, /takeover first[\s\S]*returned JSON `revision`[\s\S]*approve/)
  assertTextMatches(handoff, /save <task-id>[\s\S]*--expect-revision <n>[\s\S]*--provenance mixed[\s\S]*--json/)
})

test('skill scripts manage links without copied docs snapshots', () => {
  const link = text('scripts/link-latch-skill.sh')
  const check = text('scripts/check-latch-skill.sh')
  assertTextMatches(link, /ln -s/)
  assert.doesNotMatch(link, /\bcp\b/)
  assert.doesNotMatch(link, /rm -rf/)
  assertTextMatches(link, /Refusing to replace non-symlink path/)
  assertTextMatches(check, /-L/)
  assert.equal(lstatSync(join(root, 'skills/latch')).isDirectory(), true)
})
