import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  checkpoint,
  cleanupTemporaryDirectories,
  init,
  readTask,
  run,
  taskPath,
  temporaryDirectory,
} from './cli-test-support.mjs'

const owner = 'codex:session:test-session'
const otherWriter = 'codex:session:resolve-open-questions-other'

test.afterEach(cleanupTemporaryDirectories)

function taskDirectory(cwd, id) {
  return join(cwd, '.latch', 'tasks', id)
}

function writeTask(cwd, id, task) {
  writeFileSync(taskPath(cwd, id), `${JSON.stringify(task, null, 2)}\n`)
}

function writeJson(cwd, name, value) {
  writeFileSync(join(cwd, name), `${JSON.stringify(value, null, 2)}\n`)
  return name
}

function revision(cwd, id) {
  return String(readTask(cwd, id).revision)
}

function events(cwd, id) {
  return readFileSync(join(taskDirectory(cwd, id), 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function storedState(cwd, id) {
  const directory = taskDirectory(cwd, id)
  const evidenceDirectory = join(directory, 'evidence')
  return {
    task: readFileSync(taskPath(cwd, id), 'utf8'),
    events: readFileSync(join(directory, 'events.jsonl'), 'utf8'),
    state: readFileSync(join(cwd, '.latch', 'state.json'), 'utf8'),
    evidence: existsSync(evidenceDirectory)
      ? readdirSync(evidenceDirectory)
          .sort()
          .map((name) => [
            name,
            readFileSync(join(evidenceDirectory, name), 'utf8'),
          ])
      : [],
  }
}

function questionTask(cwd, title, questions = ['是否保留旧格式？']) {
  return checkpoint(cwd, title, {
    open_questions: questions,
  })
}

function authorization(source, overrides = {}) {
  return {
    kind: 'implementation_authorization',
    source,
    reason: `${source} open question authorization`,
    scope: { summary: '实施解决问题后的当前 plan' },
    ...overrides,
  }
}

function resolveOpenQuestions(cwd, id, payload, options = {}) {
  const answersFile = options.answersFile ?? writeJson(cwd, 'answers.json', payload)
  const args = [
    'resolve-open-questions',
    id,
    '--expect-revision',
    options.expectRevision ?? revision(cwd, id),
    '--answers-file',
    answersFile,
  ]
  if (options.authorizationFile)
    args.push('--authorization-file', options.authorizationFile)
  if (options.json !== false) args.push('--json')
  return run(cwd, args, {
    actor: options.actor ?? owner,
    input: options.input,
  })
}

function seedPlanLifecycle(cwd, id) {
  const task = readTask(cwd, id)
  const evidenceDirectory = join(taskDirectory(cwd, id), 'evidence')
  mkdirSync(evidenceDirectory, { recursive: true })
  writeFileSync(join(evidenceDirectory, 'baseline.json'), '{}\n')
  task.verification.gate.tests = {
    name: 'tests',
    kind: 'gate',
    command: ['pnpm', 'test'],
    status: 'pass',
    exit_code: 0,
    work_revision: task.work_revision,
    created_at: task.updated_at,
  }
  task.submission = {
    plan_revision: task.plan_revision,
    work_revision: task.work_revision,
    changes: 'fixture submission',
    verified: 'tests: pass',
    unverified_items: [],
    knowledge_impact: { kind: 'none', reason: 'fixture' },
    submitted_at: task.updated_at,
  }
  task.workspace_proof = {
    generation: 1,
    baseline_ref: {
      path: 'evidence/baseline.json',
      sha256: '0'.repeat(64),
      entry_count: 0,
    },
    baseline_counts: {
      tracked_dirty: 0,
      untracked: 0,
      explicit_ignored: 0,
      in_scope: 0,
      out_of_scope: 0,
    },
    unresolved_violations: [],
  }
  writeTask(cwd, id, task)
  return task
}

test('resolve-open-questions resolves one question atomically and preserves raw text', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = questionTask(cwd, 'resolve one question')
  const before = readTask(cwd, created.task_id)
  const payload = {
    answers: [
      {
        question: '是否保留旧格式？',
        answer: ' 保留旧格式。 ',
        decision: '只提供 current schema 5 格式。',
      },
    ],
  }

  const result = resolveOpenQuestions(cwd, created.task_id, payload)

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.schema_version, 3)
  assert.equal(output.previous_revision, 1)
  assert.equal(output.revision, 2)
  assert.equal(output.phase, 'plan')
  assert.equal(output.plan_revision, 2)
  assert.equal(output.work_revision, 0)
  assert.equal(output.authorization_applied, false)
  assert.deepEqual(output.next_action, {
    kind: 'await_user',
    boundary: 'approval',
    reason: 'implementation_plan',
  })
  assert.deepEqual(output.resolved_questions, payload.answers)

  const after = readTask(cwd, created.task_id)
  assert.deepEqual(after.plan, { ...before.plan, open_questions: [] })
  assert.equal(after.plan_revision, 2)
  assert.equal(after.work_revision, 0)
  assert.deepEqual(after.verification, { gate: {}, diagnostic: {} })
  assert.equal('submission' in after, false)
  assert.deepEqual(
    events(cwd, created.task_id).slice(-2).map((event) => event.type),
    ['plan_updated', 'decision_recorded'],
  )
  const [planEvent, decisionEvent] = events(cwd, created.task_id).slice(-2)
  assert.deepEqual(
    {
      plan_revision: planEvent.plan_revision,
      change: planEvent.change,
      resolved_count: planEvent.resolved_count,
    },
    {
      plan_revision: 2,
      change: 'open_questions_resolved',
      resolved_count: 1,
    },
  )
  assert.deepEqual(
    {
      plan_revision: decisionEvent.plan_revision,
      question: decisionEvent.question,
      answer: decisionEvent.answer,
      conclusion: decisionEvent.conclusion,
    },
    {
      plan_revision: 2,
      question: '是否保留旧格式？',
      answer: ' 保留旧格式。 ',
      conclusion: '只提供 current schema 5 格式。',
    },
  )
})

test('resolve-open-questions preserves multi-question order and human output omits answers', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const questions = ['是否保留旧格式？', '是否输出 JSON？']
  const created = questionTask(cwd, 'resolve multiple questions', questions)
  const payload = {
    answers: [
      {
        question: questions[0],
        answer: '保留。',
        decision: '保留兼容读取。',
      },
      {
        question: questions[1],
        answer: '输出。',
        decision: '成功结果统一使用 JSON。',
      },
    ],
  }

  const result = resolveOpenQuestions(cwd, created.task_id, payload, {
    json: false,
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(
    result.stdout,
    `Resolved 2 open question(s) for ${created.task_id}.\n` +
      'Lifecycle: plan revision 1 -> 2; task revision 1 -> 2; phase plan; authorization not-applied.\n',
  )
  assert.doesNotMatch(result.stdout, /保留兼容读取|成功结果统一/)
  assert.deepEqual(
    events(cwd, created.task_id)
      .slice(-2)
      .map((event) => [event.question, event.conclusion]),
    [
      [questions[0], '保留兼容读取。'],
      [questions[1], '成功结果统一使用 JSON。'],
    ],
  )
})

test('resolve-open-questions rejects empty, incomplete, extra, duplicate, reordered, stale, and malformed answers without mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const questions = ['问题一？', '问题二？']
  const created = questionTask(cwd, 'resolve coverage refusals', questions)
  const valid = (question, answer = '回答', decision = '决定') => ({
    question,
    answer,
    decision,
  })
  const cases = [
    { payload: { answers: [] }, pattern: /exactly 2 item/ },
    { payload: { answers: [valid(questions[0])] }, pattern: /exactly 2 item/ },
    {
      payload: { answers: [valid(questions[0]), valid(questions[1]), valid('额外？')] },
      pattern: /exactly 2 item/,
    },
    {
      payload: { answers: [valid(questions[1]), valid(questions[0])] },
      pattern: /does not exactly match/,
    },
    {
      payload: { answers: [valid(questions[0]), valid(questions[0])] },
      pattern: /does not exactly match/,
    },
    {
      payload: { answers: [valid('过期问题？'), valid(questions[1])] },
      pattern: /does not exactly match/,
    },
    {
      payload: { answers: [valid(questions[0], '  '), valid(questions[1])] },
      pattern: /answer at index 0 must be non-empty/,
    },
    {
      payload: { answers: [valid(questions[0], '回答', '\t'), valid(questions[1])] },
      pattern: /decision at index 0 must be non-empty/,
    },
    {
      payload: {
        answers: [
          { ...valid(questions[0]), extra: '不允许' },
          valid(questions[1]),
        ],
      },
      pattern: /contain only question, answer, and decision/,
    },
    {
      payload: {
        answers: [valid(questions[0]), valid(questions[1])],
        extra: true,
      },
      pattern: /contain only the answers property/,
    },
  ]

  for (const fixture of cases) {
    const before = storedState(cwd, created.task_id)
    const result = resolveOpenQuestions(cwd, created.task_id, fixture.payload)
    assert.notEqual(result.status, 0)
    const error = JSON.parse(result.stderr).error
    assert.equal(error.code, 'invalid_arguments')
    assert.match(error.message, fixture.pattern)
    assert.deepEqual(storedState(cwd, created.task_id), before)
  }

  const emptyFile = 'empty-answers.json'
  writeFileSync(join(cwd, emptyFile), '')
  const emptyBefore = storedState(cwd, created.task_id)
  const emptyResult = resolveOpenQuestions(cwd, created.task_id, {}, {
    answersFile: emptyFile,
  })
  assert.notEqual(emptyResult.status, 0)
  assert.equal(JSON.parse(emptyResult.stderr).error.code, 'invalid_arguments')
  assert.deepEqual(storedState(cwd, created.task_id), emptyBefore)

  const malformedFile = 'malformed-answers.json'
  writeFileSync(join(cwd, malformedFile), '{')
  const malformedResult = resolveOpenQuestions(cwd, created.task_id, {}, {
    answersFile: malformedFile,
  })
  assert.notEqual(malformedResult.status, 0)
  assert.equal(JSON.parse(malformedResult.stderr).error.code, 'invalid_arguments')

  const emptyTask = questionTask(cwd, 'resolve empty current questions', [])
  const emptyTaskBefore = storedState(cwd, emptyTask.task_id)
  const emptyCurrent = resolveOpenQuestions(cwd, emptyTask.task_id, {
    answers: [],
  })
  assert.notEqual(emptyCurrent.status, 0)
  assert.equal(JSON.parse(emptyCurrent.stderr).error.code, 'invalid_arguments')
  assert.deepEqual(storedState(cwd, emptyTask.task_id), emptyTaskBefore)

  const duplicateTask = questionTask(
    cwd,
    'resolve duplicate current questions',
    ['重复问题？', '重复问题？'],
  )
  const duplicateBefore = storedState(cwd, duplicateTask.task_id)
  const duplicateCurrent = resolveOpenQuestions(cwd, duplicateTask.task_id, {
    answers: [
      valid('重复问题？', '回答一', '决定一'),
      valid('重复问题？', '回答二', '决定二'),
    ],
  })
  assert.notEqual(duplicateCurrent.status, 0)
  assert.equal(JSON.parse(duplicateCurrent.stderr).error.code, 'invalid_arguments')
  assert.match(JSON.parse(duplicateCurrent.stderr).error.message, /unique current open questions/)
  assert.deepEqual(storedState(cwd, duplicateTask.task_id), duplicateBefore)
})

test('resolve-open-questions rejects unavailable required event storage before task mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = questionTask(cwd, 'resolve event storage failure')
  const directory = taskDirectory(cwd, created.task_id)
  const eventsPath = join(directory, 'events.jsonl')
  const previousEvents = readFileSync(eventsPath, 'utf8')
  const beforeTask = readFileSync(taskPath(cwd, created.task_id), 'utf8')
  const beforeState = readFileSync(join(cwd, '.latch', 'state.json'), 'utf8')
  mkdirSync(join(directory, 'event-storage-failure'))
  const blockedEventsPath = join(directory, 'event-storage-failure')
  const originalEventsPath = join(directory, 'events-original.jsonl')
  renameSync(eventsPath, originalEventsPath)
  renameSync(blockedEventsPath, eventsPath)

  const result = resolveOpenQuestions(cwd, created.task_id, {
    answers: [
      {
        question: '是否保留旧格式？',
        answer: '不保留。',
        decision: '只提供 current schema 5 格式。',
      },
    ],
  })

  assert.notEqual(result.status, 0)
  assert.equal(JSON.parse(result.stderr).error.code, 'command_failed')
  assert.equal(readFileSync(taskPath(cwd, created.task_id), 'utf8'), beforeTask)
  assert.equal(readFileSync(join(cwd, '.latch', 'state.json'), 'utf8'), beforeState)
  assert.equal(readFileSync(originalEventsPath, 'utf8'), previousEvents)
})

test('resolve-open-questions atomically replaces a read-only event log instead of losing decisions', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = questionTask(cwd, 'resolve read-only event log')
  const eventsPath = join(taskDirectory(cwd, created.task_id), 'events.jsonl')
  chmodSync(eventsPath, 0o400)

  const result = resolveOpenQuestions(cwd, created.task_id, {
    answers: [
      {
        question: '是否保留旧格式？',
        answer: '不保留。',
        decision: '只提供 current schema 5 格式。',
      },
    ],
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    events(cwd, created.task_id).slice(-2).map((event) => event.type),
    ['plan_updated', 'decision_recorded'],
  )
  assert.deepEqual(readTask(cwd, created.task_id).plan.open_questions, [])
})

test('resolve-open-questions applies only explicit user_approve atomically and preserves workspace proof', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = questionTask(cwd, 'resolve with authorization')
  const before = seedPlanLifecycle(cwd, created.task_id)
  const payload = {
    answers: [
      {
        question: '是否保留旧格式？',
        answer: '保留。',
        decision: '保留兼容读取。',
      },
    ],
  }
  const authFile = writeJson(cwd, 'authorization.json', authorization('user_approve'))

  const result = resolveOpenQuestions(cwd, created.task_id, payload, {
    authorizationFile: authFile,
  })

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.phase, 'dev')
  assert.equal(output.plan_revision, 2)
  assert.equal(output.work_revision, 1)
  assert.equal(output.authorization_applied, true)
  assert.deepEqual(output.next_action, {
    kind: 'command',
    command: 'verify-all',
  })
  assert.equal('workspace_proof' in output, true)
  const after = readTask(cwd, created.task_id)
  assert.equal(after.phase, 'dev')
  assert.equal(after.work_revision, 1)
  assert.equal(after.work_basis.source, 'user_approve')
  assert.equal(after.work_basis.plan_revision, 2)
  assert.deepEqual(after.verification, { gate: {}, diagnostic: {} })
  assert.equal('submission' in after, false)
  assert.deepEqual(after.workspace_proof, before.workspace_proof)
  assert.equal(
    existsSync(join(taskDirectory(cwd, created.task_id), 'evidence', 'baseline.json')),
    true,
  )
  assert.deepEqual(
    events(cwd, created.task_id).slice(-4).map((event) => event.type),
    ['plan_updated', 'decision_recorded', 'implementation_authorized', 'work_started'],
  )
})

test('resolve-open-questions rejects inferred, wrong-source, invalid, and non-authorizable authorization before mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const questions = ['问题一？']
  const created = questionTask(cwd, 'resolve authorization refusals', questions)
  const payload = { answers: [{ question: questions[0], answer: '回答', decision: '决定' }] }
  const cases = [
    authorization('user_delta'),
    authorization('user_request'),
    authorization('user_approve', { reason: '' }),
    { kind: 'implementation_authorization', source: 'user_approve' },
    authorization('user_approve', {
      scope: { summary: 'scope', paths: [false] },
    }),
    authorization('user_approve', {
      scope: { summary: 'scope', notes: ' ' },
    }),
  ]
  for (const value of cases) {
    const authFile = writeJson(cwd, 'authorization.json', value)
    const before = storedState(cwd, created.task_id)
    const result = resolveOpenQuestions(cwd, created.task_id, payload, {
      authorizationFile: authFile,
    })
    assert.notEqual(result.status, 0)
    assert.equal(JSON.parse(result.stderr).error.code, 'invalid_arguments')
    assert.deepEqual(storedState(cwd, created.task_id), before)
  }

  const sentinel = questionTask(cwd, 'resolve authorization sentinel', questions)
  const sentinelTask = readTask(cwd, sentinel.task_id)
  sentinelTask.plan.verification_plan = [
    { name: 'check', command: ['replace-with-real-command'], kind: 'gate' },
  ]
  writeTask(cwd, sentinel.task_id, sentinelTask)
  const sentinelBefore = storedState(cwd, sentinel.task_id)
  const sentinelResult = resolveOpenQuestions(cwd, sentinel.task_id, payload, {
    authorizationFile: writeJson(cwd, 'sentinel-authorization.json', authorization('user_approve')),
  })
  assert.notEqual(sentinelResult.status, 0)
  assert.equal(JSON.parse(sentinelResult.stderr).error.code, 'invalid_arguments')
  assert.match(JSON.parse(sentinelResult.stderr).error.message, /not authorizable/)
  assert.deepEqual(storedState(cwd, sentinel.task_id), sentinelBefore)
})

test('resolve-open-questions accepts one structured stdin input and rejects two stdin consumers before reading', () => {
  const cwd = temporaryDirectory()
  init(cwd)
  const created = questionTask(cwd, 'resolve answers from stdin')
  const payload = {
    answers: [{ question: '是否保留旧格式？', answer: '保留。', decision: '保留。' }],
  }
  const stdinResult = run(cwd, [
    'resolve-open-questions',
    created.task_id,
    '--expect-revision',
    '1',
    '--answers-file',
    '-',
    '--json',
  ], { input: `${JSON.stringify(payload)} \n` })
  assert.equal(stdinResult.status, 0, stdinResult.stderr)
  assert.deepEqual(JSON.parse(stdinResult.stdout).resolved_questions, payload.answers)
  assert.equal(existsSync(join(taskDirectory(cwd, created.task_id), 'evidence')), false)

  const second = questionTask(cwd, 'resolve two stdin consumers')
  const before = storedState(cwd, second.task_id)
  const bothStdin = run(cwd, [
    'resolve-open-questions',
    second.task_id,
    '--expect-revision',
    '1',
    '--answers-file',
    '-',
    '--authorization-file',
    '-',
    '--json',
  ], { input: JSON.stringify(payload) })
  assert.notEqual(bothStdin.status, 0)
  assert.equal(JSON.parse(bothStdin.stderr).error.code, 'invalid_arguments')
  assert.match(JSON.parse(bothStdin.stderr).error.message, /Only one structured JSON file option/)
  assert.deepEqual(storedState(cwd, second.task_id), before)

  const authTask = questionTask(cwd, 'resolve authorization from stdin')
  const authAnswers = writeJson(cwd, 'auth-answers.json', payload)
  const authStdin = run(cwd, [
    'resolve-open-questions',
    authTask.task_id,
    '--expect-revision',
    '1',
    '--answers-file',
    authAnswers,
    '--authorization-file',
    '-',
    '--json',
  ], {
    input: JSON.stringify(authorization('user_approve')),
  })
  assert.equal(authStdin.status, 0, authStdin.stderr)
  assert.equal(JSON.parse(authStdin.stdout).authorization_applied, true)
})

test('resolve-open-questions returns typed lifecycle refusals without mutation', () => {
  const cwd = temporaryDirectory()
  init(cwd)

  const missing = resolveOpenQuestions(cwd, 'missing-task', {
    answers: [{ question: '问题？', answer: '回答', decision: '决定' }],
  }, { expectRevision: '1' })
  assert.notEqual(missing.status, 0)
  assert.equal(JSON.parse(missing.stderr).error.code, 'task_not_found')

  const revisionTask = questionTask(cwd, 'resolve revision refusal')
  let before = storedState(cwd, revisionTask.task_id)
  const revisionResult = resolveOpenQuestions(cwd, revisionTask.task_id, {
    answers: [{ question: '是否保留旧格式？', answer: '回答', decision: '决定' }],
  }, { expectRevision: '9' })
  assert.notEqual(revisionResult.status, 0)
  assert.equal(JSON.parse(revisionResult.stderr).error.code, 'revision_conflict')
  assert.deepEqual(storedState(cwd, revisionTask.task_id), before)

  before = storedState(cwd, revisionTask.task_id)
  const writerResult = resolveOpenQuestions(cwd, revisionTask.task_id, {
    answers: [{ question: '是否保留旧格式？', answer: '回答', decision: '决定' }],
  }, { actor: otherWriter })
  assert.notEqual(writerResult.status, 0)
  assert.equal(JSON.parse(writerResult.stderr).error.code, 'writer_mismatch')
  assert.deepEqual(storedState(cwd, revisionTask.task_id), before)

  const devTask = questionTask(cwd, 'resolve phase refusal')
  const dev = readTask(cwd, devTask.task_id)
  dev.phase = 'dev'
  dev.work_revision = 1
  dev.implementation_approval = {
    approved_plan_revision: dev.plan_revision,
    approved_at: dev.updated_at,
    source: 'user',
    reason: 'fixture approval',
  }
  writeTask(cwd, devTask.task_id, dev)
  before = storedState(cwd, devTask.task_id)
  const phaseResult = resolveOpenQuestions(cwd, devTask.task_id, {
    answers: [{ question: '是否保留旧格式？', answer: '回答', decision: '决定' }],
  })
  assert.notEqual(phaseResult.status, 0)
  assert.equal(JSON.parse(phaseResult.stderr).error.code, 'phase_mismatch')
  assert.deepEqual(storedState(cwd, devTask.task_id), before)

  const blockedTask = questionTask(cwd, 'resolve blocked refusal')
  const blocked = readTask(cwd, blockedTask.task_id)
  blocked.blocked = {
    reason: '等待输入',
    waiting_for: '用户',
    blocked_at: blocked.updated_at,
  }
  writeTask(cwd, blockedTask.task_id, blocked)
  before = storedState(cwd, blockedTask.task_id)
  const blockedResult = resolveOpenQuestions(cwd, blockedTask.task_id, {
    answers: [{ question: '是否保留旧格式？', answer: '回答', decision: '决定' }],
  })
  assert.notEqual(blockedResult.status, 0)
  assert.equal(JSON.parse(blockedResult.stderr).error.code, 'task_blocked')
  assert.deepEqual(storedState(cwd, blockedTask.task_id), before)

  for (const schemaVersion of [2, 3, 4]) {
    const historicalTask = questionTask(cwd, `resolve schema ${schemaVersion} refusal`)
    const historical = readTask(cwd, historicalTask.task_id)
    historical.schema_version = schemaVersion
    if (schemaVersion === 4) historical.min_writer_version = '0.4.0'
    else delete historical.min_writer_version
    if (schemaVersion === 2) {
      delete historical.primary_writer
      delete historical.profile
      delete historical.provenance
    }
    writeTask(cwd, historicalTask.task_id, historical)
    before = storedState(cwd, historicalTask.task_id)
    const historicalResult = resolveOpenQuestions(cwd, historicalTask.task_id, {
      answers: [{ question: '是否保留旧格式？', answer: '回答', decision: '决定' }],
    })
    assert.notEqual(historicalResult.status, 0)
    assert.equal(JSON.parse(historicalResult.stderr).error.code, 'writer_version_mismatch')
    assert.deepEqual(storedState(cwd, historicalTask.task_id), before)
  }
})

test('resolve-open-questions exposes the approved usage and rejects missing answers-file', () => {
  const cwd = temporaryDirectory()
  const expected =
    'Usage: latch resolve-open-questions <task-id> --expect-revision <revision> --answers-file <path|-> [--authorization-file <path|->] [--json] [--brief]\n' +
    '--authorization-file JSON: {"kind":"implementation_authorization","source":"user_approve","reason":"Describe the authorized plan delta.","scope":{"summary":"Describe the current post-delta plan."}}\n'
  const help = run(cwd, ['resolve-open-questions', '--help'])
  assert.equal(help.status, 0, help.stderr)
  assert.equal(help.stdout, expected)

  const missing = run(cwd, [
    'resolve-open-questions',
    'some-task',
    '--expect-revision',
    '1',
    '--json',
  ])
  assert.notEqual(missing.status, 0)
  assert.equal(JSON.parse(missing.stderr).error.code, 'invalid_arguments')
  assert.match(JSON.parse(missing.stderr).error.message, /--answers-file is required/)
})
