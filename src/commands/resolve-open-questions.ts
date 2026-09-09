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
  PlanDeltaError,
  resolveOpenQuestions,
} from '../core/progress.js'
import { openTaskStoreV2 } from '../core/task-store.js'
import type { ImplementationAuthorizationInput } from '../core/types.js'
import { compactResolvedQuestions } from '../core/task-view/mutation.js'
import { mutationJson, requirePositionals } from './task-common.js'
import { commandUsage } from './usage.js'

function readStructuredInput<T>(
  cwd: string,
  path: string | undefined,
  option: string,
) {
  try {
    return readInputFile<T>(cwd, path, option)
  } catch (error) {
    fail('invalid_arguments', error instanceof Error ? error.message : String(error))
  }
}

export function runResolveOpenQuestions(
  args: string[],
  cwd: string,
  actor: string,
) {
  const parsed = parseCommand(args, {
    ...mutationOptions(),
    'expect-revision': { type: 'string' },
    'answers-file': { type: 'string' },
    'authorization-file': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage['resolve-open-questions']}\n`)
  validateBrief(parsed.values.json, parsed.values.brief)
  requirePositionals('resolve-open-questions', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  assertSingleStdinInput([
    ['--answers-file', parsed.values['answers-file']],
    ['--authorization-file', parsed.values['authorization-file']],
  ])
  const answers = readStructuredInput<unknown>(
    cwd,
    parsed.values['answers-file'],
    '--answers-file',
  )
  const authorization = parsed.values['authorization-file'] !== undefined
    ? readStructuredInput<ImplementationAuthorizationInput>(
        cwd,
        parsed.values['authorization-file'],
        '--authorization-file',
      )
    : undefined
  const store = openTaskStoreV2(cwd)
  let result: ReturnType<typeof resolveOpenQuestions>
  try {
    result = resolveOpenQuestions(store, parsed.positionals[0], {
      expectRevision,
      actor,
      answers,
      authorization,
    })
  } catch (error) {
    if (error instanceof PlanDeltaError) fail(error.code, error.message)
    throw error
  }

  if (parsed.values.json)
    return json(
      mutationJson(
        store,
        result.task,
        actor,
        result.warnings,
        expectRevision,
        {
          brief: Boolean(parsed.values.brief),
          details: {
            plan_revision: result.task.plan_revision,
            work_revision: result.task.work_revision,
            authorization_applied: result.authorizationApplied,
            resolved_questions: result.resolvedQuestions,
          },
          briefDetails: {
            plan_revision: result.task.plan_revision,
            work_revision: result.task.work_revision,
            authorization_applied: result.authorizationApplied,
            resolved_questions: compactResolvedQuestions(result.resolvedQuestions),
          },
        },
      ),
    )

  process.stdout.write(
    `Resolved ${result.resolvedQuestions.length} open question(s) for ${result.task.id}.\n`,
  )
  process.stdout.write(
    result.authorizationApplied
      ? `Lifecycle: plan revision ${result.previousPlanRevision} -> ${result.task.plan_revision}; work revision ${result.previousWorkRevision} -> ${result.task.work_revision}; task revision ${expectRevision} -> ${result.task.revision}; phase dev; authorization applied.\n`
      : `Lifecycle: plan revision ${result.previousPlanRevision} -> ${result.task.plan_revision}; task revision ${expectRevision} -> ${result.task.revision}; phase plan; authorization not-applied.\n`,
  )
  printWarnings(result.warnings)
}
