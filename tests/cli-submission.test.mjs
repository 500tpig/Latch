import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  archiveTaskV2,
  openTaskStoreV2,
} from '../dist/core/task-store.js'
import {
  checkpoint,
  cleanupTemporaryDirectories,
  init,
  readTask,
  run,
  temporaryDirectory,
} from './cli-test-support.mjs'

test.afterEach(cleanupTemporaryDirectories)

test('current submit flag writes structured schema 5 unverified items', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, 'structured submit input', {
    verification_plan: [],
  })
  const approved = run(cwd, [
    'approve', created.task_id, '--expect-revision', '1',
    '--reason', 'approved', '--json',
  ])
  assert.equal(approved.status, 0, approved.stderr)
  const submitted = run(cwd, [
    'submit', created.task_id, '--expect-revision', '2',
    '--changes', 'current flag',
    '--unverified-item', '浏览器验收待完成',
    '--knowledge-impact-none', 'fixture does not change module knowledge',
    '--no-verify', '--reason', 'fixture has no gates', '--json',
  ])
  assert.equal(submitted.status, 0, submitted.stderr)
  assert.deepEqual(readTask(cwd, created.task_id).submission.unverified_items, [
    { item_id: 'U1', summary: '浏览器验收待完成' },
  ])
})

test('archiveTaskV2 atomically rejects schema 5 done without structured closeout', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = checkpoint(cwd, 'schema 5 done invariant')
  const store = openTaskStoreV2(cwd)
  const openDirectory = join(cwd, '.latch', 'tasks', created.task_id)
  const taskJsonPath = join(openDirectory, 'task.json')
  const eventsPath = join(openDirectory, 'events.jsonl')
  const taskBefore = readFileSync(taskJsonPath, 'utf8')
  const eventsBefore = readFileSync(eventsPath, 'utf8')

  assert.throws(
    () => archiveTaskV2(store, created.task_id, {
      expectRevision: 1,
      actor: 'codex:session:test-session',
      outcome: 'done',
      eventFields: {
        resolved_count: 0,
        accepted_risk_count: 0,
        followup_count: 0,
      },
    }),
    /schema 5 done task.*submission is required/,
  )
  assert.equal(readFileSync(taskJsonPath, 'utf8'), taskBefore)
  assert.equal(readFileSync(eventsPath, 'utf8'), eventsBefore)
  assert.equal(existsSync(openDirectory), true)
  for (const month of readdirSync(join(cwd, '.latch', 'archive')))
    assert.equal(
      existsSync(join(cwd, '.latch', 'archive', month, created.task_id)),
      false,
    )
})
