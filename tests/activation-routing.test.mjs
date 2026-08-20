import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = 'tests/fixtures/latch-activation-routing-v1.json'
const requiredCaseIds = [
  'low-risk-local-fix',
  'ordinary-docs-edit',
  'known-task-continuation',
  'public-contract-change',
  'permission-change',
  'cross-session-recovery',
]

function text(path) {
  return readFileSync(join(root, path), 'utf8')
}

function route(signals, enableKeys) {
  if (signals.explicit_no_latch) {
    if (signals.known_task_continuation || signals.closeout_duty) return 'latch'
    return 'direct'
  }
  return enableKeys.some((key) => signals[key] === true) ? 'latch' : 'direct'
}

test('activation routing fixture covers required scenes and keeps write intent direct', () => {
  const fixture = JSON.parse(text(fixturePath))
  assert.equal(fixture.schema_version, 1)
  assert.equal(Array.isArray(fixture.enable_keys), true)
  assert.equal(fixture.enable_keys.includes('latch_support'), false)
  assert.equal(fixture.enable_keys.includes('write_intent'), false)
  assert.equal(fixture.enable_keys.includes('explicit_no_latch'), false)

  const byId = new Map(fixture.cases.map((item) => [item.id, item]))
  for (const id of requiredCaseIds) {
    assert.equal(byId.has(id), true, `missing required routing case ${id}`)
  }

  assert.deepEqual(byId.get('low-risk-local-fix').signals, { latch_support: true })
  assert.deepEqual(byId.get('write-intent-only').signals, { write_intent: true })
  assert.deepEqual(byId.get('ordinary-docs-edit').signals, {
    latch_support: true,
    write_intent: true,
  })

  for (const key of fixture.enable_keys) {
    const covered = fixture.cases.some(
      (item) => item.signals[key] === true && item.expect === 'latch',
    )
    assert.equal(covered, true, `missing latch-positive case for enable key ${key}`)
  }

  for (const item of fixture.cases) {
    const actual = route(item.signals ?? {}, fixture.enable_keys)
    assert.equal(actual, item.expect, item.id)
  }

  assert.equal(route({ latch_support: true }, fixture.enable_keys), 'direct')
  assert.equal(route({ write_intent: true }, fixture.enable_keys), 'direct')
  assert.equal(
    route({ latch_support: true, write_intent: true }, fixture.enable_keys),
    'direct',
  )
  assert.equal(
    route({ explicit_no_latch: true, write_intent: true }, fixture.enable_keys),
    'direct',
  )
  assert.equal(
    route(
      { explicit_no_latch: true, known_task_continuation: true },
      fixture.enable_keys,
    ),
    'latch',
  )
  assert.equal(
    route({ explicit_no_latch: true, closeout_duty: true }, fixture.enable_keys),
    'latch',
  )
})

test('canonical skill always-loaded text covers the restored enable conditions', () => {
  const skill = text('skills/latch/SKILL.md')
  assert.match(skill, /needed\s+confirmation/)
  assert.match(skill, /goal,\s+root cause,\s+approach/)
  assert.match(skill, /persistence[\s\S]{0,40}schema[\s\S]{0,40}concurrency/)
  assert.match(skill, /irreversible side effects/)
  assert.match(skill, /wide[\s\S]{0,20}impact\/cross-session|wide impact[\s\S]{0,20}cross-session/)
  assert.match(skill, /machine proof/)
})

test('instruction surfaces decouple .latch and ordinary writes from task creation', () => {
  const skill = text('skills/latch/SKILL.md')
  const agents = text('AGENTS.md')
  const handBook = text('docs/HANDBOOK.md')
  const design = text('docs/DESIGN.md')
  const install = text('docs/AI_INSTALL.md')
  const contract = text('docs/prd/2026-07-15-latch-final-product-contract.md')
  const triggers = text('docs/prd/2026-07-15-latch-workflow-triggers-draft.md')
  const scenarios = text('docs/SCENARIOS.md')
  const templateMatch = install.match(
    /<!-- LATCH:BEGIN -->([\s\S]*?)<!-- LATCH:END -->/,
  )
  assert.ok(templateMatch, 'AI_INSTALL must contain the bounded adopter AGENTS template')
  const adopterTemplate = templateMatch[1]

  const surfaces = [
    skill,
    agents,
    handBook,
    design,
    install,
    adopterTemplate,
    contract,
    triggers,
    scenarios,
  ]

  for (const content of surfaces) {
    assert.match(content, /不单独(?:创建|建) task|only marks support|not task\s+creation/)
  }

  for (const content of [handBook, design, install, adopterTemplate, contract, triggers, scenarios]) {
    assert.match(content, /bookkeeping[\s\S]{0,40}不是必要验证/)
  }

  assert.match(skill, /run narrow checks/)
  assert.match(agents, /直做并验证/)

  assert.match(skill, /never for write intent alone/)
  assert.match(skill, /Existing `\.latch` only marks support/)
  assert.match(skill, /Create a task only/)
  assert.match(skill, /Explicit no-Latch skips Latch\s+only/)
  assert.match(skill, /known continuation\/closeout/)
  assert.match(skill, /public contract/)
  assert.match(skill, /machine proof/)
  assert.match(agents, /普通写入不单独建 task/)
  assert.match(agents, /不用 Latch/)
  assert.match(handBook, /低风险、局部、单会话/)
  assert.match(handBook, /已知 Latch task 的续接/)
  assert.match(handBook, /公共 API/)
  assert.match(handBook, /权限或其他信任边界/)
  assert.match(handBook, /跨会话/)
  assert.match(handBook, /代码行数或文件数/)
  assert.match(design, /enable 条件/)
  assert.match(triggers, /支持后按需创建/)
  assert.doesNotMatch(triggers, /激活后默认建 light/)
  assert.match(scenarios, /低风险局部修复或普通文档修改/)
  assert.match(scenarios, /公共契约变化或权限/)
  assert.match(scenarios, /跨会话恢复同一已知 task/)
  assert.match(adopterTemplate, /普通写入不单独建 task/)
  assert.doesNotMatch(adopterTemplate, /仓库写入或可观察行为变更使用 Latch/)
})
