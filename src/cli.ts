#!/usr/bin/env node
import { parseArgs, type ParseArgsConfig } from 'node:util'
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import {
  actorId,
  assertWritableActor,
  isWritableActor,
} from './core/actor.js'
import { injectHostActor } from './host-adapter.js'
import {
  evaluateContextBenchmark,
  parseContextBenchCase,
  parseContextBenchRun,
} from './core/context-benchmark.js'
import {
  buildContextPack,
  loadContextPackSections,
  parseContextPackRequest,
  type ContextPackSectionInput,
} from './core/context-pack.js'
import {
  checkKnowledgeDocument,
  checkTaskKnowledgeDocuments,
  fingerprintKnowledgeDocument,
  type KnowledgeCheckResult,
} from './core/knowledge.js'
import { discoverWorkspaceRoot } from './core/paths.js'
import {
  contextHumanV2,
  contextJsonV2,
  jsonEnvelopeV2,
  listHumanV2,
  listJsonV2,
  type ContextHistoryView,
} from './core/task-view.js'
import {
  assertGroupIdV3,
  claimTaskV3,
  createTaskV3,
  currentTaskIdV2,
  downgradeTaskV2,
  initTaskStoreV2,
  openTaskStoreV2,
  readTaskV2,
  selectCurrentTaskV2,
  takeoverTaskV3,
  updateTaskV2,
  updateTaskV3,
} from './core/task-store.js'
import type {
  ImplementationAuthorizationInput,
  KnowledgeImpact,
  RetrospectiveRecordInput,
  TaskArtifact,
  TaskPlan,
  TaskProfile,
  TaskProvenance,
} from './core/types.js'
import {
  abandonTaskV2,
  approveTaskV2,
  changeTaskProfileV3,
  doneTaskV2,
  patchSubmissionKnowledgeImpactV3,
  submitTaskV2,
  verifyTaskV2,
} from './core/progress.js'
import { now, readJsonFile } from './core/utils.js'

const usage = `Usage: latch <command> [options]

Commands:
  init
  checkpoint <title> --plan-file <path> [--profile <light|standard>] [--authorize-request <reason> [--scope-summary <summary>] [--scope-path <path>...] | --authorization-file <path> | --retrospective-file <path>]
  use <task-id>
  list [--group <id> [--include-archive]] [--json] [--brief]
  context [task-id] [--json] [--brief | --status | --since-revision <revision>] [--history <timeline|events|both>]
  context pack --input-file <path>
  knowledge <fingerprint|check> [options]
  benchmark context [options]
  claim <task-id> --expect-revision <revision> [--reason <text>]
  takeover <task-id> --expect-revision <revision> --reason <text>
  save <task-id> --expect-revision <revision> [changes]
  approve <task-id> --expect-revision <revision> [--reason <text> | --authorization-file <path> | --retrospective-file <path>] [--feedback <text> | --non-implementation-feedback <text>]
  verify <task-id> --expect-revision <revision> --name <name> [--diagnostic] [-- command...]
  submit <task-id> --expect-revision <revision> --changes <text> --unverified <text> [--knowledge-impact-none <reason> | --knowledge-impact-file <path>] [--no-verify --reason <text>]
  patch-submission-knowledge-impact <task-id> --expect-revision <revision> --knowledge-impact-file <path> [--reason <text>]
  downgrade-v2 --task <task-id> --expect-revision <revision> --confirm-data-loss
  done <task-id> --expect-revision <revision> --followup <text>
  abandon <task-id> --expect-revision <revision> --reason <text>`

const commandUsage: Record<string, string> = {
  init: 'Usage: latch init [--json]',
  checkpoint:
    'Usage: latch checkpoint <title> --plan-file <path> [--profile <light|standard>] [--authorize-request <reason> [--scope-summary <summary>] [--scope-path <path>...] | --authorization-file <path> | --retrospective-file <path>] [--artifact <kind>:<path>] [--json]',
  use: 'Usage: latch use <task-id> [--json]',
  list:
    'Usage: latch list [--group <id> [--include-archive]] [--json] [--brief]',
  context:
    'Usage: latch context [task-id] [--json] [--brief | --status | --since-revision <revision>] [--history <timeline|events|both>]',
  'context-pack': 'Usage: latch context pack --input-file <path> [--json]',
  knowledge:
    'Usage: latch knowledge fingerprint --path <path> [--json]\n       latch knowledge check (--path <path> | --task <task-id>) [--json]',
  benchmark:
    'Usage: latch benchmark context --case-file <path> --run-file <path> [--baseline-run-file <path>] [--json]',
  claim:
    'Usage: latch claim <task-id> --expect-revision <revision> [--reason <text>] [--json]',
  takeover:
    'Usage: latch takeover <task-id> --expect-revision <revision> --reason <text> [--json]',
  save:
    'Usage: latch save <task-id> --expect-revision <revision> [--plan-file <path>] [--feedback <text>] [--decision <text>] [--artifact <kind>:<path>] [--remove-artifact <kind>:<path>] [--block-reason <text> --waiting-for <text> | --unblock] [--profile <light|standard> --profile-reason <text> [--user-requested-narrowing] | --provenance <clean|mixed> --provenance-reason <text> | --group <id> | --clear-group] [--json]',
  approve:
    'Usage: latch approve <task-id> --expect-revision <revision> [--reason <text> | --authorization-file <path> | --retrospective-file <path>] [--feedback <text> | --non-implementation-feedback <text>] [--json]',
  verify:
    'Usage: latch verify <task-id> --expect-revision <revision> --name <name> [--diagnostic] [-- command...] [--json]',
  submit:
    'Usage: latch submit <task-id> --expect-revision <revision> --changes <text> --unverified <text> [--knowledge-impact-none <reason> | --knowledge-impact-file <path>] [--no-verify --reason <text>] [--json]',
  'patch-submission-knowledge-impact':
    'Usage: latch patch-submission-knowledge-impact <task-id> --expect-revision <revision> --knowledge-impact-file <path> [--reason <text>] [--json]',
  'downgrade-v2':
    'Usage: latch downgrade-v2 --task <task-id> --expect-revision <revision> --confirm-data-loss [--json]',
  done:
    'Usage: latch done <task-id> --expect-revision <revision> --followup <text> [--json]',
  abandon:
    'Usage: latch abandon <task-id> --expect-revision <revision> --reason <text> [--json]',
}

const actorRequiredCommands = new Set([
  'checkpoint',
  'use',
  'claim',
  'takeover',
  'save',
  'approve',
  'verify',
  'submit',
  'patch-submission-knowledge-impact',
  'downgrade-v2',
  'done',
  'abandon',
])

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

function nonNegativeInteger(raw: string | undefined, name: string) {
  if (raw === undefined || !/^\d+$/.test(raw))
    fail('invalid_arguments', `${name} must be a non-negative integer.`)
  return Number(raw)
}

function groupId(raw: string | undefined) {
  if (raw === undefined) return undefined
  try {
    assertGroupIdV3(raw, '--group')
    return raw
  } catch (error) {
    fail('invalid_arguments', error instanceof Error ? error.message : String(error))
  }
}

function taskProvenance(raw: string | undefined) {
  if (raw === undefined) return undefined
  if (raw !== 'clean' && raw !== 'mixed')
    fail('invalid_arguments', '--provenance must be clean or mixed.')
  return raw as TaskProvenance
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

function readInputFile<T>(cwd: string, path: string | undefined, option: string) {
  if (!path) fail('invalid_arguments', `${option} is required.`)
  return readJsonFile<T>(resolve(cwd, path))
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
    profile: { type: 'string' },
    'authorize-request': { type: 'string' },
    'scope-summary': { type: 'string' },
    'scope-path': { type: 'string', multiple: true },
    'authorization-file': { type: 'string' },
    'retrospective-file': { type: 'string' },
    artifact: { type: 'string', multiple: true },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.checkpoint}\n`)
  requirePositionals('checkpoint', parsed.positionals, 1)
  if (parsed.values.profile !== undefined &&
      parsed.values.profile !== 'light' &&
      parsed.values.profile !== 'standard')
    fail('invalid_arguments', '--profile must be light or standard.')
  const hasInlineAuthorization = parsed.values['authorize-request'] !== undefined
  const hasAuthorizationFile = parsed.values['authorization-file'] !== undefined
  const hasRetrospective = parsed.values['retrospective-file'] !== undefined
  if (
    Number(hasInlineAuthorization) + Number(hasAuthorizationFile) + Number(hasRetrospective) > 1
  )
    fail(
      'invalid_arguments',
      '--authorize-request, --authorization-file, and --retrospective-file cannot be combined.',
    )
  if (
    !hasInlineAuthorization &&
    (parsed.values['scope-summary'] !== undefined || parsed.values['scope-path'] !== undefined)
  )
    fail(
      'invalid_arguments',
      '--scope-summary and --scope-path require --authorize-request.',
    )
  if (hasInlineAuthorization && !parsed.values['authorize-request']?.trim())
    fail('invalid_arguments', '--authorize-request must be non-empty.')
  if (
    hasInlineAuthorization &&
    parsed.values['scope-summary'] !== undefined &&
    !parsed.values['scope-summary'].trim()
  )
    fail('invalid_arguments', '--scope-summary must be non-empty when provided.')
  if (
    hasInlineAuthorization &&
    (parsed.values['scope-path'] ?? []).some((path) => !path.trim())
  )
    fail('invalid_arguments', '--scope-path entries must be non-empty.')
  if (hasInlineAuthorization && parsed.values.profile === 'standard')
    fail('invalid_arguments', 'Checkpoint request authorization requires profile light.')
  const plan = readPlan(cwd, parsed.values['plan-file'])
  const artifacts = (parsed.values.artifact ?? []).map(artifact)
  const authorization = hasAuthorizationFile
    ? readInputFile<ImplementationAuthorizationInput>(
        cwd,
        parsed.values['authorization-file'],
        '--authorization-file',
      )
    : undefined
  const retrospective = parsed.values['retrospective-file']
    ? readInputFile<RetrospectiveRecordInput>(
        cwd,
        parsed.values['retrospective-file'],
        '--retrospective-file',
      )
    : undefined
  if (hasAuthorizationFile && authorization?.source !== 'user_request')
    fail(
      'invalid_arguments',
      'Invalid checkpoint authorization: work_basis.source must be user_request; expected implementation_authorization with work_basis.kind, work_basis.source, work_basis.reason, and work_basis.scope.summary.',
    )
  if (hasAuthorizationFile && parsed.values.profile === 'standard')
    fail('invalid_arguments', 'Checkpoint request authorization requires profile light.')
  const inlineAuthorization: ImplementationAuthorizationInput | undefined =
    hasInlineAuthorization
      ? {
          kind: 'implementation_authorization',
          source: 'user_request',
          reason: parsed.values['authorize-request']!.trim(),
          scope: {
            summary: (parsed.values['scope-summary'] ?? parsed.values['authorize-request'])!.trim(),
            ...(parsed.values['scope-path']?.length
              ? { paths: parsed.values['scope-path'].map((path) => path.trim()) }
              : {}),
          },
        }
      : undefined
  const profile = hasInlineAuthorization || hasAuthorizationFile
    ? 'light'
    : (parsed.values.profile ?? 'standard') as TaskProfile
  const store = openTaskStoreV2(cwd)
  const result = createTaskV3(
    store,
    {
      title: parsed.positionals[0],
      plan,
      artifacts,
      profile,
      ...(hasInlineAuthorization || hasAuthorizationFile || hasRetrospective
        ? {
            workBasis: hasInlineAuthorization
              ? inlineAuthorization!
              : hasAuthorizationFile
                ? authorization!
                : retrospective!,
          }
        : {}),
    },
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

function contextHistoryView(raw: string | undefined): ContextHistoryView | undefined {
  if (raw === undefined) return undefined
  if (raw === 'timeline' || raw === 'events' || raw === 'both') return raw
  fail('invalid_arguments', '--history must be timeline, events, or both.')
}

function runList(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    brief: { type: 'boolean' },
    group: { type: 'string' },
    'include-archive': { type: 'boolean' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.list}\n`)
  requirePositionals('list', parsed.positionals, 0)
  validateBrief(parsed.values.json, parsed.values.brief)
  const selectedGroup = groupId(parsed.values.group)
  if (parsed.values['include-archive'] && selectedGroup === undefined)
    fail('invalid_arguments', '--include-archive requires --group.')
  const store = openTaskStoreV2(cwd)
  if (parsed.values.json)
    return json(listJsonV2(store, actor, Boolean(parsed.values.brief), {
      groupId: selectedGroup,
      includeArchive: Boolean(parsed.values['include-archive']),
    }))
  process.stdout.write(`${listHumanV2(store, actor, {
    groupId: selectedGroup,
    includeArchive: Boolean(parsed.values['include-archive']),
  })}\n`)
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
    status: { type: 'boolean' },
    'since-revision': { type: 'string' },
    history: { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.context}\n`)
  requirePositionals('context', parsed.positionals, [0, 1])
  validateBrief(parsed.values.json, parsed.values.brief)
  if (
    (parsed.values.status ||
      parsed.values['since-revision'] !== undefined ||
      parsed.values.history !== undefined) &&
    !parsed.values.json
  )
    fail('invalid_arguments', '--status, --since-revision, and --history require --json.')
  const history = contextHistoryView(parsed.values.history)
  if (parsed.values.status && history !== undefined)
    fail('invalid_arguments', '--history cannot be combined with --status.')
  const selectedViews = [
    Boolean(parsed.values.brief),
    Boolean(parsed.values.status),
    parsed.values['since-revision'] !== undefined,
  ].filter(Boolean).length
  if (selectedViews > 1)
    fail(
      'invalid_arguments',
      '--brief, --status, and --since-revision are mutually exclusive.',
    )
  if (!parsed.positionals[0] && !isWritableActor(actor))
    fail(
      'actor_required',
      'Actor required for context without task id.\n' +
        'Pass an explicit task id or set a session actor.',
    )
  const { store, task } = targetTask(cwd, actor, parsed.positionals[0])
  const sinceRevision =
    parsed.values['since-revision'] !== undefined
      ? nonNegativeInteger(parsed.values['since-revision'], '--since-revision')
      : undefined
  if (sinceRevision !== undefined && sinceRevision > task.revision)
    fail(
      'invalid_arguments',
      `--since-revision cannot exceed current task revision ${task.revision}.`,
    )
  if (parsed.values.json)
    return json(contextJsonV2(store, task, actor, {
      brief: Boolean(parsed.values.brief),
      status: Boolean(parsed.values.status),
      sinceRevision,
      history,
    }))
  process.stdout.write(`${contextHumanV2(store, task, actor)}\n`)
}

function runContextPack(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'input-file': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage['context-pack']}\n`)
  if (parsed.positionals.length > 0)
    fail('invalid_arguments', commandUsage['context-pack'])
  const request = parseContextPackRequest(
    readInputFile<unknown>(cwd, parsed.values['input-file'], '--input-file'),
  )

  let workspaceRoot: string
  let effectiveRequest = request
  const automaticSections: ContextPackSectionInput[] = []
  if (request.task_id) {
    const store = openTaskStoreV2(cwd)
    const task = readTaskV2(store, request.task_id)
    const context = contextJsonV2(store, task, actor, true)
    workspaceRoot = store.paths.workspaceRoot
    effectiveRequest = {
      ...request,
      task_id: task.id,
      ...(request.orientation
        ? { orientation: { ...request.orientation, task_id: task.id } }
        : {}),
    }
    automaticSections.push({
      kind: 'task',
      content: JSON.stringify(context.task, null, 2),
    })
    if ('group' in context)
      automaticSections.push({
        kind: 'sibling',
        content: JSON.stringify(context.group, null, 2),
      })
  } else {
    workspaceRoot = discoverWorkspaceRoot(cwd, { forInit: true })
  }

  const requestedSections = loadContextPackSections(workspaceRoot, effectiveRequest)
  const result = buildContextPack(effectiveRequest, [
    ...automaticSections,
    ...requestedSections,
  ])
  process.stdout.write(result.serialized)
}

function knowledgeCheckHuman(result: KnowledgeCheckResult) {
  return [
    `Knowledge: ${result.path}`,
    `Freshness: ${result.freshness}`,
    `Review needed: ${result.review_needed ? 'yes' : 'no'}`,
    ...(result.fingerprint ? [`Fingerprint: ${result.fingerprint}`] : []),
    `Files: ${result.files.length}`,
    ...(result.error ? [`Error: ${result.error}`] : []),
    ...result.warnings.map((warning) => `Warning: ${warning}`),
  ].join('\n')
}

function runKnowledge(args: string[], cwd: string) {
  const action = args[0]
  if (!action || action === '--help' || action === '-h')
    return process.stdout.write(`${commandUsage.knowledge}\n`)
  if (action !== 'fingerprint' && action !== 'check')
    fail('invalid_arguments', `Unknown knowledge command: ${action}\n${commandUsage.knowledge}`)

  const parsed = parseCommand(args.slice(1), {
    ...commonOptions(),
    path: { type: 'string' },
    task: { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage.knowledge}\n`)
  if (parsed.positionals.length > 0)
    fail('invalid_arguments', commandUsage.knowledge)

  if (action === 'fingerprint') {
    if (!parsed.values.path || parsed.values.task)
      fail('invalid_arguments', 'knowledge fingerprint requires --path and does not accept --task.')
    const workspaceRoot = discoverWorkspaceRoot(cwd, { forInit: true })
    const result = fingerprintKnowledgeDocument(workspaceRoot, parsed.values.path)
    if (parsed.values.json)
      return json({ ...jsonEnvelopeV2(), knowledge: result })
    process.stdout.write([
      `Knowledge: ${result.path}`,
      `Algorithm: ${result.algorithm}`,
      `Fingerprint: ${result.fingerprint}`,
      `Files: ${result.files.length}`,
      ...result.warnings.map((warning) => `Warning: ${warning}`),
    ].join('\n') + '\n')
    return
  }

  if (Boolean(parsed.values.path) === Boolean(parsed.values.task))
    fail('invalid_arguments', 'knowledge check requires exactly one of --path or --task.')
  if (parsed.values.path) {
    const workspaceRoot = discoverWorkspaceRoot(cwd, { forInit: true })
    const result = checkKnowledgeDocument(workspaceRoot, parsed.values.path)
    if (parsed.values.json)
      return json({ ...jsonEnvelopeV2(), knowledge: result })
    process.stdout.write(`${knowledgeCheckHuman(result)}\n`)
    return
  }

  const store = openTaskStoreV2(cwd)
  const task = readTaskV2(store, parsed.values.task!)
  const result = checkTaskKnowledgeDocuments(store.paths.workspaceRoot, task)
  if (parsed.values.json)
    return json({ ...jsonEnvelopeV2(), ...result })
  process.stdout.write([
    `Task: ${result.task_id}`,
    ...result.documents.map(knowledgeCheckHuman),
  ].join('\n') + '\n')
}

function runBenchmark(args: string[], cwd: string) {
  const subject = args[0]
  if (!subject || subject === '--help' || subject === '-h')
    return process.stdout.write(`${commandUsage.benchmark}\n`)
  if (subject !== 'context')
    fail('invalid_arguments', `Unknown benchmark command: ${subject}\n${commandUsage.benchmark}`)
  const parsed = parseCommand(args.slice(1), {
    ...commonOptions(),
    'case-file': { type: 'string' },
    'run-file': { type: 'string' },
    'baseline-run-file': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage.benchmark}\n`)
  if (parsed.positionals.length > 0)
    fail('invalid_arguments', commandUsage.benchmark)
  const benchmarkCase = parseContextBenchCase(
    readInputFile<unknown>(cwd, parsed.values['case-file'], '--case-file'),
  )
  const run = parseContextBenchRun(
    readInputFile<unknown>(cwd, parsed.values['run-file'], '--run-file'),
  )
  const baseline = parsed.values['baseline-run-file']
    ? parseContextBenchRun(
        readInputFile<unknown>(
          cwd,
          parsed.values['baseline-run-file'],
          '--baseline-run-file',
        ),
      )
    : undefined
  const result = evaluateContextBenchmark(benchmarkCase, run, baseline)
  if (parsed.values.json)
    return json({ ...jsonEnvelopeV2(), benchmark: result })
  process.stdout.write([
    `Benchmark: ${result.case_id}`,
    `Main: ${result.pass_main ? 'pass' : 'fail'}`,
    `Failures: ${result.failures.join(', ') || '-'}`,
    ...(result.token_goal_evaluated
      ? [`Token goal: ${result.token_goal_miss ? 'miss' : 'pass'}`]
      : ['Token goal: not evaluated']),
  ].join('\n') + '\n')
}

function runClaim(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    reason: { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.claim}\n`)
  requirePositionals('claim', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const store = openTaskStoreV2(cwd)
  const result = claimTaskV3(store, parsed.positionals[0], {
    expectRevision,
    actor,
    reason: parsed.values.reason,
  })
  if (parsed.values.json)
    return json(mutationJson(result.task, result.warnings, expectRevision))
  process.stdout.write(`Claimed ${result.task.id} for ${actor}.\n`)
  printWarnings(result.warnings)
}

function runTakeover(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    reason: { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage.takeover}\n`)
  requirePositionals('takeover', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  if (!parsed.values.reason) fail('invalid_arguments', '--reason is required.')
  const store = openTaskStoreV2(cwd)
  const result = takeoverTaskV3(store, parsed.positionals[0], {
    expectRevision,
    actor,
    reason: parsed.values.reason,
  })
  if (parsed.values.json)
    return json(mutationJson(result.task, result.warnings, expectRevision))
  process.stdout.write(`Transferred ${result.task.id} to ${actor}.\n`)
  printWarnings(result.warnings)
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
    profile: { type: 'string' },
    'profile-reason': { type: 'string' },
    'user-requested-narrowing': { type: 'boolean' },
    provenance: { type: 'string' },
    'provenance-reason': { type: 'string' },
    group: { type: 'string' },
    'clear-group': { type: 'boolean' },
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

  const selectedGroup = groupId(parsed.values.group)
  const clearGroup = Boolean(parsed.values['clear-group'])
  const selectedProvenance = taskProvenance(parsed.values.provenance)
  if (selectedProvenance !== undefined) {
    if (!parsed.values['provenance-reason'])
      fail('invalid_arguments', '--provenance-reason is required with --provenance.')
    const combined = Boolean(
      parsed.values['plan-file'] ||
      parsed.values.feedback ||
      parsed.values.decision ||
      parsed.values.question ||
      parsed.values.answer ||
      parsed.values.artifact?.length ||
      parsed.values['remove-artifact']?.length ||
      hasBlock ||
      parsed.values.unblock ||
      parsed.values.profile ||
      parsed.values['profile-reason'] ||
      parsed.values['user-requested-narrowing'] ||
      selectedGroup !== undefined ||
      clearGroup,
    )
    if (combined)
      fail('invalid_arguments', '--provenance must be saved as a standalone change.')
    const store = openTaskStoreV2(cwd)
    const current = readTaskV2(store, parsed.positionals[0])
    const previousProvenance = current.provenance ?? 'clean'
    if (previousProvenance === selectedProvenance)
      fail('invalid_arguments', 'save did not change provenance.')
    const reason = parsed.values['provenance-reason']
    const result = updateTaskV3(store, current.id, {
      expectRevision,
      actor,
      events: [{
        type: 'decision_recorded',
        fields: {
          plan_revision: current.plan_revision,
          conclusion: `provenance ${previousProvenance} -> ${selectedProvenance}: ${reason}`,
        },
      }],
      update(task) {
        task.provenance = selectedProvenance
      },
    })
    if (parsed.values.json)
      return json(mutationJson(result.task, result.warnings, expectRevision))
    process.stdout.write(
      `Changed ${result.task.id} provenance to ${selectedProvenance}.\n`,
    )
    return printWarnings(result.warnings)
  }
  if (parsed.values['provenance-reason'])
    fail('invalid_arguments', '--provenance-reason requires --provenance.')
  if (selectedGroup !== undefined && clearGroup)
    fail('invalid_arguments', '--group and --clear-group cannot be combined.')
  if (selectedGroup !== undefined || clearGroup) {
    const combined = Boolean(
      parsed.values['plan-file'] ||
      parsed.values.feedback ||
      parsed.values.decision ||
      parsed.values.question ||
      parsed.values.answer ||
      parsed.values.artifact?.length ||
      parsed.values['remove-artifact']?.length ||
      hasBlock ||
      parsed.values.unblock ||
      parsed.values.profile ||
      parsed.values['profile-reason'] ||
      parsed.values['user-requested-narrowing'] ||
      parsed.values.provenance ||
      parsed.values['provenance-reason'],
    )
    if (combined)
      fail('invalid_arguments', '--group must be saved as a standalone change.')
    const store = openTaskStoreV2(cwd)
    const current = readTaskV2(store, parsed.positionals[0])
    const nextGroup = clearGroup ? undefined : selectedGroup
    if (current.schema_version === 3 && current.group_id === nextGroup)
      fail('invalid_arguments', 'save did not change group_id.')
    const result = updateTaskV3(store, current.id, {
      expectRevision,
      actor,
      events: [{
        type: 'group_changed',
        fields: {
          ...(current.group_id !== undefined ? { from: current.group_id } : {}),
          ...(nextGroup !== undefined ? { to: nextGroup } : {}),
        },
      }],
      update(task) {
        if (nextGroup === undefined) delete task.group_id
        else task.group_id = nextGroup
      },
    })
    if (parsed.values.json)
      return json(mutationJson(result.task, result.warnings, expectRevision))
    process.stdout.write(
      nextGroup === undefined
        ? `Cleared ${result.task.id} group.\n`
        : `Changed ${result.task.id} group to ${nextGroup}.\n`,
    )
    return printWarnings(result.warnings)
  }

  if (parsed.values.profile) {
    if (parsed.values.profile !== 'light' && parsed.values.profile !== 'standard')
      fail('invalid_arguments', '--profile must be light or standard.')
    const combined = Boolean(
      parsed.values['plan-file'] ||
      parsed.values.feedback ||
      parsed.values.decision ||
      parsed.values.question ||
      parsed.values.answer ||
      parsed.values.artifact?.length ||
      parsed.values['remove-artifact']?.length ||
      hasBlock ||
      parsed.values.unblock ||
      parsed.values.provenance ||
      parsed.values['provenance-reason'],
    )
    if (combined)
      fail('invalid_arguments', '--profile must be saved as a standalone change.')
    const store = openTaskStoreV2(cwd)
    const result = changeTaskProfileV3(store, parsed.positionals[0], {
      expectRevision,
      actor,
      profile: parsed.values.profile as TaskProfile,
      reason: parsed.values['profile-reason'] ?? '',
      userRequestedNarrowing: Boolean(parsed.values['user-requested-narrowing']),
    })
    if (parsed.values.json)
      return json(mutationJson(result.task, result.warnings, expectRevision))
    process.stdout.write(
      `Changed ${result.task.id} profile to ${result.task.profile}.\n`,
    )
    return printWarnings(result.warnings)
  }
  if (parsed.values['profile-reason'] || parsed.values['user-requested-narrowing'])
    fail('invalid_arguments', '--profile-reason and narrowing require --profile.')

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
    'non-implementation-feedback': { type: 'string' },
    'authorization-file': { type: 'string' },
    'retrospective-file': { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.approve}
`)
  requirePositionals('approve', parsed.positionals, 1)
  if (parsed.values.reason && parsed.values.feedback)
    fail('invalid_arguments', '--reason and --feedback cannot be combined.')
  if (
    parsed.values['non-implementation-feedback'] !== undefined &&
    (parsed.values.reason ||
      parsed.values.feedback ||
      parsed.values['authorization-file'] ||
      parsed.values['retrospective-file'])
  )
    fail(
      'invalid_arguments',
      '--non-implementation-feedback cannot be combined with approval or implementation feedback inputs.',
    )
  if (parsed.values['authorization-file'] && parsed.values['retrospective-file'])
    fail(
      'invalid_arguments',
      '--authorization-file and --retrospective-file cannot be combined.',
    )
  if (
    parsed.values.reason &&
    (parsed.values['authorization-file'] || parsed.values['retrospective-file'])
  )
    fail('invalid_arguments', '--reason cannot be combined with structured work_basis.')
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const store = openTaskStoreV2(cwd)
  const authorization = parsed.values['authorization-file']
    ? readInputFile<ImplementationAuthorizationInput>(
        cwd,
        parsed.values['authorization-file'],
        '--authorization-file',
      )
    : undefined
  const retrospective = parsed.values['retrospective-file']
    ? readInputFile<RetrospectiveRecordInput>(
        cwd,
        parsed.values['retrospective-file'],
        '--retrospective-file',
      )
    : undefined
  const result = approveTaskV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    reason: parsed.values.reason,
    feedback: parsed.values.feedback,
    nonImplementationFeedback: parsed.values['non-implementation-feedback'],
    authorization,
    retrospective,
  })
  if (parsed.values.json)
    return json(mutationJson(result.task, result.warnings, expectRevision))
  const action =
    parsed.values['non-implementation-feedback'] !== undefined
      ? 'Recorded non-implementation feedback for'
      : 'Approved'
  process.stdout.write(
    `${action} ${result.task.id}: revision ${expectRevision} -> ${result.task.revision}\n`,
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
    'knowledge-impact-file': { type: 'string' },
    'knowledge-impact-none': { type: 'string' },
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
  if (
    parsed.values['knowledge-impact-file'] !== undefined &&
    parsed.values['knowledge-impact-none'] !== undefined
  )
    fail(
      'invalid_arguments',
      '--knowledge-impact-file and --knowledge-impact-none cannot be combined.',
    )
  if (
    parsed.values['knowledge-impact-none'] !== undefined &&
    !parsed.values['knowledge-impact-none'].trim()
  )
    fail('invalid_arguments', '--knowledge-impact-none must be non-empty.')
  const knowledgeImpact = parsed.values['knowledge-impact-file']
    ? readInputFile<KnowledgeImpact>(
        cwd,
        parsed.values['knowledge-impact-file'],
        '--knowledge-impact-file',
      )
    : parsed.values['knowledge-impact-none'] !== undefined
      ? { kind: 'none' as const, reason: parsed.values['knowledge-impact-none'].trim() }
      : undefined
  const store = openTaskStoreV2(cwd)
  const result = submitTaskV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    changes: parsed.values.changes,
    unverified: parsed.values.unverified,
    noVerify: Boolean(parsed.values['no-verify']),
    reason: parsed.values.reason,
    knowledgeImpact,
  })
  if (parsed.values.json)
    return json(mutationJson(result.task, result.warnings, expectRevision))
  process.stdout.write(`Submitted ${result.task.id} for review.\n`)
  printWarnings(result.warnings)
}

function runPatchSubmissionKnowledgeImpact(
  args: string[],
  cwd: string,
  actor: string,
) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    'knowledge-impact-file': { type: 'string' },
    reason: { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(
      `${commandUsage['patch-submission-knowledge-impact']}\n`,
    )
  requirePositionals(
    'patch-submission-knowledge-impact',
    parsed.positionals,
    1,
  )
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const knowledgeImpact = readInputFile<KnowledgeImpact>(
    cwd,
    parsed.values['knowledge-impact-file'],
    '--knowledge-impact-file',
  )
  const store = openTaskStoreV2(cwd)
  const result = patchSubmissionKnowledgeImpactV3(
    store,
    parsed.positionals[0],
    {
      expectRevision,
      actor,
      knowledgeImpact,
      reason: parsed.values.reason,
    },
  )
  if (parsed.values.json)
    return json(mutationJson(result.task, result.warnings, expectRevision))
  process.stdout.write(`Patched ${result.task.id} submission knowledge impact.\n`)
  printWarnings(result.warnings)
}

function runDowngradeV2(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    task: { type: 'string' },
    'expect-revision': { type: 'string' },
    'confirm-data-loss': { type: 'boolean' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage['downgrade-v2']}\n`)
  requirePositionals('downgrade-v2', parsed.positionals, 0)
  if (!parsed.values.task)
    fail('invalid_arguments', '--task is required.')
  if (!parsed.values['confirm-data-loss'])
    fail(
      'invalid_arguments',
      '--confirm-data-loss is required because v3-only fields and events move to backup.',
    )
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const store = openTaskStoreV2(cwd)
  const result = downgradeTaskV2(store, parsed.values.task, {
    expectRevision,
    actor,
  })
  if (parsed.values.json)
    return json({
      ...mutationJson(result.task, result.warnings, expectRevision),
      backup_path: result.backupPath,
    })
  process.stdout.write(
    `Downgraded ${result.task.id} to schema v2. Backup: ${result.backupPath}\n`,
  )
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
      archived: true,
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
      archived: true,
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
  injectHostActor()
  const actor = actorId()
  if (
    actorRequiredCommands.has(command) &&
    !args.includes('--help') &&
    !args.includes('-h')
  )
    assertWritableActor(actor)
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
      if (args[0] === 'pack') return runContextPack(args.slice(1), cwd, actor)
      return runContext(args, cwd, actor)
    case 'knowledge':
      return runKnowledge(args, cwd)
    case 'benchmark':
      return runBenchmark(args, cwd)
    case 'claim':
      return runClaim(args, cwd, actor)
    case 'takeover':
      return runTakeover(args, cwd, actor)
    case 'save':
      return runSave(args, cwd, actor)
    case 'approve':
      return runApprove(args, cwd, actor)
    case 'verify':
      return runVerify(args, cwd, actor)
    case 'submit':
      return runSubmit(args, cwd, actor)
    case 'patch-submission-knowledge-impact':
      return runPatchSubmissionKnowledgeImpact(args, cwd, actor)
    case 'downgrade-v2':
      return runDowngradeV2(args, cwd, actor)
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
