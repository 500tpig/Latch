import {
  assertSingleStdinInput,
  fail,
  json,
  mutationOptions,
  parseCommand,
  positiveInteger,
  printWarnings,
  readInputFile,
  validateBrief,
} from '../cli-support.js'
import {
  abandonTaskV2,
  doneTaskV2,
  patchSubmissionKnowledgeImpactV3,
  submitTaskV2,
} from '../core/progress.js'
import { openTaskStoreV2 } from '../core/task-store.js'
import { compactUnverifiedItems } from '../core/task-view/mutation.js'
import type {
  KnowledgeImpact,
  TaskCloseoutInput,
} from '../core/types.js'
import {
  currentWritableTask,
  mutationJson,
  requirePositionals,
} from './task-common.js'
import { commandUsage } from './usage.js'

export function runSubmit(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...mutationOptions(),
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
  validateBrief(parsed.values.json, parsed.values.brief)
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
  assertSingleStdinInput([
    ['--knowledge-impact-file', parsed.values['knowledge-impact-file']],
  ])
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
    return json(
      mutationJson(store, result.task, actor, result.warnings, expectRevision, {
        brief: Boolean(parsed.values.brief),
        briefDetails: {
          unverified_items: compactUnverifiedItems(
            result.task.submission?.unverified_items ?? [],
          ),
        },
      }),
    )
  process.stdout.write(`Submitted ${result.task.id} for review.\n`)
  printWarnings(result.warnings)
}

export function runPatchSubmissionKnowledgeImpact(
  args: string[],
  cwd: string,
  actor: string,
) {
  const parsed = parseCommand(args, {
    ...mutationOptions(),
    'expect-revision': { type: 'string' },
    'knowledge-impact-file': { type: 'string' },
    reason: { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(
      `${commandUsage['patch-submission-knowledge-impact']}\n`,
    )
  validateBrief(parsed.values.json, parsed.values.brief)
  requirePositionals(
    'patch-submission-knowledge-impact',
    parsed.positionals,
    1,
  )
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  assertSingleStdinInput([
    ['--knowledge-impact-file', parsed.values['knowledge-impact-file']],
  ])
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
    return json(
      mutationJson(store, result.task, actor, result.warnings, expectRevision, {
        brief: Boolean(parsed.values.brief),
      }),
    )
  process.stdout.write(`Patched ${result.task.id} submission knowledge impact.\n`)
  printWarnings(result.warnings)
}

export function runDone(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...mutationOptions(),
    'expect-revision': { type: 'string' },
    'closeout-file': { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.done}\n`)
  validateBrief(parsed.values.json, parsed.values.brief)
  requirePositionals('done', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  assertSingleStdinInput([
    ['--closeout-file', parsed.values['closeout-file']],
  ])
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
      ...mutationJson(
        store,
        result.task,
        actor,
        result.warnings,
        expectRevision,
        {
          archived: true,
          brief: Boolean(parsed.values.brief),
        },
      ),
      outcome: result.task.outcome,
      archived: true,
    })
  process.stdout.write(`Archived ${result.task.id} as done.\n`)
  printWarnings(result.warnings)
}

export function runAbandon(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...mutationOptions(),
    'expect-revision': { type: 'string' },
    reason: { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${commandUsage.abandon}\n`)
  validateBrief(parsed.values.json, parsed.values.brief)
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
      ...mutationJson(
        store,
        result.task,
        actor,
        result.warnings,
        expectRevision,
        {
          archived: true,
          brief: Boolean(parsed.values.brief),
        },
      ),
      outcome: result.task.outcome,
      archived: true,
    })
  process.stdout.write(`Archived ${result.task.id} as abandoned.\n`)
  printWarnings(result.warnings)
}
