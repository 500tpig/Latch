import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  createTaskV3,
  initTaskStoreV2,
} from '../dist/core/task-store.js'
import { readTaskEventsV3 } from '../dist/core/notes-events.js'

const cli = join(process.cwd(), 'dist/cli.js')
const actor = 'codex:session:light-proof'
const temporaryDirectories = []
let fileIndex = 0

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-v3-light-'))
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

function plan(overrides = {}) {
  return {
    goal: '验证 Light 证明包',
    scope: ['src/core/progress.ts'],
    acceptance: ['Light proof tests pass'],
    approach: ['使用 schema 3 临时 fixture'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['authorize -> verify -> submit -> review'],
    out_of_scope: ['R2 product activation'],
    verification_plan: [{
      name: 'gate',
      command: [process.execPath, '-e', 'process.exit(0)'],
      kind: 'gate',
    }],
    open_questions: [],
    ...overrides,
  }
}

function authorization(source = 'user_request') {
  return {
    kind: 'implementation_authorization',
    source,
    reason: `${source} authorization`,
    scope: {
      summary: '实现 Light 证明包',
      paths: ['src/core/progress.ts'],
    },
  }
}

function retrospective(codeUnchanged = false) {
  return {
    kind: 'retrospective_record',
    reason: '记录 task 创建前已完成的实现',
    implemented_before_task: true,
    scope_summary: '已完成 Light fixture',
    ...(codeUnchanged ? { code_unchanged: true } : {}),
  }
}

function impactNone() {
  return { kind: 'none', reason: '本次实现不改变长期知识文档' }
}

function writeJson(cwd, value, prefix) {
  const name = `${prefix}-${fileIndex += 1}.json`
  writeFileSync(join(cwd, name), `${JSON.stringify(value, null, 2)}\n`)
  return name
}

function taskPath(cwd, id) {
  return join(cwd, '.latch', 'tasks', id, 'task.json')
}

function taskDirectory(cwd, id) {
  return join(cwd, '.latch', 'tasks', id)
}

function readTask(cwd, id) {
  return JSON.parse(readFileSync(taskPath(cwd, id), 'utf8'))
}

function writeTask(cwd, task) {
  writeFileSync(taskPath(cwd, task.id), `${JSON.stringify(task, null, 2)}\n`)
}

function revision(cwd, id) {
  return String(readTask(cwd, id).revision)
}

function createV3(cwd, options = {}) {
  const store = initTaskStoreV2(cwd)
  return createTaskV3(store, {
    title: options.title ?? 'Light fixture',
    plan: options.plan ?? plan(),
    profile: options.profile ?? 'light',
    ...(options.workBasis ? { workBasis: options.workBasis } : {}),
    artifacts: options.artifacts ?? [],
  }, actor).task
}

function approve(cwd, id, basis, extra = []) {
  const option = basis.kind === 'implementation_authorization'
    ? '--authorization-file'
    : '--retrospective-file'
  const file = writeJson(cwd, basis, basis.kind)
  return run(cwd, [
    'approve', id, '--expect-revision', revision(cwd, id), option, file,
    ...extra, '--json',
  ])
}

function verify(cwd, id) {
  return run(cwd, [
    'verify', id, '--expect-revision', revision(cwd, id), '--name', 'gate', '--json',
  ])
}

function submit(cwd, id, impact = impactNone(), extra = []) {
  const impactFile = writeJson(cwd, impact, 'impact')
  return run(cwd, [
    'submit', id, '--expect-revision', revision(cwd, id),
    '--changes', '完成实现', '--unverified', '',
    '--knowledge-impact-file', impactFile, ...extra, '--json',
  ])
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('checkpoint CLI atomically creates request and retrospective work basis', () => {
  const cwd = temporaryDirectory()
  assert.equal(run(cwd, ['init']).status, 0)
  const planFile = writeJson(cwd, plan(), 'plan')

  const authorizationFile = writeJson(cwd, authorization(), 'authorization')
  const request = run(cwd, [
    'checkpoint', 'request task', '--plan-file', planFile,
    '--authorization-file', authorizationFile, '--json',
  ])
  assert.equal(request.status, 0, request.stderr)
  const requestTask = readTask(cwd, JSON.parse(request.stdout).task_id)
  assert.equal(requestTask.schema_version, 3)
  assert.equal(requestTask.profile, 'light')
  assert.equal(requestTask.provenance, 'clean')
  assert.equal(requestTask.phase, 'dev')
  assert.equal(requestTask.work_revision, 1)
  assert.equal(requestTask.work_basis.source, 'user_request')
  assert.equal(requestTask.primary_writer, actor)
  assert.deepEqual(
    readTaskEventsV3(taskDirectory(cwd, requestTask.id)).map((event) => event.type),
    ['task_created', 'implementation_authorized', 'work_started'],
  )

  const retrospectiveFile = writeJson(cwd, retrospective(), 'retrospective')
  const standard = run(cwd, [
    'checkpoint', 'standard retrospective', '--plan-file', planFile,
    '--retrospective-file', retrospectiveFile, '--json',
  ])
  assert.equal(standard.status, 0, standard.stderr)
  const standardTask = readTask(cwd, JSON.parse(standard.stdout).task_id)
  assert.equal(standardTask.profile, 'standard')
  assert.equal(standardTask.phase, 'dev')
  assert.equal(standardTask.work_revision, 1)
  assert.equal(standardTask.work_basis.kind, 'retrospective_record')

  const light = run(cwd, [
    'checkpoint', 'light retrospective', '--plan-file', planFile,
    '--profile', 'light', '--retrospective-file', retrospectiveFile, '--json',
  ])
  assert.equal(light.status, 0, light.stderr)
  const lightTask = readTask(cwd, JSON.parse(light.stdout).task_id)
  assert.equal(lightTask.profile, 'light')
  assert.equal(lightTask.work_basis.kind, 'retrospective_record')
})

test('checkpoint rejects invalid basis options before task or state writes', () => {
  const cwd = temporaryDirectory()
  assert.equal(run(cwd, ['init']).status, 0)
  const statePath = join(cwd, '.latch', 'state.json')
  const stateBefore = readFileSync(statePath, 'utf8')
  const planFile = writeJson(cwd, plan(), 'plan')
  const authorizationFile = writeJson(cwd, authorization(), 'authorization')
  const wrongSourceFile = writeJson(
    cwd,
    authorization('user_approve'),
    'wrong-source',
  )
  const retrospectiveFile = writeJson(cwd, retrospective(), 'retrospective')
  const openPlanFile = writeJson(
    cwd,
    plan({ open_questions: ['需要确认'] }),
    'open-plan',
  )
  const nullFile = writeJson(cwd, null, 'null')

  const cases = [
    ['checkpoint', 'wrong source', '--plan-file', planFile, '--authorization-file', wrongSourceFile],
    ['checkpoint', 'combined', '--plan-file', planFile, '--authorization-file', authorizationFile, '--retrospective-file', retrospectiveFile],
    ['checkpoint', 'open questions', '--plan-file', openPlanFile, '--authorization-file', authorizationFile],
    ['checkpoint', 'invalid profile', '--plan-file', planFile, '--profile', 'tiny'],
    ['checkpoint', 'null basis', '--plan-file', planFile, '--authorization-file', nullFile],
  ]
  for (const args of cases) assert.notEqual(run(cwd, args).status, 0, args[1])

  assert.deepEqual(readdirSync(join(cwd, '.latch', 'tasks')), [])
  assert.equal(readFileSync(statePath, 'utf8'), stateBefore)
})

test('light request authorization is atomic and submit stops in review', () => {
  const cwd = temporaryDirectory()
  const task = createV3(cwd, {
    workBasis: authorization(),
    artifacts: [{ kind: 'prd', path: 'docs/light.md' }],
  })

  assert.equal(task.schema_version, 3)
  assert.equal(task.profile, 'light')
  assert.equal(task.provenance, 'clean')
  assert.equal(task.phase, 'dev')
  assert.equal(task.work_revision, 1)
  assert.equal(task.work_basis.kind, 'implementation_authorization')
  assert.equal(task.work_basis.plan_revision, 1)
  assert.equal(task.primary_writer, actor)
  assert.deepEqual(
    readTaskEventsV3(taskDirectory(cwd, task.id)).map((event) => event.type),
    ['task_created', 'implementation_authorized', 'work_started'],
  )

  const context = run(cwd, ['context', task.id, '--json', '--brief'])
  assert.equal(context.status, 0, context.stderr)
  assert.equal(JSON.parse(context.stdout).task.profile, 'light')
  assert.equal(verify(cwd, task.id).status, 0)
  const submitted = submit(cwd, task.id)
  assert.equal(submitted.status, 0, submitted.stderr)

  const reviewed = readTask(cwd, task.id)
  assert.equal(reviewed.phase, 'review')
  assert.equal(reviewed.submission.plan_revision, 1)
  assert.equal(reviewed.submission.work_revision, 1)
  assert.deepEqual(reviewed.submission.knowledge_impact, impactNone())
})

test('light rejects no-verify and validates updated artifact references', () => {
  const noGateRoot = temporaryDirectory()
  const noGateTask = createV3(noGateRoot, {
    plan: plan({ verification_plan: [] }),
    workBasis: authorization(),
  })
  const noVerify = submit(noGateRoot, noGateTask.id, impactNone(), [
    '--no-verify', '--reason', 'fixture',
  ])
  assert.notEqual(noVerify.status, 0)
  assert.match(noVerify.stderr, /Light submit denied/)

  const cwd = temporaryDirectory()
  const task = createV3(cwd, {
    workBasis: authorization(),
    artifacts: [{ kind: 'prd', path: 'docs/light.md' }],
  })
  assert.equal(verify(cwd, task.id).status, 0)
  const invalid = submit(cwd, task.id, {
    kind: 'updated',
    summary: '更新说明',
    artifact_refs: [{ kind: 'prd', path: 'docs/missing.md' }],
  })
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /not attached/)
  assert.equal(readTask(cwd, task.id).phase, 'check')

  const valid = submit(cwd, task.id, {
    kind: 'updated',
    summary: '更新 Light 契约说明',
    artifact_refs: [{ kind: 'prd', path: 'docs/light.md' }],
  })
  assert.equal(valid.status, 0, valid.stderr)
})

test('structured delta authorization and profile changes follow revision rules', () => {
  const cwd = temporaryDirectory()
  const task = createV3(cwd, { profile: 'standard' })
  const approved = approve(cwd, task.id, authorization('user_delta'))
  assert.equal(approved.status, 0, approved.stderr)
  let current = readTask(cwd, task.id)
  assert.equal(current.phase, 'dev')
  assert.equal(current.work_revision, 1)
  assert.equal(current.work_basis.source, 'user_delta')

  const denied = run(cwd, [
    'save', task.id, '--expect-revision', revision(cwd, task.id),
    '--profile', 'light', '--profile-reason', '缩小范围', '--json',
  ])
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /user-requested narrowing/)

  const changed = run(cwd, [
    'save', task.id, '--expect-revision', revision(cwd, task.id),
    '--profile', 'light', '--profile-reason', '用户明确缩小范围',
    '--user-requested-narrowing', '--json',
  ])
  assert.equal(changed.status, 0, changed.stderr)
  current = readTask(cwd, task.id)
  assert.equal(current.profile, 'light')
  assert.equal(current.phase, 'plan')
  assert.equal(current.plan_revision, 2)
  assert.equal(current.work_revision, 1)
  assert.equal(current.work_basis.plan_revision, 1)
  assert.deepEqual(current.verification, { gate: {}, diagnostic: {} })

  const reauthorized = approve(cwd, task.id, authorization('user_approve'))
  assert.equal(reauthorized.status, 0, reauthorized.stderr)
  current = readTask(cwd, task.id)
  assert.equal(current.work_revision, 2)
  assert.equal(current.work_basis.plan_revision, 2)
  assert.equal(current.work_basis.source, 'user_approve')
})

test('retrospective rebind keeps work revision and corrections require authorization', () => {
  const cwd = temporaryDirectory()
  const task = createV3(cwd, { workBasis: retrospective() })
  assert.equal(task.phase, 'dev')
  assert.equal(task.work_revision, 1)
  assert.equal(task.work_basis.kind, 'retrospective_record')
  assert.equal(verify(cwd, task.id).status, 0)
  assert.equal(submit(cwd, task.id).status, 0)

  const correction = run(cwd, [
    'approve', task.id, '--expect-revision', revision(cwd, task.id),
    '--feedback', '继续修改代码', '--json',
  ])
  assert.notEqual(correction.status, 0)
  assert.match(correction.stderr, /authorize first/)

  const profileChanged = run(cwd, [
    'save', task.id, '--expect-revision', revision(cwd, task.id),
    '--profile', 'standard', '--profile-reason', '风险面扩大', '--json',
  ])
  assert.equal(profileChanged.status, 0, profileChanged.stderr)
  let current = readTask(cwd, task.id)
  assert.equal(current.phase, 'plan')
  assert.equal(current.plan_revision, 2)
  assert.equal(current.work_revision, 1)
  assert.equal(current.submission, undefined)

  const rebound = approve(cwd, task.id, retrospective(true))
  assert.equal(rebound.status, 0, rebound.stderr)
  current = readTask(cwd, task.id)
  assert.equal(current.phase, 'dev')
  assert.equal(current.work_revision, 1)
  assert.equal(current.work_basis.plan_revision, 2)
  assert.equal(current.work_basis.work_revision, 1)
})

test('work and plan revisions invalidate proof and basis independently', () => {
  const cwd = temporaryDirectory()
  const task = createV3(cwd, {
    profile: 'standard',
    workBasis: authorization('user_approve'),
  })
  assert.equal(verify(cwd, task.id).status, 0)
  assert.equal(submit(cwd, task.id).status, 0)

  const correction = run(cwd, [
    'approve', task.id, '--expect-revision', revision(cwd, task.id),
    '--feedback', '修正实现', '--json',
  ])
  assert.equal(correction.status, 0, correction.stderr)
  let current = readTask(cwd, task.id)
  assert.equal(current.work_revision, 2)
  assert.equal(current.work_basis.plan_revision, 1)
  assert.equal(current.submission, undefined)
  assert.equal(current.verification.gate.gate.work_revision, 1)
  assert.equal(verify(cwd, task.id).status, 0)
  assert.equal(submit(cwd, task.id).status, 0)

  const nextPlan = plan({ scope: ['src/core/progress.ts', 'src/cli.ts'] })
  const planFile = writeJson(cwd, nextPlan, 'plan')
  const saved = run(cwd, [
    'save', task.id, '--expect-revision', revision(cwd, task.id),
    '--plan-file', planFile, '--json',
  ])
  assert.equal(saved.status, 0, saved.stderr)
  current = readTask(cwd, task.id)
  assert.equal(current.plan_revision, 2)
  assert.equal(current.work_revision, 2)
  assert.equal(current.phase, 'plan')
  assert.equal(current.work_basis.plan_revision, 1)
  assert.deepEqual(current.verification, { gate: {}, diagnostic: {} })

  const stale = verify(cwd, task.id)
  assert.notEqual(stale.status, 0)
  assert.match(stale.stderr, /valid work_basis/)
  const reauthorized = approve(cwd, task.id, authorization('user_approve'))
  assert.equal(reauthorized.status, 0, reauthorized.stderr)
  assert.equal(readTask(cwd, task.id).work_revision, 3)
})

test('standard no-verify and legacy submission patch preserve review facts', () => {
  const noGateRoot = temporaryDirectory()
  const noGateTask = createV3(noGateRoot, {
    profile: 'standard',
    plan: plan({ verification_plan: [] }),
    workBasis: authorization('user_approve'),
  })
  const noVerify = submit(noGateRoot, noGateTask.id, impactNone(), [
    '--no-verify', '--reason', '无需执行 gate',
  ])
  assert.equal(noVerify.status, 0, noVerify.stderr)
  assert.equal(readTask(noGateRoot, noGateTask.id).phase, 'review')

  const cwd = temporaryDirectory()
  const task = createV3(cwd, {
    profile: 'standard',
    workBasis: authorization('user_approve'),
  })
  assert.equal(verify(cwd, task.id).status, 0)
  assert.equal(submit(cwd, task.id).status, 0)
  const legacy = readTask(cwd, task.id)
  const before = {
    phase: legacy.phase,
    work_revision: legacy.work_revision,
    changes: legacy.submission.changes,
    unverified: legacy.submission.unverified,
  }
  delete legacy.submission.plan_revision
  delete legacy.submission.knowledge_impact
  writeTask(cwd, legacy)

  const impactFile = writeJson(cwd, impactNone(), 'patch-impact')
  const patched = run(cwd, [
    'patch-submission-knowledge-impact', task.id,
    '--expect-revision', revision(cwd, task.id),
    '--knowledge-impact-file', impactFile, '--json',
  ])
  assert.equal(patched.status, 0, patched.stderr)
  const current = readTask(cwd, task.id)
  assert.equal(current.phase, before.phase)
  assert.equal(current.work_revision, before.work_revision)
  assert.equal(current.submission.changes, before.changes)
  assert.equal(current.submission.unverified, before.unverified)
  assert.equal(current.submission.plan_revision, current.plan_revision)
  assert.deepEqual(current.submission.knowledge_impact, impactNone())
  assert.equal(
    readTaskEventsV3(taskDirectory(cwd, task.id)).at(-1).type,
    'submission_knowledge_impact_patched',
  )

  const duplicate = run(cwd, [
    'patch-submission-knowledge-impact', task.id,
    '--expect-revision', revision(cwd, task.id),
    '--knowledge-impact-file', impactFile,
  ])
  assert.notEqual(duplicate.status, 0)
  assert.match(duplicate.stderr, /already has knowledge_impact/)
})

test('standard profile can project a current legacy approval', () => {
  const cwd = temporaryDirectory()
  const task = createV3(cwd, { profile: 'standard' })
  const legacy = readTask(cwd, task.id)
  legacy.phase = 'dev'
  legacy.work_revision = 1
  legacy.implementation_approval = {
    approved_plan_revision: 1,
    approved_at: new Date().toISOString(),
    source: 'user',
    reason: 'legacy approval',
  }
  writeTask(cwd, legacy)

  assert.equal(verify(cwd, task.id).status, 0)
  const submitted = submit(cwd, task.id)
  assert.equal(submitted.status, 0, submitted.stderr)
  assert.equal(readTask(cwd, task.id).phase, 'review')
})

test('done revalidates double binding, knowledge impact, and proof', () => {
  const cwd = temporaryDirectory()
  const task = createV3(cwd, { workBasis: authorization() })
  assert.equal(verify(cwd, task.id).status, 0)
  assert.equal(submit(cwd, task.id).status, 0)

  let current = readTask(cwd, task.id)
  current.submission.plan_revision = current.plan_revision + 1
  writeTask(cwd, current)
  const stale = run(cwd, [
    'done', task.id, '--expect-revision', revision(cwd, task.id),
    '--followup', '',
  ])
  assert.notEqual(stale.status, 0)
  assert.match(stale.stderr, /plan_revision is stale/)

  current = readTask(cwd, task.id)
  current.submission.plan_revision = current.plan_revision
  delete current.submission.knowledge_impact
  writeTask(cwd, current)
  const missing = run(cwd, [
    'done', task.id, '--expect-revision', revision(cwd, task.id),
    '--followup', '',
  ])
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /does not have knowledge_impact/)

  current = readTask(cwd, task.id)
  current.submission.knowledge_impact = impactNone()
  writeTask(cwd, current)
  const completed = run(cwd, [
    'done', task.id, '--expect-revision', revision(cwd, task.id),
    '--followup', '', '--json',
  ])
  assert.equal(completed.status, 0, completed.stderr)
  assert.equal(JSON.parse(completed.stdout).outcome, 'done')
})

test('open questions and blocked state reject C2 implementation progress', () => {
  const questionRoot = temporaryDirectory()
  const questionTask = createV3(questionRoot, {
    plan: plan({ open_questions: ['需要先确认范围'] }),
  })
  const questioned = approve(questionRoot, questionTask.id, authorization())
  assert.notEqual(questioned.status, 0)
  assert.match(questioned.stderr, /open_questions/)

  const cwd = temporaryDirectory()
  const task = createV3(cwd)
  const blocked = run(cwd, [
    'save', task.id, '--expect-revision', revision(cwd, task.id),
    '--block-reason', '等待确认', '--waiting-for', '用户', '--json',
  ])
  assert.equal(blocked.status, 0, blocked.stderr)
  const denied = approve(cwd, task.id, authorization())
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /Task is blocked/)
})
