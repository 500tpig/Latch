import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import {
  createTaskV3,
  initTaskStoreV2,
  listTasksV2,
  readTaskV2,
  updateTaskV3,
} from '../dist/core/task-store.js'
import { downgradeTaskValue } from '../dist/core/migration.js'

const cli = join(process.cwd(), 'dist/cli.js')
const actor = 'codex:session:record-tests'
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-record-'))
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

function runAsync(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env: { ...process.env, LATCH_ACTOR: actor },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr })
    })
  })
}

function json(result) {
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function plan() {
  return {
    goal: '验证 Record 来源 task',
    scope: ['src/core/record-store.ts'],
    acceptance: ['record tests pass'],
    approach: ['使用 project-local Record'],
    api_assumptions: [],
    permission_assumptions: [],
    data_assumptions: [],
    user_flow: [],
    out_of_scope: [],
    verification_plan: [],
    open_questions: [],
  }
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function createRecord(cwd, overrides = {}) {
  return json(run(cwd, [
    'record',
    'create',
    '--title',
    overrides.title ?? 'Record title',
    '--body',
    overrides.body ?? 'private Record body',
    ...((overrides.tags ?? []).flatMap((tag) => ['--tag', tag])),
    ...((overrides.tasks ?? []).flatMap((task) => ['--task', task])),
    ...((overrides.groups ?? []).flatMap((group) => ['--group', group])),
    '--json',
  ]))
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('Record reads require initialized Latch and do not initialize the store', () => {
  const cwd = temporaryDirectory()
  const uninitialized = run(cwd, ['record', 'list', '--json'])
  assert.notEqual(uninitialized.status, 0)
  assert.equal(JSON.parse(uninitialized.stderr).record_store_schema_version, 1)
  assert.equal(existsSync(join(cwd, '.latch')), false)

  json(run(cwd, ['init', '--json']))
  assert.equal(existsSync(join(cwd, '.latch/records')), false)
  const listed = json(run(cwd, ['record', 'list', '--json']))
  assert.deepEqual(listed.records, [])
  assert.equal(existsSync(join(cwd, '.latch/records')), false)
})

test('unlinked Record creation does not read unrelated task data', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createTaskV3(
    store,
    { title: 'unrelated task', plan: plan(), profile: 'standard' },
    actor,
  ).task
  writeFileSync(join(store.paths.tasksDir, task.id, 'task.json'), '{broken')

  const created = createRecord(cwd, { title: 'independent Record' })
  assert.equal(created.record.title, 'independent Record')
})

test('Record index and list never expose body content', () => {
  const cwd = temporaryDirectory()
  json(run(cwd, ['init', '--json']))
  const secret = 'secret-body-that-must-not-enter-index'
  const created = createRecord(cwd, {
    title: '索引隔离',
    body: secret,
    tags: ['decision'],
  })
  assert.match(created.record.id, /^rec_[0-9a-f-]{36}$/)
  assert.equal(created.record.revision, 1)
  assert.equal(created.body_preview, secret)
  assert.equal('body' in created, false)

  const indexText = readFileSync(join(cwd, '.latch/records/index.json'), 'utf8')
  assert.equal(indexText.includes(secret), false)
  const listed = json(run(cwd, ['record', 'list', '--json']))
  assert.equal(listed.records.length, 1)
  assert.deepEqual(Object.keys(listed.records[0]).sort(), [
    'id',
    'revision',
    'status',
    'tags',
    'title',
    'updated_at',
  ])
  assert.equal(JSON.stringify(listed).includes(secret), false)
  assert.equal(JSON.stringify(json(run(cwd, ['list', '--json']))).includes(secret), false)

  const shown = json(run(cwd, ['record', 'show', created.record.id, '--json']))
  assert.equal(shown.body, secret)
  assert.equal(shown.record.body_sha256.length, 64)

  const prefix = run(cwd, ['record', 'show', created.record.id.slice(0, 12), '--json'])
  assert.notEqual(prefix.status, 0)
  assert.match(prefix.stderr, /Invalid Record ID/)
})

test('Record list filters locally and enforces a hard five-item limit', () => {
  const cwd = temporaryDirectory()
  json(run(cwd, ['init', '--json']))
  for (let index = 0; index < 6; index += 1)
    createRecord(cwd, {
      title: `Record ${index}`,
      body: `body ${index}`,
      tags: index % 2 === 0 ? ['even', 'shared'] : ['odd', 'shared'],
    })

  assert.equal(json(run(cwd, ['record', 'list', '--json'])).records.length, 5)
  const even = json(run(cwd, [
    'record',
    'list',
    '--tag',
    'even',
    '--tag',
    'shared',
    '--json',
  ]))
  assert.equal(even.records.length, 3)
  assert.ok(even.records.every((record) => record.tags.includes('even')))
  const query = json(run(cwd, ['record', 'list', '--query', 'Record 1', '--json']))
  assert.equal(query.records.length, 1)
  const tooMany = run(cwd, ['record', 'list', '--limit', '6', '--json'])
  assert.notEqual(tooMany.status, 0)
  assert.match(tooMany.stderr, /between 1 and 5/)
})

test('Record edit, archive, restore, revision and body limits are enforced', () => {
  const cwd = temporaryDirectory()
  json(run(cwd, ['init', '--json']))
  const created = createRecord(cwd, { body: 'revision one', tags: ['old'] })
  const id = created.record.id

  const conflict = run(cwd, [
    'record',
    'edit',
    id,
    '--expect-revision',
    '2',
    '--title',
    'conflict',
    '--json',
  ])
  assert.notEqual(conflict.status, 0)
  assert.match(conflict.stderr, /revision conflict/)

  const edited = json(run(cwd, [
    'record',
    'edit',
    id,
    '--expect-revision',
    '1',
    '--title',
    'Edited title',
    '--body',
    'revision two',
    '--clear-tags',
    '--json',
  ]))
  assert.equal(edited.record.revision, 2)
  assert.deepEqual(edited.record.tags, [])
  assert.equal(edited.body_preview, 'revision two')
  assert.equal(existsSync(join(cwd, `.latch/records/bodies/${id}/1.md`)), false)
  assert.equal(existsSync(join(cwd, `.latch/records/bodies/${id}/2.md`)), true)

  const archived = json(run(cwd, [
    'record',
    'archive',
    id,
    '--expect-revision',
    '2',
    '--json',
  ]))
  assert.equal(archived.record.status, 'archived')
  assert.equal(archived.record.revision, 3)
  assert.equal(json(run(cwd, ['record', 'list', '--json'])).records.length, 0)
  assert.equal(
    json(run(cwd, ['record', 'list', '--status', 'archived', '--json'])).records.length,
    1,
  )
  assert.notEqual(
    run(cwd, [
      'record',
      'edit',
      id,
      '--expect-revision',
      '3',
      '--title',
      'forbidden',
      '--json',
    ]).status,
    0,
  )
  const restored = json(run(cwd, [
    'record',
    'restore',
    id,
    '--expect-revision',
    '3',
    '--json',
  ]))
  assert.equal(restored.record.status, 'active')
  assert.equal(restored.record.revision, 4)

  const oversized = run(cwd, [
    'record',
    'create',
    '--title',
    'too large',
    '--body',
    'x'.repeat(16 * 1024 + 1),
    '--json',
  ])
  assert.notEqual(oversized.status, 0)
  assert.match(oversized.stderr, /exceeds 16384/)
})

test('concurrent Record edits commit at most one matching revision', async () => {
  const cwd = temporaryDirectory()
  json(run(cwd, ['init', '--json']))
  const created = createRecord(cwd)
  const base = [
    'record',
    'edit',
    created.record.id,
    '--expect-revision',
    '1',
    '--title',
  ]
  const results = await Promise.all([
    runAsync(cwd, [...base, 'concurrent A', '--json']),
    runAsync(cwd, [...base, 'concurrent B', '--json']),
  ])
  const succeeded = results.filter((result) => result.status === 0)
  const rejected = results.filter((result) => result.status !== 0)
  assert.equal(succeeded.length, 1, JSON.stringify(results))
  assert.equal(rejected.length, 1, JSON.stringify(results))
  assert.match(rejected[0].stderr, /revision conflict|lock is busy/)

  const shown = json(run(cwd, ['record', 'show', created.record.id, '--json']))
  assert.equal(shown.record.revision, 2)
  assert.ok(['concurrent A', 'concurrent B'].includes(shown.record.title))
})

test('Record delete requires exact confirmation and linked confirmation', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const task = createTaskV3(
    store,
    { title: 'related task', plan: plan(), profile: 'standard' },
    actor,
  ).task
  const created = createRecord(cwd, {
    body: 'linked record',
    tasks: [task.id],
  })
  const id = created.record.id

  const missingConfirmation = run(cwd, [
    'record',
    'delete',
    id,
    '--expect-revision',
    '1',
    '--json',
  ])
  assert.notEqual(missingConfirmation.status, 0)
  assert.match(missingConfirmation.stderr, /--confirm-delete/)

  const missingLinked = run(cwd, [
    'record',
    'delete',
    id,
    '--expect-revision',
    '1',
    '--confirm-delete',
    '--json',
  ])
  assert.notEqual(missingLinked.status, 0)
  assert.match(missingLinked.stderr, /--confirm-linked/)

  const deleted = json(run(cwd, [
    'record',
    'delete',
    id,
    '--expect-revision',
    '1',
    '--confirm-delete',
    '--confirm-linked',
    '--json',
  ]))
  assert.equal(deleted.deleted, true)
  assert.equal(existsSync(join(cwd, `.latch/records/bodies/${id}`)), false)
  assert.notEqual(run(cwd, ['record', 'show', id, '--json']).status, 0)
})

test('Record store fails closed on unknown schema and corrupted body', () => {
  const cwd = temporaryDirectory()
  json(run(cwd, ['init', '--json']))
  const created = createRecord(cwd)
  const indexPath = join(cwd, '.latch/records/index.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const bodyPath = join(cwd, '.latch/records', index.records[0].body_ref)
  writeFileSync(bodyPath, 'tampered')
  const corrupted = run(cwd, ['record', 'show', created.record.id, '--json'])
  assert.notEqual(corrupted.status, 0)
  assert.match(corrupted.stderr, /hash mismatch/)

  writeJson(indexPath, { ...index, schema_version: 99 })
  const unknown = run(cwd, ['record', 'list', '--json'])
  assert.notEqual(unknown.status, 0)
  assert.match(unknown.stderr, /Unsupported or invalid Record store schema/)
})

test('Record store fails closed on escaped, symlinked and incomplete paths', () => {
  {
    const cwd = temporaryDirectory()
    json(run(cwd, ['init', '--json']))
    createRecord(cwd)
    const indexPath = join(cwd, '.latch/records/index.json')
    const index = JSON.parse(readFileSync(indexPath, 'utf8'))
    index.records[0].body_ref = '../outside.md'
    writeJson(indexPath, index)
    const escaped = run(cwd, ['record', 'list', '--json'])
    assert.notEqual(escaped.status, 0)
    assert.match(escaped.stderr, /Invalid record\.body_ref/)
  }

  {
    const cwd = temporaryDirectory()
    const outside = temporaryDirectory()
    json(run(cwd, ['init', '--json']))
    createRecord(cwd)
    const indexPath = join(cwd, '.latch/records/index.json')
    const outsideIndex = join(outside, 'index.json')
    writeFileSync(outsideIndex, readFileSync(indexPath))
    rmSync(indexPath)
    symlinkSync(outsideIndex, indexPath)
    const linkedIndex = run(cwd, ['record', 'list', '--json'])
    assert.notEqual(linkedIndex.status, 0)
    assert.match(linkedIndex.stderr, /Record index must not be a symbolic link/)
  }

  {
    const cwd = temporaryDirectory()
    const outside = temporaryDirectory()
    json(run(cwd, ['init', '--json']))
    const created = createRecord(cwd)
    const bodyDirectory = join(cwd, `.latch/records/bodies/${created.record.id}`)
    const outsideBodyDirectory = join(outside, created.record.id)
    mkdirSync(outsideBodyDirectory)
    writeFileSync(join(outsideBodyDirectory, '1.md'), 'private Record body')
    rmSync(bodyDirectory, { recursive: true })
    symlinkSync(outsideBodyDirectory, bodyDirectory, 'dir')
    const linkedBody = run(cwd, [
      'record',
      'show',
      created.record.id,
      '--json',
    ])
    assert.notEqual(linkedBody.status, 0)
    assert.match(linkedBody.stderr, /resolves outside the current project/)
  }

  {
    const cwd = temporaryDirectory()
    json(run(cwd, ['init', '--json']))
    createRecord(cwd)
    const indexPath = join(cwd, '.latch/records/index.json')
    const index = JSON.parse(readFileSync(indexPath, 'utf8'))
    delete index.records[0].relations
    writeJson(indexPath, index)
    const incomplete = run(cwd, ['record', 'list', '--json'])
    assert.notEqual(incomplete.status, 0)
    assert.match(incomplete.stderr, /Invalid record\.relations/)
  }
})

test('body-file must stay inside the current project', () => {
  const cwd = temporaryDirectory()
  const outside = temporaryDirectory()
  json(run(cwd, ['init', '--json']))
  writeFileSync(join(outside, 'body.md'), 'outside')
  const escaped = run(cwd, [
    'record',
    'create',
    '--title',
    'outside',
    '--body-file',
    join(outside, 'body.md'),
    '--json',
  ])
  assert.notEqual(escaped.status, 0)
  assert.match(escaped.stderr, /inside the current project/)

  writeFileSync(join(cwd, 'body.md'), 'inside')
  const created = json(run(cwd, [
    'record',
    'create',
    '--title',
    'inside',
    '--body-file',
    'body.md',
    '--json',
  ]))
  assert.equal(created.body_preview, 'inside')
})

test('checkpoint preserves exact Record provenance without inheriting authorization', () => {
  const cwd = temporaryDirectory()
  json(run(cwd, ['init', '--json']))
  const created = createRecord(cwd, { body: 'source body' })
  writeJson(join(cwd, 'plan.json'), plan())
  const checkpoint = json(run(cwd, [
    'checkpoint',
    'Task from Record',
    '--plan-file',
    'plan.json',
    '--source-record',
    created.record.id,
    '--source-record-revision',
    '1',
    '--json',
  ]))
  const store = initTaskStoreV2(cwd)
  const task = readTaskV2(store, checkpoint.task_id)
  assert.deepEqual(task.source_record, {
    record_id: created.record.id,
    revision: 1,
    body_sha256: JSON.parse(
      readFileSync(join(cwd, '.latch/records/index.json'), 'utf8'),
    ).records[0].body_sha256,
  })
  assert.equal(task.phase, 'plan')
  assert.equal(task.work_basis, undefined)
  assert.equal(task.implementation_approval, undefined)
  assert.equal(downgradeTaskValue(task).source_record, undefined)
  assert.deepEqual(
    json(run(cwd, ['context', task.id, '--json', '--brief'])).task.source_record,
    {
      record_id: task.source_record.record_id,
      revision: task.source_record.revision,
    },
  )

  const sourceAfter = json(run(cwd, [
    'record',
    'show',
    created.record.id,
    '--json',
  ]))
  assert.equal(sourceAfter.record.revision, 2)
  assert.deepEqual(sourceAfter.record.relations.task_ids, [task.id])

  const before = listTasksV2(store).length
  const stale = run(cwd, [
    'checkpoint',
    'Stale source',
    '--plan-file',
    'plan.json',
    '--source-record',
    created.record.id,
    '--source-record-revision',
    '1',
    '--json',
  ])
  assert.notEqual(stale.status, 0)
  assert.match(stale.stderr, /revision conflict/)
  assert.equal(listTasksV2(store).length, before)
})

test('task updates cannot rewrite or remove Record provenance', () => {
  const cwd = temporaryDirectory()
  const store = initTaskStoreV2(cwd)
  const sourceRecord = {
    record_id: 'rec_123e4567-e89b-42d3-a456-426614174000',
    revision: 1,
    body_sha256: 'a'.repeat(64),
  }
  const task = createTaskV3(
    store,
    {
      title: 'immutable Record provenance',
      plan: plan(),
      profile: 'standard',
      sourceRecord,
    },
    actor,
  ).task
  const update = (change) => updateTaskV3(store, task.id, {
    expectRevision: 1,
    actor,
    events: [{
      type: 'decision_recorded',
      fields: { plan_revision: 1, conclusion: 'attempt provenance rewrite' },
    }],
    update: change,
  })

  assert.throws(
    () => update((value) => { value.source_record.body_sha256 = 'b'.repeat(64) }),
    /immutable fields: source_record/,
  )
  assert.throws(
    () => update((value) => { delete value.source_record }),
    /immutable fields: source_record/,
  )
  assert.deepEqual(readTaskV2(store, task.id).source_record, sourceRecord)
})

test('Board fixtures match the actual Record list and show projections', () => {
  const cwd = temporaryDirectory()
  json(run(cwd, ['init', '--json']))
  const body = 'Record 正文只在明确读取一条记录时返回。\n'
  const created = createRecord(cwd, {
    title: 'Record 权限分层',
    body,
    tags: ['record', 'permissions'],
  })
  json(run(cwd, [
    'record',
    'edit',
    created.record.id,
    '--expect-revision',
    '1',
    '--body',
    body,
    '--json',
  ]))

  const listFixture = JSON.parse(
    readFileSync('tests/fixtures/record-list-v1.json', 'utf8'),
  )
  const showFixture = JSON.parse(
    readFileSync('tests/fixtures/record-show-v1.json', 'utf8'),
  )
  const listed = json(run(cwd, ['record', 'list', '--json']))
  const shown = json(run(cwd, ['record', 'show', created.record.id, '--json']))
  const actualId = shown.record.id

  listed.generated_at = listFixture.generated_at
  listed.records[0].id = listFixture.records[0].id
  listed.records[0].updated_at = listFixture.records[0].updated_at
  assert.deepEqual(listed, listFixture)

  shown.generated_at = showFixture.generated_at
  shown.record.id = showFixture.record.id
  shown.record.body_ref = shown.record.body_ref.replace(
    actualId,
    showFixture.record.id,
  )
  shown.record.created_at = showFixture.record.created_at
  shown.record.updated_at = showFixture.record.updated_at
  assert.deepEqual(shown, showFixture)
})
