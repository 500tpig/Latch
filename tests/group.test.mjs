import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  archiveTaskV2,
  createTaskV2,
  createTaskV3,
  initTaskStoreV2,
  readArchivedTaskV2,
  readTaskV2,
} from '../dist/core/task-store.js'
import {
  readTaskEventsV3,
  validateTaskEventV3,
} from '../dist/core/notes-events.js'

const cli = join(process.cwd(), 'dist/cli.js')
const actor = 'codex:session:group'
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-v3-group-'))
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
    goal: '验证 Group 最小集',
    scope: ['src/core/task-view.ts'],
    acceptance: ['Group tests pass'],
    approach: ['使用 schema 3 临时 fixture'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: ['group -> list -> context'],
    out_of_scope: ['group lifecycle'],
    verification_plan: [],
    open_questions: [],
    ...overrides,
  }
}

function authorization(paths = ['src/core/task-view.ts']) {
  return {
    kind: 'implementation_authorization',
    source: 'user_approve',
    reason: '批准 Group fixture',
    scope: {
      summary: '实现 Group fixture',
      paths,
    },
  }
}

function createV3(store, title, options = {}) {
  return createTaskV3(store, {
    title,
    plan: options.plan ?? plan(),
    profile: options.profile ?? 'standard',
    ...(options.groupId !== undefined ? { groupId: options.groupId } : {}),
    ...(options.workBasis ? { workBasis: options.workBasis } : {}),
    artifacts: options.artifacts ?? [],
  }, actor).task
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

function revision(cwd, id) {
  return String(readTask(cwd, id).revision)
}

function writeJson(cwd, name, value) {
  writeFileSync(join(cwd, name), `${JSON.stringify(value, null, 2)}\n`)
  return name
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('schema 3 validates optional group ids without changing their exact value', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const grouped = createV3(store, 'grouped', { groupId: ' Wave:Alpha ' })
  const ungrouped = createV3(store, 'ungrouped')

  assert.equal(grouped.group_id, ' Wave:Alpha ')
  assert.equal('group_id' in ungrouped, false)
  assert.throws(
    () => createV3(store, 'blank', { groupId: '  ' }),
    /Invalid group_id/,
  )
  assert.throws(
    () => createV3(store, 'control', { groupId: 'wave:\u0000alpha' }),
    /Invalid group_id/,
  )
  assert.throws(
    () => createV3(store, 'long', { groupId: 'x'.repeat(129) }),
    /Invalid group_id/,
  )
  assert.throws(
    () => validateTaskEventV3({
      type: 'group_changed',
      task_id: grouped.id,
      actor,
      revision: 2,
      created_at: new Date().toISOString(),
      from: 'Wave:Alpha',
      to: 'Wave:Alpha',
    }, 'group event'),
    /Invalid group_changed event/,
  )

  const v2 = createTaskV2(store, { title: 'v2', plan: plan() }, actor).task
  v2.group_id = 'wave:alpha'
  writeFileSync(taskPath(cwd, v2.id), `${JSON.stringify(v2, null, 2)}\n`)
  assert.throws(() => readTaskV2(store, v2.id), /schema_version 3 is required/)
})

test('save changes or clears group metadata without changing lifecycle facts', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createV3(store, 'save group')
  const before = {
    phase: task.phase,
    plan_revision: task.plan_revision,
    work_revision: task.work_revision,
    verification: task.verification,
  }

  const changed = run(cwd, [
    'save', task.id, '--expect-revision', '1',
    '--group', 'Wave:Alpha', '--json',
  ])
  assert.equal(changed.status, 0, changed.stderr)
  let current = readTask(cwd, task.id)
  assert.equal(current.group_id, 'Wave:Alpha')
  assert.deepEqual({
    phase: current.phase,
    plan_revision: current.plan_revision,
    work_revision: current.work_revision,
    verification: current.verification,
  }, before)
  let event = readTaskEventsV3(taskDirectory(cwd, task.id)).at(-1)
  assert.equal(event.type, 'group_changed')
  assert.equal('from' in event, false)
  assert.equal(event.to, 'Wave:Alpha')

  const combined = run(cwd, [
    'save', task.id, '--expect-revision', revision(cwd, task.id),
    '--group', 'Wave:Beta', '--decision', 'combine',
  ])
  assert.notEqual(combined.status, 0)
  assert.match(combined.stderr, /standalone change/)
  assert.equal(readTask(cwd, task.id).group_id, 'Wave:Alpha')

  const duplicate = run(cwd, [
    'save', task.id, '--expect-revision', revision(cwd, task.id),
    '--group', 'Wave:Alpha',
  ])
  assert.notEqual(duplicate.status, 0)
  assert.match(duplicate.stderr, /did not change group_id/)

  const cleared = run(cwd, [
    'save', task.id, '--expect-revision', revision(cwd, task.id),
    '--clear-group', '--json',
  ])
  assert.equal(cleared.status, 0, cleared.stderr)
  current = readTask(cwd, task.id)
  assert.equal('group_id' in current, false)
  event = readTaskEventsV3(taskDirectory(cwd, task.id)).at(-1)
  assert.equal(event.type, 'group_changed')
  assert.equal(event.from, 'Wave:Alpha')
  assert.equal('to' in event, false)

  const v2 = createTaskV2(store, { title: 'frozen v2', plan: plan() }, actor).task
  const denied = run(cwd, [
    'save', v2.id, '--expect-revision', '1', '--group', 'Wave:Alpha',
  ])
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /Schema 3 update requires schema_version 3/)
  const deniedClear = run(cwd, [
    'save', v2.id, '--expect-revision', '1', '--clear-group',
  ])
  assert.notEqual(deniedClear.status, 0)
  assert.match(deniedClear.stderr, /Schema 3 update requires schema_version 3/)
})

test('list filters exact group members and includes archive only on request', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const open = createV3(store, 'open alpha', { groupId: 'Wave:Alpha' })
  const archived = createV3(store, 'done alpha', {
    groupId: 'Wave:Alpha',
    workBasis: authorization(),
  })
  createV3(store, 'other case', { groupId: 'wave:alpha' })
  const blocked = run(cwd, [
    'save', open.id, '--expect-revision', '1',
    '--block-reason', '等待确认', '--waiting-for', '用户', '--json',
  ])
  assert.equal(blocked.status, 0, blocked.stderr)
  archiveTaskV2(store, archived.id, {
    expectRevision: archived.revision,
    actor,
    outcome: 'done',
  })

  const listed = run(cwd, ['list', '--group', 'Wave:Alpha', '--json'])
  assert.equal(listed.status, 0, listed.stderr)
  let output = JSON.parse(listed.stdout)
  assert.deepEqual(output.tasks.map((task) => task.id), [open.id])
  assert.deepEqual(output.group, {
    group_id: 'Wave:Alpha',
    open_count: 1,
    by_phase: { plan: 1 },
    blocked_count: 1,
  })
  assert.equal(output.tasks[0].blocked, true)

  const brief = run(cwd, [
    'list', '--group', 'Wave:Alpha', '--json', '--brief',
  ])
  assert.equal(brief.status, 0, brief.stderr)
  assert.equal(JSON.parse(brief.stdout).tasks[0].profile, 'standard')
  assert.equal(JSON.parse(brief.stdout).tasks[0].group_id, 'Wave:Alpha')

  const history = run(cwd, [
    'list', '--group', 'Wave:Alpha', '--include-archive', '--json',
  ])
  assert.equal(history.status, 0, history.stderr)
  output = JSON.parse(history.stdout)
  assert.deepEqual(new Set(output.tasks.map((task) => task.id)), new Set([
    open.id,
    archived.id,
  ]))
  assert.equal(
    output.tasks.find((task) => task.id === archived.id).outcome,
    'done',
  )
  assert.equal(output.group.done_archived_count, 1)

  const otherCase = run(cwd, ['list', '--group', 'wave:alpha', '--json'])
  assert.equal(JSON.parse(otherCase.stdout).tasks.length, 1)

  const uninitialized = temporaryDirectory()
  const invalid = run(uninitialized, ['list', '--include-archive'])
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /requires --group/)
  assert.equal(existsSync(join(uninitialized, '.latch')), false)
})

test('context returns bounded sibling summaries and structured path hints', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const target = createV3(store, 'target', { groupId: 'Wave:Context' })
  const pathSibling = createV3(store, 'path sibling', {
    groupId: 'Wave:Context',
    workBasis: authorization([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'src/d.ts',
      'src/e.ts',
      'src/f.ts',
    ]),
    artifacts: [{ kind: 'prd', path: 'docs/group.md' }],
  })
  const artifactSibling = createV3(store, 'artifact sibling', {
    groupId: 'Wave:Context',
    artifacts: [{ kind: 'brief', path: 'docs/brief.md' }],
  })
  archiveTaskV2(store, artifactSibling.id, {
    expectRevision: artifactSibling.revision,
    actor,
    outcome: 'done',
  })
  for (let index = 0; index < 19; index += 1)
    createV3(store, `filler ${String(index).padStart(2, '0')}`, {
      groupId: 'Wave:Context',
    })

  const result = run(cwd, [
    'context', target.id, '--json', '--brief',
  ])
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.group.group_id, 'Wave:Context')
  assert.equal(output.group.member_count, 22)
  assert.equal(output.group.siblings.length, 20)
  assert.equal(output.group.truncated, true)
  const withPaths = output.group.siblings.find(
    (sibling) => sibling.task_id === pathSibling.id,
  )
  assert.deepEqual(withPaths.path_hints, [
    'src/a.ts',
    'src/b.ts',
    'src/c.ts',
    'src/d.ts',
    'src/e.ts',
  ])
  const withArtifact = output.group.siblings.find(
    (sibling) => sibling.task_id === artifactSibling.id,
  )
  assert.deepEqual(withArtifact.path_hints, ['docs/brief.md'])
  assert.deepEqual(
    Object.keys(withPaths).sort(),
    ['blocked', 'path_hints', 'phase', 'task_id', 'title'],
  )
  const human = run(cwd, ['context', target.id])
  assert.equal(human.status, 0, human.stderr)
  assert.match(human.stdout, /Sibling:/)

  const ungrouped = createV3(store, 'no group')
  const plain = JSON.parse(
    run(cwd, ['context', ungrouped.id, '--json', '--brief']).stdout,
  )
  assert.equal('group' in plain, false)
})

test('a blocked sibling does not prevent another group member from finishing', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const active = createV3(store, 'active', {
    groupId: 'Wave:Independent',
    workBasis: authorization(),
  })
  const sibling = createV3(store, 'blocked sibling', {
    groupId: 'Wave:Independent',
  })
  const blocked = run(cwd, [
    'save', sibling.id, '--expect-revision', '1',
    '--block-reason', '等待确认', '--waiting-for', '用户', '--json',
  ])
  assert.equal(blocked.status, 0, blocked.stderr)

  const impactFile = writeJson(cwd, 'impact.json', {
    kind: 'none',
    reason: 'Group 标签不改变长期知识',
  })
  const submitted = run(cwd, [
    'submit', active.id, '--expect-revision', revision(cwd, active.id),
    '--changes', '完成 Group fixture', '--unverified', '',
    '--knowledge-impact-file', impactFile,
    '--no-verify', '--reason', 'plan 无 gate', '--json',
  ])
  assert.equal(submitted.status, 0, submitted.stderr)
  const completed = run(cwd, [
    'done', active.id, '--expect-revision', revision(cwd, active.id),
    '--followup', '', '--json',
  ])
  assert.equal(completed.status, 0, completed.stderr)
  assert.equal(readArchivedTaskV2(store, active.id).outcome, 'done')
  assert.equal(readTaskV2(store, sibling.id).blocked.reason, '等待确认')
})
