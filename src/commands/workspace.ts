import {
  assertSingleStdinInput,
  commonOptions,
  fail,
  json,
  parseCommand,
  positiveInteger,
  printWarnings,
  readInputFile,
  validateBrief,
} from '../cli-support.js'
import { planTemplate } from '../core/plan-schema.js'
import {
  linkProjectRecordTaskV1,
  openRecordStoreV1,
  showProjectRecordV1,
} from '../core/record-store.js'
import {
  jsonEnvelopeV3,
  listHumanV2,
  listJsonV2,
} from '../core/task-view.js'
import {
  createTaskV5,
  initTaskStoreV2,
  openTaskStoreV2,
  selectCurrentTaskV2,
} from '../core/task-store.js'
import type {
  ImplementationAuthorizationInput,
  RetrospectiveRecordInput,
  TaskProfile,
} from '../core/types.js'
import {
  artifact,
  groupId,
  mutationJson,
  readPlan,
  requirePositionals,
} from './task-common.js'
import { commandUsage } from './usage.js'

export function runInit(args: string[], cwd: string) {
  const parsed = parseCommand(args, commonOptions())
  requirePositionals('init', parsed.positionals, 0)
  if (parsed.values.help) return process.stdout.write(`${commandUsage.init}\n`)
  const store = initTaskStoreV2(cwd)
  if (parsed.values.json)
    return json({ ...jsonEnvelopeV3(), workspace_root: store.paths.workspaceRoot })
  process.stdout.write(`Initialized Latch v2 at ${store.paths.workspaceRoot}\n`)
}

export function runCheckpoint(args: string[], cwd: string, actor: string) {
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
  assertSingleStdinInput([
    ['--plan-file', parsed.values['plan-file']],
    ['--authorization-file', parsed.values['authorization-file']],
    ['--retrospective-file', parsed.values['retrospective-file']],
  ])
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
  if (parsed.values.json)
    return json(mutationJson(store, result.task, actor, result.warnings))
  process.stdout.write(`Created ${result.task.id} at revision ${result.task.revision}\n`)
  printWarnings(result.warnings)
}

export function runUse(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, commonOptions())
  if (parsed.values.help) return process.stdout.write(`${commandUsage.use}\n`)
  requirePositionals('use', parsed.positionals, 1)
  const store = openTaskStoreV2(cwd)
  const taskId = selectCurrentTaskV2(store, actor, parsed.positionals[0])
  if (parsed.values.json)
    return json({ ...jsonEnvelopeV3(), task_id: taskId, warnings: [] })
  process.stdout.write(`Current task: ${taskId}\n`)
}

export function runList(args: string[], cwd: string, actor: string) {
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
