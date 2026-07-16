import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
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
  currentTaskIdV2,
  initTaskStoreV2,
  listTasksV2,
  openTaskStoreV2,
  readStateV2,
  readTaskV2,
  selectCurrentTaskV2,
  taskHistoryIncompleteV2,
  updateTaskV2,
  updateTaskV3,
  withStateLockV2,
  withTaskLockV2,
} from '../dist/core/task-store.js'
import {
  readTaskEventsV2,
  readTaskEventsV3,
} from '../dist/core/notes-events.js'

const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-v2-store-'))
  temporaryDirectories.push(directory)
  return directory
}

function plan(overrides = {}) {
  return {
    goal: '建立 v2 数据底座',
    scope: ['src/core'],
    acceptance: ['store tests pass'],
    approach: ['使用 schema v2'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: [],
    out_of_scope: ['CLI'],
    verification_plan: [
      { name: 'store', command: ['node', '--test', 'tests/v2-store.test.mjs'], kind: 'gate' },
    ],
    open_questions: [],
    ...overrides,
  }
}

function create(store, title = '相同标题', actor = 'codex:session:a') {
  return createTaskV3(
    store,
    { title, plan: plan(), profile: 'standard' },
    actor,
  ).task
}

function createV2(store, title = '相同标题', actor = 'codex:session:a') {
  return createTaskV2(store, { title, plan: plan() }, actor).task
}

function taskDirectory(store, id) {
  return join(store.paths.tasksDir, id)
}

function uniquePrefix(target, ids) {
  for (let length = 1; length <= target.length; length += 1) {
    const prefix = target.slice(0, length)
    if (ids.filter((id) => id.startsWith(prefix)).length === 1) return prefix
  }
  return target
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('provenance defaults on new and historical tasks without rewriting legacy files', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const current = create(store)
  assert.equal(current.provenance, 'clean')

  const path = join(taskDirectory(store, current.id), 'task.json')
  const historical = JSON.parse(readFileSync(path, 'utf8'))
  delete historical.provenance
  writeFileSync(path, `${JSON.stringify(historical, null, 2)}\n`)
  assert.equal(readTaskV2(store, current.id).provenance, 'clean')
  assert.equal('provenance' in JSON.parse(readFileSync(path, 'utf8')), false)

  const legacy = createV2(store, 'legacy provenance')
  assert.equal(readTaskV2(store, legacy.id).provenance, 'clean')
  assert.throws(
    () => updateTaskV3(store, legacy.id, {
      expectRevision: 1,
      actor: 'codex:session:a',
      events: [{
        type: 'decision_recorded',
        fields: { plan_revision: 1, conclusion: 'set mixed' },
      }],
      update(task) { task.provenance = 'mixed' },
    }),
    /Schema 3 update requires schema_version 3/,
  )
})

test('schema v2 使用毫秒时间和随机后缀，重复标题不覆盖且不创建 notes', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)
  const first = createV2(store)
  const second = createV2(store)

  assert.notEqual(first.id, second.id)
  assert.match(first.id, /^\d{17}-相同标题-[a-f0-9]{6}$/)
  assert.equal(first.schema_version, 2)
  assert.equal(first.revision, 1)
  assert.equal(first.plan_revision, 1)
  assert.equal(first.work_revision, 0)
  assert.deepEqual(first.verification, { gate: {}, diagnostic: {} })
  assert.equal(existsSync(join(taskDirectory(store, first.id), 'notes.md')), false)
  assert.deepEqual(
    listTasksV2(store).map((task) => task.id),
    [first.id, second.id].sort(),
  )

  const events = readTaskEventsV2(taskDirectory(store, first.id))
  assert.deepEqual(events.map((event) => event.type), ['task_created'])
  assert.equal(taskHistoryIncompleteV2(store, first.id), false)
  assert.ok(events.every((event) => event.actor === 'codex:session:a'))
  assert.ok(events.every((event) => event.revision === 1))
})

test('无效创建参数在任何 task 或 current 写入前失败', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)
  const stateBefore = readFileSync(store.paths.statePath, 'utf8')

  assert.throws(
    () => createTaskV2(store, { title: '', plan: plan() }, 'codex:session:a'),
    /Invalid title/,
  )
  assert.deepEqual(readdirSync(store.paths.tasksDir), [])
  assert.equal(readFileSync(store.paths.statePath, 'utf8'), stateBefore)
})

test('子目录复用项目根 .latch，创建 task 时不产生嵌套目录', () => {
  const root = temporaryDirectory()
  const git = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' })
  assert.equal(git.status, 0, git.stderr)
  const store = initTaskStoreV2(root)
  const nested = join(root, 'src', 'feature')
  mkdirSync(nested, { recursive: true })

  const nestedStore = openTaskStoreV2(nested)
  const task = create(nestedStore, '子目录任务')

  assert.equal(nestedStore.paths.workspaceRoot, store.paths.workspaceRoot)
  assert.equal(readTaskV2(store, task.id).id, task.id)
  assert.equal(existsSync(join(nested, '.latch')), false)
})

test('嵌套 Git repo 不跨 Git root 使用父 repo 的 .latch', () => {
  const parent = temporaryDirectory()
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: parent }).status, 0)
  const parentStore = initTaskStoreV2(parent)
  const child = join(parent, 'child')
  mkdirSync(child)
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: child }).status, 0)

  const childStore = initTaskStoreV2(child)

  assert.equal(childStore.paths.workspaceRoot, realpathSync(child))
  assert.notEqual(childStore.paths.workspaceRoot, parentStore.paths.workspaceRoot)
  assert.equal(existsSync(join(child, '.latch', 'state.json')), true)
})

test('unique prefix 选择 current 后 state 只保存 canonical 完整 ID', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)
  const first = create(store, '第一个任务')
  const second = create(store, '第二个任务')
  const prefix = uniquePrefix(first.id, [first.id, second.id])

  const selected = selectCurrentTaskV2(store, 'codex:session:b', prefix)

  assert.equal(selected, first.id)
  assert.equal(currentTaskIdV2(store, 'codex:session:b'), first.id)
  assert.deepEqual(readStateV2(store), {
    schema_version: 2,
    actors: {
      'codex:session:a': { current_task_id: second.id },
      'codex:session:b': { current_task_id: first.id },
    },
  })
  assert.equal('current_task_id' in readStateV2(store), false)
  assert.equal('active_task_id' in readStateV2(store), false)
})

test('archive 清除所有 actor 的 current 并保留 v2 task 与 events', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)
  const task = create(store, '待归档任务', 'codex:session:a')
  selectCurrentTaskV2(store, 'claude:session:b', task.id)

  const result = archiveTaskV2(store, task.id, {
    expectRevision: 1,
    actor: 'codex:session:a',
    outcome: 'done',
  })
  const archived = result.task

  assert.deepEqual(result.warnings, [])
  assert.equal(archived.outcome, 'done')
  assert.equal(archived.revision, 2)
  assert.equal(currentTaskIdV2(store, 'codex:session:a'), undefined)
  assert.equal(currentTaskIdV2(store, 'claude:session:b'), undefined)
  assert.deepEqual(readStateV2(store), { schema_version: 2, actors: {} })
  assert.equal(existsSync(taskDirectory(store, task.id)), false)

  const monthDirectories = readdirSync(store.paths.archiveDir)
  assert.equal(monthDirectories.length, 1)
  const archivedDirectory = join(store.paths.archiveDir, monthDirectories[0], task.id)
  const archivedJson = JSON.parse(readFileSync(join(archivedDirectory, 'task.json'), 'utf8'))
  assert.equal(archivedJson.schema_version, 3)
  assert.equal(existsSync(join(archivedDirectory, 'notes.md')), false)
  assert.equal(readTaskEventsV3(archivedDirectory).at(-1).type, 'done')
})

test('create 的 current state 写失败时 task 仍创建并返回 warning', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)

  const result = withStateLockV2(store, () =>
    createTaskV2(
      store,
      { title: 'create warning', plan: plan() },
      'codex:session:a',
    ),
  )

  assert.equal(result.task.revision, 1)
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /was not selected as current/)
  assert.equal(readTaskV2(store, result.task.id).id, result.task.id)
  assert.equal(currentTaskIdV2(store, 'codex:session:a'), undefined)
})

test('event 追加失败时 task 更新仍返回成功和 warning', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)
  const task = create(store, 'event warning')
  const directory = taskDirectory(store, task.id)
  const eventsPath = join(directory, 'events.jsonl')
  chmodSync(eventsPath, 0o400)

  const result = updateTaskV2(store, task.id, {
    expectRevision: 1,
    actor: 'codex:session:a',
    events: [{ type: 'plan_updated' }],
    update(next) {
      next.plan.approach = ['task.json 是提交点']
    },
  })

  assert.equal(result.task.revision, 2)
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /event was not recorded/)
  assert.equal(readTaskV2(store, task.id).revision, 2)
  assert.deepEqual(readTaskV2(store, task.id).plan.approach, ['task.json 是提交点'])
  chmodSync(eventsPath, 0o600)
  assert.equal(taskHistoryIncompleteV2(store, task.id), true)
})

test('archive state 清理失败时归档仍成功且 stale current 不生效', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)
  const task = create(store, 'archive warning', 'codex:session:a')

  const result = withStateLockV2(store, () =>
    archiveTaskV2(store, task.id, {
      expectRevision: 1,
      actor: 'codex:session:a',
      outcome: 'done',
    }),
  )

  assert.equal(result.task.outcome, 'done')
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /current task state was not cleaned/)
  assert.equal(existsSync(taskDirectory(store, task.id)), false)
  assert.equal(currentTaskIdV2(store, 'codex:session:a'), undefined)
  assert.equal(readStateV2(store).actors['codex:session:a'].current_task_id, task.id)
  const archivedDirectory = join(
    store.paths.archiveDir,
    result.task.updated_at.slice(0, 7),
    task.id,
  )
  assert.equal(existsSync(join(archivedDirectory, 'task.json')), true)
})

test('过期 revision 拒绝写入，task、events 和 state 保持不变', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)
  const task = create(store, '并发更新', 'codex:session:writer')
  const updateResult = updateTaskV2(store, task.id, {
    expectRevision: 1,
    actor: 'codex:session:writer',
    events: [{ type: 'plan_updated' }],
    update(next) {
      next.plan.approach = ['先写 store，再接 CLI']
    },
  })
  assert.deepEqual(updateResult.warnings, [])
  assert.equal(updateResult.task.revision, 2)
  selectCurrentTaskV2(store, 'codex:session:reader', task.id)

  const taskPath = join(taskDirectory(store, task.id), 'task.json')
  const eventsPath = join(taskDirectory(store, task.id), 'events.jsonl')
  const before = {
    task: readFileSync(taskPath, 'utf8'),
    events: readFileSync(eventsPath, 'utf8'),
    state: readFileSync(store.paths.statePath, 'utf8'),
  }

  assert.throws(
    () =>
      updateTaskV2(store, task.id, {
        expectRevision: 1,
        actor: 'codex:session:stale',
        events: [{ type: 'plan_updated' }],
        update(next) {
          next.title = '不应写入'
        },
      }),
    /expected revision 1, current revision 2[\s\S]*Changed by: codex:session:writer/,
  )
  assert.deepEqual(
    {
      task: readFileSync(taskPath, 'utf8'),
      events: readFileSync(eventsPath, 'utf8'),
      state: readFileSync(store.paths.statePath, 'utf8'),
    },
    before,
  )
})

test('无效 schema 或结构化 event 在持久化前失败', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)
  const task = create(store, '写入前校验')
  const taskPath = join(taskDirectory(store, task.id), 'task.json')
  const eventsPath = join(taskDirectory(store, task.id), 'events.jsonl')

  const beforeInvalidEvent = {
    task: readFileSync(taskPath, 'utf8'),
    events: readFileSync(eventsPath, 'utf8'),
  }
  assert.throws(
    () =>
      updateTaskV2(store, task.id, {
        expectRevision: 1,
        actor: 'codex:session:a',
        events: [{ type: 'decision_recorded' }],
        update(next) {
          next.title = '不应持久化'
        },
      }),
    /Invalid decision plan_revision/,
  )
  assert.deepEqual(
    {
      task: readFileSync(taskPath, 'utf8'),
      events: readFileSync(eventsPath, 'utf8'),
    },
    beforeInvalidEvent,
  )

  assert.throws(
    () =>
      updateTaskV2(store, task.id, {
        expectRevision: 1,
        actor: 'codex:session:a',
        events: [{ type: 'plan_updated' }],
        update(next) {
          next.blocked = { reason: '', waiting_for: '', blocked_at: '' }
        },
      }),
    /Invalid blocked.reason/,
  )
  assert.equal(readFileSync(taskPath, 'utf8'), beforeInvalidEvent.task)

  assert.throws(
    () =>
      updateTaskV3(store, task.id, {
        expectRevision: 1,
        actor: 'codex:session:a',
        events: [{
          type: 'decision_recorded',
          fields: { plan_revision: 1, conclusion: 'invalid provenance' },
        }],
        update(next) {
          next.provenance = 'dirty'
        },
      }),
    /Invalid provenance/,
  )
  assert.equal(readFileSync(taskPath, 'utf8'), beforeInvalidEvent.task)
})

test('plan 拒绝空 argv 和重复 verification name', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)

  assert.throws(
    () =>
      createTaskV2(
        store,
        {
          title: '空 argv',
          plan: plan({
            verification_plan: [{ name: 'tests', command: [], kind: 'gate' }],
          }),
        },
        'codex:session:a',
      ),
    /empty verification_plan.command/,
  )

  assert.throws(
    () =>
      createTaskV2(
        store,
        {
          title: '重复名称',
          plan: plan({
            verification_plan: [
              { name: 'tests', command: ['pnpm', 'test'], kind: 'gate' },
              { name: 'tests', command: ['pnpm', 'typecheck'], kind: 'diagnostic' },
            ],
          }),
        },
        'codex:session:a',
      ),
    /Duplicate verification_plan.name/,
  )
})

test('不同 task 锁互不阻塞，state 锁不阻塞 task 文件更新', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)
  const first = create(store, '锁任务一')
  const second = create(store, '锁任务二')
  const firstLockPath = join(store.paths.taskLocksDir, `${first.id}.lock`)
  const firstTaskBefore = readFileSync(
    join(taskDirectory(store, first.id), 'task.json'),
    'utf8',
  )

  const nestedResult = withTaskLockV2(store, first.id, () => {
    assert.equal(existsSync(firstLockPath), true)
    assert.throws(
      () => withTaskLockV2(store, first.id, () => '不应执行'),
      /Latch lock is busy/,
    )
    assert.equal(existsSync(firstLockPath), true)
    return withTaskLockV2(store, second.id, () => 'ok')
  })
  assert.equal(nestedResult, 'ok')
  assert.equal(existsSync(firstLockPath), false)
  assert.equal(
    readFileSync(join(taskDirectory(store, first.id), 'task.json'), 'utf8'),
    firstTaskBefore,
  )

  const updateResult = withStateLockV2(store, () =>
    updateTaskV2(store, first.id, {
      expectRevision: 1,
      actor: 'codex:session:a',
      events: [{ type: 'plan_updated' }],
      update(next) {
        next.plan.scope.push('tests/v2-store.test.mjs')
      },
    }),
  )
  assert.equal(updateResult.task.revision, 2)
  assert.deepEqual(updateResult.warnings, [])
  assert.deepEqual(readTaskV2(store, first.id).plan.scope, [
    'src/core',
    'tests/v2-store.test.mjs',
  ])
})

test('已死亡进程留下的过期锁可清理', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)
  const task = create(store, '过期锁')
  const lockPath = join(store.paths.taskLocksDir, `${task.id}.lock`)
  writeFileSync(
    lockPath,
    `${JSON.stringify({ pid: 2_147_483_647, created_at: '2000-01-01T00:00:00.000Z' })}\n`,
  )

  assert.equal(withTaskLockV2(store, task.id, () => 'acquired'), 'acquired')
  assert.equal(existsSync(lockPath), false)
})

test('损坏 JSON 的错误包含具体路径', () => {
  const root = temporaryDirectory()
  const store = initTaskStoreV2(root)
  const task = create(store, '损坏 JSON')
  const path = join(taskDirectory(store, task.id), 'task.json')
  writeFileSync(path, '{invalid json\n')

  assert.throws(() => readTaskV2(store, task.id), (error) => {
    assert.match(error.message, /Cannot read JSON/)
    assert.ok(error.message.includes(path))
    return true
  })
})

test('未初始化目录的只读 open 不创建 .latch', () => {
  const root = temporaryDirectory()

  assert.throws(() => openTaskStoreV2(root), /Latch is not initialized/)
  assert.equal(existsSync(join(root, '.latch')), false)
})

test('发现 v1 state 时 init 明确拒绝且不覆盖', () => {
  const root = temporaryDirectory()
  const latchDirectory = join(root, '.latch')
  const statePath = join(latchDirectory, 'state.json')
  mkdirSync(latchDirectory)
  writeFileSync(statePath, '{"actors":{}}\n')

  assert.throws(() => initTaskStoreV2(root), /Unsupported or invalid Latch schema/)
  assert.equal(readFileSync(statePath, 'utf8'), '{"actors":{}}\n')
  assert.deepEqual(readdirSync(latchDirectory), ['state.json'])
})
