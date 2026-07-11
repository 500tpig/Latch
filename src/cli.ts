#!/usr/bin/env node
import { parseArgs, type ParseArgsConfig } from 'node:util'
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import { actorId } from './core/actor.js'
import {
  contextHumanV2,
  contextJsonV2,
  jsonEnvelopeV2,
  listHumanV2,
  listJsonV2,
} from './core/task-view.js'
import {
  createTaskV2,
  currentTaskIdV2,
  initTaskStoreV2,
  openTaskStoreV2,
  readTaskV2,
  selectCurrentTaskV2,
  updateTaskV2,
} from './core/task-store.js'
import type { TaskArtifact, TaskPlan } from './core/types.js'
import {
  abandonTaskV2,
  approveTaskV2,
  doneTaskV2,
  submitTaskV2,
  verifyTaskV2,
} from './core/progress.js'
import { now, readJsonFile } from './core/utils.js'

const usage = `Usage: latch <command> [options]

Commands:
  init
  checkpoint <title> --plan-file <path>
  use <task-id>
  list [--json] [--brief]
  context [task-id] [--json] [--brief]
  save <task-id> --expect-revision <revision> [changes]
  approve <task-id> --expect-revision <revision> (--reason <text> | --feedback <text>)
  verify <task-id> --expect-revision <revision> --name <name> [--diagnostic] [-- command...]
  submit <task-id> --expect-revision <revision> --changes <text> --unverified <text> [--no-verify --reason <text>]
  done <task-id> --expect-revision <revision> --followup <text>
  abandon <task-id> --expect-revision <revision> --reason <text>`

const commandUsage: Record<string, string> = {
  init: 'Usage: latch init [--json]',
  checkpoint:
    'Usage: latch checkpoint <title> --plan-file <path> [--artifact <kind>:<path>] [--json]',
  use: 'Usage: latch use <task-id> [--json]',
  list: 'Usage: latch list [--json] [--brief]',
  context: 'Usage: latch context [task-id] [--json] [--brief]',
  save:
    'Usage: latch save <task-id> --expect-revision <revision> [--plan-file <path>] [--feedback <text>] [--decision <text>] [--artifact <kind>:<path>] [--remove-artifact <kind>:<path>] [--block-reason <text> --waiting-for <text> | --unblock] [--json]',
  approve:
    'Usage: latch approve <task-id> --expect-revision <revision> (--reason <text> | --feedback <text>) [--json]',
  verify:
    'Usage: latch verify <task-id> --expect-revision <revision> --name <name> [--diagnostic] [-- command...] [--json]',
  submit:
    'Usage: latch submit <task-id> --expect-revision <revision> --changes <text> --unverified <text> [--no-verify --reason <text>] [--json]',
  done:
    'Usage: latch done <task-id> --expect-revision <revision> --followup <text> [--json]',
  abandon:
    'Usage: latch abandon <task-id> --expect-revision <revision> --reason <text> [--json]',
}

class CliV2Error extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function fail(code: string, message: string): never {
  throw new CliV2Error(code, message)
}

function requirePositionals(
  command: string,
  positionals: string[],
  count: number | [number, number],
) {
  const minimum = Array.isArray(count) ? count[0] : count
  const maximum = Array.isArray(count) ? count[1] : count
  if (positionals.length < minimum || positionals.length > maximum)
    fail('invalid_arguments', commandUsage[command])
}

function positiveInteger(raw: string | undefined, name: string) {
  if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1)
    fail('invalid_arguments', `${name} must be a positive integer.`)
  return Number(raw)
}

function artifact(raw: string): TaskArtifact {
  const separator = raw.indexOf(':')
  if (separator <= 0)
    fail('invalid_arguments', `Artifact must be <kind>:<path>, got: ${raw}`)
  const kind = raw.slice(0, separator).trim()
  const inputPath = raw.slice(separator + 1).trim()
  if (!kind || !inputPath)
    fail('invalid_arguments', `Artifact kind and path are required, got: ${raw}`)
  if (isAbsolute(inputPath))
    fail('invalid_arguments', `Artifact path must be relative to workspace root: ${inputPath}`)
  const normalizedPath = normalize(inputPath)
  if (
    normalizedPath === '.' ||
    normalizedPath === '..' ||
    normalizedPath.startsWith(`..${sep}`)
  )
    fail('invalid_arguments', `Artifact path escapes workspace root: ${inputPath}`)
  return { kind, path: normalizedPath.split(sep).join('/') }
}

function artifactKey(value: TaskArtifact) {
  return `${value.kind}\u0000${value.path}`
}

function artifactLabel(value: TaskArtifact) {
  return `${value.kind}:${value.path}`
}

function readPlan(cwd: string, planFile: string | undefined) {
  if (!planFile) fail('invalid_arguments', '--plan-file is required.')
  return readJsonFile<TaskPlan>(resolve(cwd, planFile))
}

function json(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printWarnings(warnings: string[]) {
  for (const warning of warnings) process.stderr.write(`Warning: ${warning}\n`)
}

function mutationJson(
  task: { id: string; revision: number; phase: string },
  warnings: string[],
  previousRevision?: number,
) {
  return {
    ...jsonEnvelopeV2(),
    task_id: task.id,
    ...(previousRevision !== undefined ? { previous_revision: previousRevision } : {}),
    revision: task.revision,
    phase: task.phase,
    warnings,
  }
}

function parseCommand<T extends NonNullable<ParseArgsConfig['options']>>(
  args: string[],
  options: T,
) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail('invalid_arguments', message)
  }
}

function commonOptions() {
  return {
    help: { type: 'boolean', short: 'h' },
    json: { type: 'boolean' },
  } as const
}

function runInit(args: string[], cwd: string) {
  const parsed = parseCommand(args, commonOptions())
  requirePositionals('init', parsed.positionals, 0)
  if (parsed.values.help) return process.stdout.write(`${commandUsage.init}\n`)
  const store = initTaskStoreV2(cwd)
  if (parsed.values.json)
    return json({ ...jsonEnvelopeV2(), workspace_root: store.paths.workspaceRoot })
  process.stdout.write(`Initialized Latch v2 at ${store.paths.workspaceRoot}\n`)
}

function runCheckpoint(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'plan-file': { type: 'string' },
    artifact: { type: 'string', multiple: true },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.checkpoint}\n`)
  requirePositionals('checkpoint', parsed.positionals, 1)
  const store = openTaskStoreV2(cwd)
  const plan = readPlan(cwd, parsed.values['plan-file'])
  const artifacts = (parsed.values.artifact ?? []).map(artifact)
  const result = createTaskV2(
    store,
    { title: parsed.positionals[0], plan, artifacts },
    actor,
  )
  if (parsed.values.json) return json(mutationJson(result.task, result.warnings))
  process.stdout.write(`Created ${result.task.id} at revision ${result.task.revision}\n`)
  printWarnings(result.warnings)
}

function runUse(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, commonOptions())
  if (parsed.values.help) return process.stdout.write(`${commandUsage.use}\n`)
  requirePositionals('use', parsed.positionals, 1)
  const store = openTaskStoreV2(cwd)
  const taskId = selectCurrentTaskV2(store, actor, parsed.positionals[0])
  if (parsed.values.json)
    return json({ ...jsonEnvelopeV2(), task_id: taskId, warnings: [] })
  process.stdout.write(`Current task: ${taskId}\n`)
}

function validateBrief(jsonOutput: boolean | undefined, brief: boolean | undefined) {
  if (brief && !jsonOutput)
    fail('invalid_arguments', '--brief requires --json.')
}

function runList(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    brief: { type: 'boolean' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.list}\n`)
  requirePositionals('list', parsed.positionals, 0)
  validateBrief(parsed.values.json, parsed.values.brief)
  const store = openTaskStoreV2(cwd)
  if (parsed.values.json)
    return json(listJsonV2(store, actor, Boolean(parsed.values.brief)))
  process.stdout.write(`${listHumanV2(store, actor)}\n`)
}

function targetTask(cwd: string, actor: string, id: string | undefined) {
  const store = openTaskStoreV2(cwd)
  const taskId = id ?? currentTaskIdV2(store, actor)
  if (!taskId) fail('task_not_found', 'No current Latch v2 task.')
  return { store, task: readTaskV2(store, taskId) }
}

function runContext(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    brief: { type: 'boolean' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.context}\n`)
  requirePositionals('context', parsed.positionals, [0, 1])
  validateBrief(parsed.values.json, parsed.values.brief)
  const { store, task } = targetTask(cwd, actor, parsed.positionals[0])
  if (parsed.values.json)
    return json(contextJsonV2(store, task, actor, Boolean(parsed.values.brief)))
  process.stdout.write(`${contextHumanV2(store, task, actor)}\n`)
}

function runSave(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    'plan-file': { type: 'string' },
    feedback: { type: 'string' },
    decision: { type: 'string' },
    question: { type: 'string' },
    answer: { type: 'string' },
    artifact: { type: 'string', multiple: true },
    'remove-artifact': { type: 'string', multiple: true },
    'block-reason': { type: 'string' },
    'waiting-for': { type: 'string' },
    unblock: { type: 'boolean' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.save}\n`)
  requirePositionals('save', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  if ((parsed.values.question || parsed.values.answer) && !parsed.values.decision)
    fail('invalid_arguments', '--question and --answer require --decision.')
  if (parsed.values.unblock && (parsed.values['block-reason'] || parsed.values['waiting-for']))
    fail('invalid_arguments', '--unblock cannot be combined with block fields.')
  const hasBlock = parsed.values['block-reason'] || parsed.values['waiting-for']
  if (hasBlock && (!parsed.values['block-reason'] || !parsed.values['waiting-for']))
    fail('invalid_arguments', '--block-reason and --waiting-for are both required.')

  const store = openTaskStoreV2(cwd)
  const current = readTaskV2(store, parsed.positionals[0])
  const nextPlan = parsed.values['plan-file']
    ? readPlan(cwd, parsed.values['plan-file'])
    : undefined
  const planChanged =
    nextPlan !== undefined && JSON.stringify(nextPlan) !== JSON.stringify(current.plan)
  if (parsed.values.feedback && !planChanged)
    fail('invalid_arguments', '--feedback requires an effective --plan-file change.')

  const addedArtifacts = (parsed.values.artifact ?? []).map(artifact)
  const removedArtifacts = (parsed.values['remove-artifact'] ?? []).map(artifact)
  const removedKeys = new Set(removedArtifacts.map(artifactKey))
  const actuallyRemoved = current.artifacts.filter((value) =>
    removedKeys.has(artifactKey(value)),
  )
  const nextArtifacts = current.artifacts.filter(
    (value) => !removedKeys.has(artifactKey(value)),
  )
  const existingKeys = new Set(nextArtifacts.map(artifactKey))
  const actuallyAdded: TaskArtifact[] = []
  for (const value of addedArtifacts) {
    const key = artifactKey(value)
    if (!existingKeys.has(key)) {
      nextArtifacts.push(value)
      actuallyAdded.push(value)
      existingKeys.add(key)
    }
  }
  const artifactsChanged =
    JSON.stringify(nextArtifacts) !== JSON.stringify(current.artifacts)

  const shouldBlock = Boolean(hasBlock)
  const shouldUnblock = Boolean(parsed.values.unblock && current.blocked)
  const events: Parameters<typeof updateTaskV2>[2]['events'] = []
  if (planChanged) {
    events.push({
      type: 'plan_updated',
      fields: { plan_revision: current.plan_revision + 1 },
    })
    if (parsed.values.feedback)
      events.push({
        type: 'review_feedback',
        fields: {
          plan_revision: current.plan_revision + 1,
          work_revision: current.work_revision,
          classification: 'plan_change',
          summary: parsed.values.feedback,
        },
      })
  }
  if (parsed.values.decision)
    events.push({
      type: 'decision_recorded',
      fields: {
        plan_revision: planChanged
          ? current.plan_revision + 1
          : current.plan_revision,
        ...(parsed.values.question ? { question: parsed.values.question } : {}),
        ...(parsed.values.answer ? { answer: parsed.values.answer } : {}),
        conclusion: parsed.values.decision,
      },
    })
  if (artifactsChanged)
    events.push({
      type: 'artifact_updated',
      fields: {
        added: actuallyAdded.map(artifactLabel),
        removed: actuallyRemoved.map(artifactLabel),
      },
    })
  if (shouldBlock)
    events.push({
      type: 'blocked',
      fields: {
        reason: parsed.values['block-reason'],
        waiting_for: parsed.values['waiting-for'],
      },
    })
  if (shouldUnblock) events.push({ type: 'unblocked' })
  if (events.length === 0)
    fail('invalid_arguments', 'save did not contain any effective change.')

  const result = updateTaskV2(store, current.id, {
    expectRevision,
    actor,
    events,
    update(task) {
      if (planChanged && nextPlan) {
        task.plan = structuredClone(nextPlan)
        task.plan_revision += 1
        task.phase = 'plan'
        delete task.implementation_approval
        delete task.submission
        task.verification = { gate: {}, diagnostic: {} }
      }
      if (artifactsChanged) task.artifacts = structuredClone(nextArtifacts)
      if (shouldBlock)
        task.blocked = {
          reason: parsed.values['block-reason']!,
          waiting_for: parsed.values['waiting-for']!,
          blocked_at: now(),
        }
      if (shouldUnblock) delete task.blocked
    },
  })

  if (parsed.values.json)
    return json(mutationJson(result.task, result.warnings, current.revision))
  process.stdout.write(
    `Saved ${result.task.id}: revision ${current.revision} -> ${result.task.revision}\n`,
  )
  printWarnings(result.warnings)
}

function runApprove(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    reason: { type: 'string' },
    feedback: { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.approve}
`)
  requirePositionals('approve', parsed.positionals, 1)
  if (parsed.values.reason && parsed.values.feedback)
    fail('invalid_arguments', '--reason and --feedback cannot be combined.')
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const store = openTaskStoreV2(cwd)
  const result = approveTaskV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    reason: parsed.values.reason,
    feedback: parsed.values.feedback,
  })
  if (parsed.values.json)
    return json(mutationJson(result.task, result.warnings, expectRevision))
  process.stdout.write(
    `Approved ${result.task.id}: revision ${expectRevision} -> ${result.task.revision}
`,
  )
  printWarnings(result.warnings)
}

function runVerify(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    name: { type: 'string' },
    diagnostic: { type: 'boolean' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.verify}\n`)
  const diagnostic = Boolean(parsed.values.diagnostic)
  requirePositionals('verify', parsed.positionals, [1, Number.MAX_SAFE_INTEGER])
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  if (!parsed.values.name) fail('invalid_arguments', '--name is required.')
  const command = parsed.positionals.slice(1)
  if (!diagnostic && command.length > 0)
    fail('invalid_arguments', 'Gate verification command comes from the approved plan.')
  const store = openTaskStoreV2(cwd)
  const result = verifyTaskV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    name: parsed.values.name,
    diagnostic,
    command: command.length > 0 ? command : undefined,
  })
  if (parsed.values.json)
    json({
      ...mutationJson(result.task, result.warnings, expectRevision),
      verification: result.verification,
    })
  else {
    process.stdout.write(
      `Verified ${result.task.id} ${result.verification.name}: ${result.verification.status}\n`,
    )
    printWarnings(result.warnings)
  }
  if (result.verification.status === 'fail') process.exitCode = 1
}

function runSubmit(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    changes: { type: 'string' },
    unverified: { type: 'string' },
    'no-verify': { type: 'boolean' },
    reason: { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.submit}\n`)
  requirePositionals('submit', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  if (!parsed.values.changes) fail('invalid_arguments', '--changes is required.')
  if (parsed.values.unverified === undefined)
    fail('invalid_arguments', '--unverified is required.')
  const store = openTaskStoreV2(cwd)
  const result = submitTaskV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    changes: parsed.values.changes,
    unverified: parsed.values.unverified,
    noVerify: Boolean(parsed.values['no-verify']),
    reason: parsed.values.reason,
  })
  if (parsed.values.json)
    return json(mutationJson(result.task, result.warnings, expectRevision))
  process.stdout.write(`Submitted ${result.task.id} for review.\n`)
  printWarnings(result.warnings)
}

function runDone(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    followup: { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.done}\n`)
  requirePositionals('done', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  if (parsed.values.followup === undefined)
    fail('invalid_arguments', '--followup is required.')
  const store = openTaskStoreV2(cwd)
  const result = doneTaskV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    followup: parsed.values.followup,
  })
  if (parsed.values.json)
    return json({
      ...mutationJson(result.task, result.warnings, expectRevision),
      outcome: result.task.outcome,
    })
  process.stdout.write(`Archived ${result.task.id} as done.\n`)
  printWarnings(result.warnings)
}

function runAbandon(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    reason: { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.abandon}\n`)
  requirePositionals('abandon', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  if (!parsed.values.reason) fail('invalid_arguments', '--reason is required.')
  const store = openTaskStoreV2(cwd)
  const result = abandonTaskV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    reason: parsed.values.reason,
  })
  if (parsed.values.json)
    return json({
      ...mutationJson(result.task, result.warnings, expectRevision),
      outcome: result.task.outcome,
    })
  process.stdout.write(`Archived ${result.task.id} as abandoned.\n`)
  printWarnings(result.warnings)
}

function run(argv: string[], cwd: string) {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${usage}\n`)
    return
  }
  const args = argv.slice(1)
  const actor = actorId()
  switch (command) {
    case 'init':
      return runInit(args, cwd)
    case 'checkpoint':
      return runCheckpoint(args, cwd, actor)
    case 'use':
      return runUse(args, cwd, actor)
    case 'list':
      return runList(args, cwd, actor)
    case 'context':
      return runContext(args, cwd, actor)
    case 'save':
      return runSave(args, cwd, actor)
    case 'approve':
      return runApprove(args, cwd, actor)
    case 'verify':
      return runVerify(args, cwd, actor)
    case 'submit':
      return runSubmit(args, cwd, actor)
    case 'done':
      return runDone(args, cwd, actor)
    case 'abandon':
      return runAbandon(args, cwd, actor)
    default:
      fail('unknown_command', `Unknown command: ${command}\n${usage}`)
  }
}

try {
  run(process.argv.slice(2), process.cwd())
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof CliV2Error ? error.code : 'command_failed'
  if (process.argv.includes('--json'))
    process.stderr.write(
      `${JSON.stringify({ ...jsonEnvelopeV2(), error: { code, message } }, null, 2)}\n`,
    )
  else process.stderr.write(`${message}\n`)
  process.exitCode = 1
}
