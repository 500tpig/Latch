#!/usr/bin/env node
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import {
  CliV2Error,
  commonOptions,
  fail,
  json,
  parseCommand,
  positiveInteger,
  printWarnings,
  readInputFile,
  validateBrief,
} from './cli-support.js'
import {
  benchmarkUsage,
  runBenchmark,
} from './commands/benchmark.js'
import {
  contextPackUsage,
  contextUsage,
  runContext,
  runContextPack,
} from './commands/context.js'
import {
  knowledgeUsage,
  runKnowledge,
} from './commands/knowledge.js'
import {
  recordJsonEnvelope,
  recordUsage,
  runRecord,
} from './commands/record.js'
import {
  actorId,
  assertWritableActor,
} from './core/actor.js'
import { injectHostActor } from './host-adapter.js'
import {
  NotInitializedError,
} from './core/paths.js'
import {
  normalizeTaskPlanInput,
  planTemplate,
} from './core/plan-schema.js'
import {
  linkProjectRecordTaskV1,
  openRecordStoreV1,
  showProjectRecordV1,
} from './core/record-store.js'
import {
  jsonEnvelopeV2,
  listHumanV2,
  listJsonV2,
} from './core/task-view.js'
import {
  assertGroupIdV3,
  claimTaskV3,
  createTaskV5,
  DowngradeTaskV2Error,
  downgradeTaskV2,
  initTaskStoreV2,
  openTaskStoreV2,
  readContextTaskV2,
  selectCurrentTaskV2,
  takeoverTaskV3,
  upgradeTaskV4,
  updateTaskV2,
  updateTaskV4,
} from './core/task-store.js'
import type {
  ImplementationAuthorizationInput,
  KnowledgeImpact,
  RetrospectiveRecordInput,
  TaskArtifact,
  TaskCloseoutInput,
  TaskProfile,
  TaskProvenance,
} from './core/types.js'
import {
  abandonTaskV2,
  approveTaskV2,
  changeTaskProfileV3,
  doneTaskV2,
  patchSubmissionKnowledgeImpactV3,
  reopenReviewTaskV3,
  submitTaskV2,
  verifyAllTasksV2,
  verifyTaskV2,
} from './core/progress.js'
import { now, readJsonFile } from './core/utils.js'

const usage = `Usage: latch <command> [options]

Commands:
  init
  checkpoint <title> --plan-file <path> [--profile <light|standard>] [--authorize-request <reason> | --authorization-file <path> | --retrospective-file <path>] [--source-record <id> --source-record-revision <revision>]
  checkpoint --print-plan-template <light|standard>
  use <task-id>
  list [--group <id> [--include-archive]] [--json] [--brief]
  context [task-id] [--json] [--brief | --status | --since-revision <revision>] [--history <timeline|events|both>]
  context pack --input-file <path>
  record <create|list|show|edit|archive|restore|delete> [options]
  knowledge <fingerprint|check> [options]
  benchmark context [options]
  takeover <task-id> --expect-revision <revision> --reason <text>
  save <task-id> --expect-revision <revision> [changes]
  approve <task-id> --expect-revision <revision> [--reason <text> | --authorization-file <path> | --retrospective-file <path>] [--feedback <text> | --non-implementation-feedback <text>]
  verify <task-id> --expect-revision <revision> --name <name> [--diagnostic] [-- command...]
  verify-all <task-id> --expect-revision <revision>
  reopen-review <task-id> --expect-revision <revision> --reason <text>
  artifact <add|remove> <task-id> --expect-revision <revision> <kind:path>...
  submit <task-id> --expect-revision <revision> --changes <text> [--unverified-item <summary>...] [--knowledge-impact-none <reason> | --knowledge-impact-file <path>] [--no-verify --reason <text>] [--verbose-warnings]
  patch-submission-knowledge-impact <task-id> --expect-revision <revision> --knowledge-impact-file <path> [--reason <text>]
  done <task-id> --expect-revision <revision> [--closeout-file <path>]
  abandon <task-id> --expect-revision <revision> --reason <text>`

const commandUsage: Record<string, string> = {
  init: 'Usage: latch init [--json]',
  checkpoint:
    'Usage: latch checkpoint <title> --plan-file <path> [--profile <light|standard>] [--authorize-request <reason> | --authorization-file <path> | --retrospective-file <path>] [--source-record <id> --source-record-revision <revision>] [--artifact <kind>:<path>] [--json]\n       latch checkpoint --print-plan-template <light|standard>',
  use: 'Usage: latch use <task-id> [--json]',
  list:
    'Usage: latch list [--group <id> [--include-archive]] [--json] [--brief]',
  context:
    contextUsage,
  'context-pack': contextPackUsage,
  record: recordUsage,
  knowledge: knowledgeUsage,
  benchmark: benchmarkUsage,
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
  'verify-all':
    'Usage: latch verify-all <task-id> --expect-revision <revision> [--json]',
  'reopen-review':
    'Usage: latch reopen-review <task-id> --expect-revision <revision> --reason <text> [--json]',
  artifact:
    'Usage: latch artifact <add|remove> <task-id> --expect-revision <revision> <kind:path>... [--json]',
  submit:
    'Usage: latch submit <task-id> --expect-revision <revision> --changes <text> [--unverified-item <summary>...] [--knowledge-impact-none <reason> | --knowledge-impact-file <path>] [--no-verify --reason <text>] [--verbose-warnings] [--json]',
  'patch-submission-knowledge-impact':
    'Usage: latch patch-submission-knowledge-impact <task-id> --expect-revision <revision> --knowledge-impact-file <path> [--reason <text>] [--json]',
  'upgrade-v4':
    'Usage: latch upgrade-v4 --task <task-id> --expect-revision <revision> [--recover-writer --reason <text>] [--json]',
  'downgrade-v2':
    'Usage: latch downgrade-v2 --task <task-id> --expect-revision <revision> --confirm-data-loss [--json]',
  done:
    'Usage: latch done <task-id> --expect-revision <revision> [--closeout-file <path>] [--json]',
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
  'verify-all',
  'reopen-review',
  'artifact',
  'submit',
  'patch-submission-knowledge-impact',
  'upgrade-v4',
  'downgrade-v2',
  'done',
  'abandon',
])

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

function artifactChanges(
  currentArtifacts: TaskArtifact[],
  addedValues: string[],
  removedValues: string[],
) {
  const addedArtifacts = addedValues.map(artifact)
  const removedArtifacts = removedValues.map(artifact)
  const removedKeys = new Set(removedArtifacts.map(artifactKey))
  const actuallyRemoved = currentArtifacts.filter((value) =>
    removedKeys.has(artifactKey(value)),
  )
  const nextArtifacts = currentArtifacts.filter(
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
  return {
    nextArtifacts,
    actuallyAdded,
    actuallyRemoved,
    changed: JSON.stringify(nextArtifacts) !== JSON.stringify(currentArtifacts),
  }
}

function readPlan(
  cwd: string,
  planFile: string | undefined,
  profile: TaskProfile = 'standard',
) {
  if (!planFile) fail('invalid_arguments', '--plan-file is required.')
  const plan = readJsonFile<unknown>(resolve(cwd, planFile))
  return normalizeTaskPlanInput(plan, profile, planFile)
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
    'print-plan-template': { type: 'string' },
    profile: { type: 'string' },
    'authorize-request': { type: 'string' },
    'scope-summary': { type: 'string' },
    'scope-path': { type: 'string', multiple: true },
    'authorization-file': { type: 'string' },
    'retrospective-file': { type: 'string' },
    'source-record': { type: 'string' },
    'source-record-revision': { type: 'string' },
    artifact: { type: 'string', multiple: true },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.checkpoint}\n`)
  const templateProfile = parsed.values['print-plan-template']
  if (templateProfile !== undefined) {
    if (templateProfile !== 'light' && templateProfile !== 'standard')
      fail(
        'invalid_arguments',
        '--print-plan-template must be light or standard.',
      )
    const incompatibleOptions = [
      ['--plan-file', parsed.values['plan-file']],
      ['--profile', parsed.values.profile],
      ['--authorize-request', parsed.values['authorize-request']],
      ['--scope-summary', parsed.values['scope-summary']],
      ['--scope-path', parsed.values['scope-path']],
      ['--authorization-file', parsed.values['authorization-file']],
      ['--retrospective-file', parsed.values['retrospective-file']],
      ['--source-record', parsed.values['source-record']],
      ['--source-record-revision', parsed.values['source-record-revision']],
      ['--artifact', parsed.values.artifact],
    ]
      .filter(([, value]) => value !== undefined)
      .map(([option]) => option)
    if (parsed.positionals.length > 0 || incompatibleOptions.length > 0)
      fail(
        'invalid_arguments',
        '--print-plan-template cannot be combined with a title or task creation options' +
          (incompatibleOptions.length > 0
            ? `: ${incompatibleOptions.join(', ')}.`
            : '.'),
      )
    return json(planTemplate(templateProfile))
  }
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
  if (
    Boolean(parsed.values['source-record']) !==
    Boolean(parsed.values['source-record-revision'])
  )
    fail(
      'invalid_arguments',
      '--source-record and --source-record-revision must be provided together.',
    )
  const profile = hasInlineAuthorization || hasAuthorizationFile
    ? 'light'
    : (parsed.values.profile ?? 'standard') as TaskProfile
  const plan = readPlan(cwd, parsed.values['plan-file'], profile)
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
  const sourceRecord = parsed.values['source-record']
    ? showProjectRecordV1(
        openRecordStoreV1(cwd),
        parsed.values['source-record'],
      )
    : undefined
  const sourceRecordRevision = parsed.values['source-record-revision']
    ? positiveInteger(
        parsed.values['source-record-revision'],
        '--source-record-revision',
      )
    : undefined
  if (sourceRecord?.record.status === 'archived')
    fail(
      'invalid_arguments',
      `Archived Record must be restored before creating a task: ${sourceRecord.record.id}`,
    )
  if (
    sourceRecord &&
    sourceRecordRevision !== undefined &&
    sourceRecord.record.revision !== sourceRecordRevision
  )
    fail(
      'revision_conflict',
      `Record revision conflict for ${sourceRecord.record.id}: expected ${sourceRecordRevision}, current ${sourceRecord.record.revision}.`,
    )
  const store = openTaskStoreV2(cwd)
  const result = createTaskV5(
    store,
    {
      title: parsed.positionals[0],
      plan,
      artifacts,
      profile,
      ...(sourceRecord
        ? {
            sourceRecord: {
              record_id: sourceRecord.record.id,
              revision: sourceRecord.record.revision,
              body_sha256: sourceRecord.record.body_sha256,
            },
          }
        : {}),
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
  if (sourceRecord) {
    try {
      const linked = linkProjectRecordTaskV1(
        openRecordStoreV1(cwd),
        sourceRecord.record.id,
        sourceRecord.record.revision,
        result.task.id,
      )
      result.warnings.push(...linked.warnings)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.warnings.push(
        `Task ${result.task.id} was created from Record ${sourceRecord.record.id}, but the backlink was not saved: ${message}`,
      )
    }
  }
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

function currentWritableTask(
  store: ReturnType<typeof openTaskStoreV2>,
  id: string,
) {
  const task = readContextTaskV2(store, id).task
  if (task.schema_version !== 5)
    fail(
      'writer_version_mismatch',
      `Candidate CLI 0.5.0 only mutates schema_version 5 tasks; the current Latch runner treats task ${task.id} as historical read-only and requires its matching runner for schema_version ${task.schema_version}.`,
    )
  return task
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
  currentWritableTask(store, parsed.positionals[0])
  const result = claimTaskV3(store, parsed.positionals[0], {
    expectRevision,
    actor,
    reason: parsed.values.reason,
  })
  if (parsed.values.json)
    return json(mutationJson(result.task, result.warnings, expectRevision))
  process.stdout.write(
    `Claimed ${result.task.id} for ${actor} and upgraded it to schema v4.\n`,
  )
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
  currentWritableTask(store, parsed.positionals[0])
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
    const current = currentWritableTask(store, parsed.positionals[0])
    const previousProvenance = current.provenance ?? 'clean'
    if (previousProvenance === selectedProvenance)
      fail('invalid_arguments', 'save did not change provenance.')
    const reason = parsed.values['provenance-reason']
    const result = updateTaskV4(store, current.id, {
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
    const current = currentWritableTask(store, parsed.positionals[0])
    const nextGroup = clearGroup ? undefined : selectedGroup
    if (current.group_id === nextGroup)
      fail('invalid_arguments', 'save did not change group_id.')
    const result = updateTaskV4(store, current.id, {
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
    currentWritableTask(store, parsed.positionals[0])
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
  const current = currentWritableTask(store, parsed.positionals[0])
  const nextPlan = parsed.values['plan-file']
    ? readPlan(cwd, parsed.values['plan-file'])
    : undefined
  const planChanged =
    nextPlan !== undefined && JSON.stringify(nextPlan) !== JSON.stringify(current.plan)
  if (parsed.values.feedback && !planChanged)
    fail('invalid_arguments', '--feedback requires an effective --plan-file change.')

  const artifactUpdate = artifactChanges(
    current.artifacts,
    parsed.values.artifact ?? [],
    parsed.values['remove-artifact'] ?? [],
  )
  const {
    nextArtifacts,
    actuallyAdded,
    actuallyRemoved,
    changed: artifactsChanged,
  } = artifactUpdate

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
  currentWritableTask(store, parsed.positionals[0])
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
  currentWritableTask(store, parsed.positionals[0])
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

function runVerifyAll(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage['verify-all']}\n`)
  requirePositionals('verify-all', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const store = openTaskStoreV2(cwd)
  currentWritableTask(store, parsed.positionals[0])
  const result = verifyAllTasksV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
  })
  const executed = result.executions.map(({ verification, revision }) => ({
    name: verification.name,
    status: verification.status,
    revision,
    ...(verification.failure_reason
      ? { failure_reason: verification.failure_reason }
      : {}),
  }))
  if (parsed.values.json)
    json({
      ...mutationJson(result.task, result.warnings, expectRevision),
      executed,
      failed: result.failed?.name ?? null,
      stopped_reason: result.stoppedReason ?? null,
      stopped_gate: result.stoppedGate ?? null,
      remaining: result.remaining,
      proof_generation: result.task.workspace_proof?.generation ?? null,
      unresolved_violations:
        result.task.workspace_proof?.unresolved_violations.length ?? 0,
    })
  else {
    process.stdout.write(
      executed.length === 0
        ? `No pending gates for ${result.task.id}.\n`
        : `Verified ${result.task.id}: ${executed.map((item) => `${item.name}: ${item.status}`).join('; ')}\n`,
    )
    printWarnings(result.warnings)
  }
  if (result.failed || result.stoppedReason) process.exitCode = 1
}

function runReopenReview(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    reason: { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage['reopen-review']}\n`)
  requirePositionals('reopen-review', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  if (!parsed.values.reason?.trim())
    fail('invalid_arguments', '--reason is required.')
  const store = openTaskStoreV2(cwd)
  currentWritableTask(store, parsed.positionals[0])
  const result = reopenReviewTaskV3(store, parsed.positionals[0], {
    expectRevision,
    actor,
    reason: parsed.values.reason,
  })
  if (parsed.values.json)
    return json(mutationJson(result.task, result.warnings, expectRevision))
  process.stdout.write(
    `Reopened ${result.task.id} for implementation at work revision ${result.task.work_revision}.\n`,
  )
  printWarnings(result.warnings)
}

function runArtifact(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage.artifact}\n`)
  requirePositionals('artifact', parsed.positionals, [3, Number.MAX_SAFE_INTEGER])
  const [action, taskId, ...values] = parsed.positionals
  if (action !== 'add' && action !== 'remove')
    fail('invalid_arguments', commandUsage.artifact)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const store = openTaskStoreV2(cwd)
  const current = currentWritableTask(store, taskId)
  const update = artifactChanges(
    current.artifacts,
    action === 'add' ? values : [],
    action === 'remove' ? values : [],
  )
  if (!update.changed)
    fail('invalid_arguments', 'artifact did not contain any effective change.')
  const result = updateTaskV2(store, current.id, {
    expectRevision,
    actor,
    events: [{
      type: 'artifact_updated',
      fields: {
        added: update.actuallyAdded.map(artifactLabel),
        removed: update.actuallyRemoved.map(artifactLabel),
      },
    }],
    update(task) {
      task.artifacts = structuredClone(update.nextArtifacts)
    },
  })
  if (parsed.values.json)
    return json(mutationJson(result.task, result.warnings, expectRevision))
  process.stdout.write(
    `Updated ${result.task.id} artifacts: revision ${expectRevision} -> ${result.task.revision}\n`,
  )
  printWarnings(result.warnings)
}

function runSubmit(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    changes: { type: 'string' },
    'unverified-item': { type: 'string', multiple: true },
    // S3/S4 candidate fixtures still exercise the pre-release spelling. It is
    // intentionally absent from current help and documentation.
    unverified: { type: 'string', multiple: true },
    'no-verify': { type: 'boolean' },
    reason: { type: 'string' },
    'knowledge-impact-file': { type: 'string' },
    'knowledge-impact-none': { type: 'string' },
    'verbose-warnings': { type: 'boolean' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.submit}\n`)
  requirePositionals('submit', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  if (!parsed.values.changes) fail('invalid_arguments', '--changes is required.')
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
  currentWritableTask(store, parsed.positionals[0])
  const result = submitTaskV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    changes: parsed.values.changes,
    unverifiedItems: [
      ...(parsed.values['unverified-item'] ?? []),
      ...(parsed.values.unverified ?? []),
    ],
    noVerify: Boolean(parsed.values['no-verify']),
    reason: parsed.values.reason,
    knowledgeImpact,
    verboseWarnings: Boolean(parsed.values['verbose-warnings']),
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
  currentWritableTask(store, parsed.positionals[0])
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
      '--confirm-data-loss is required because schema 3/4-only fields and events move to backup.',
    )
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const store = openTaskStoreV2(cwd)
  currentWritableTask(store, parsed.values.task)
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

function runUpgradeV4(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    task: { type: 'string' },
    'expect-revision': { type: 'string' },
    'recover-writer': { type: 'boolean' },
    reason: { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage['upgrade-v4']}\n`)
  requirePositionals('upgrade-v4', parsed.positionals, 0)
  if (!parsed.values.task)
    fail('invalid_arguments', '--task is required.')
  const recoverWriter = parsed.values['recover-writer'] === true
  if (recoverWriter && parsed.values.reason === undefined)
    fail('invalid_arguments', '--reason is required with --recover-writer.')
  if (!recoverWriter && parsed.values.reason !== undefined)
    fail('invalid_arguments', '--reason requires --recover-writer.')
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const store = openTaskStoreV2(cwd)
  currentWritableTask(store, parsed.values.task)
  const result = upgradeTaskV4(store, parsed.values.task, {
    expectRevision,
    actor,
    recoverWriter,
    reason: parsed.values.reason,
  })
  if (parsed.values.json)
    return json({
      ...mutationJson(result.task, result.warnings, expectRevision),
      task_schema_version: result.task.schema_version,
      primary_writer: result.task.primary_writer,
      writer_recovered: recoverWriter,
    })
  if (recoverWriter) {
    process.stdout.write(
      `Upgraded ${result.task.id} to schema v4 and recovered writer ownership as ${result.task.primary_writer}.\n`,
    )
    return printWarnings(result.warnings)
  }
  process.stdout.write(
    `Upgraded ${result.task.id} to schema v4; minimum writer is 0.4.0.\n`,
  )
  printWarnings(result.warnings)
}

function runDone(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    'closeout-file': { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.done}\n`)
  requirePositionals('done', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const store = openTaskStoreV2(cwd)
  currentWritableTask(store, parsed.positionals[0])
  const closeout = parsed.values['closeout-file']
    ? readInputFile<TaskCloseoutInput>(
        cwd,
        parsed.values['closeout-file'],
        '--closeout-file',
      )
    : undefined
  const result = doneTaskV2(store, parsed.positionals[0], {
    expectRevision,
    actor,
    closeout,
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
  currentWritableTask(store, parsed.positionals[0])
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
  const printsCheckpointTemplate =
    command === 'checkpoint' &&
    args.some(
      (arg) =>
        arg === '--print-plan-template' ||
        arg.startsWith('--print-plan-template='),
    )
  if (
    actorRequiredCommands.has(command) &&
    !args.includes('--help') &&
    !args.includes('-h') &&
    !printsCheckpointTemplate
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
    case 'record':
      return runRecord(args, cwd)
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
    case 'verify-all':
      return runVerifyAll(args, cwd, actor)
    case 'reopen-review':
      return runReopenReview(args, cwd, actor)
    case 'artifact':
      return runArtifact(args, cwd, actor)
    case 'submit':
      return runSubmit(args, cwd, actor)
    case 'patch-submission-knowledge-impact':
      return runPatchSubmissionKnowledgeImpact(args, cwd, actor)
    case 'upgrade-v4':
      return runUpgradeV4(args, cwd, actor)
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
  const code =
    error instanceof CliV2Error || error instanceof NotInitializedError
      ? error.code
      : 'command_failed'
  if (process.argv.includes('--json'))
    process.stderr.write(
      `${JSON.stringify({
        ...(process.argv[2] === 'record' ? recordJsonEnvelope() : jsonEnvelopeV2()),
        ...(error instanceof DowngradeTaskV2Error
          ? {
              backup_path: error.backupPath,
              warnings: error.warnings,
            }
          : {}),
        error: { code, message },
      }, null, 2)}\n`,
    )
  else process.stderr.write(`${message}\n`)
  process.exitCode = 1
}
