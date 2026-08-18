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
  appendWorkspaceScope,
  PlanDeltaError,
} from '../core/progress.js'
import { openTaskStoreV2 } from '../core/task-store.js'
import type { ImplementationAuthorizationInput } from '../core/types.js'
import { compactMutationStrings } from '../core/task-view/mutation.js'
import { mutationJson, requirePositionals } from './task-common.js'
import { commandUsage } from './usage.js'

export function runAppendScope(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...mutationOptions(),
    'expect-revision': { type: 'string' },
    path: { type: 'string', multiple: true },
    'authorization-file': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage['append-scope']}\n`)
  validateBrief(parsed.values.json, parsed.values.brief)
  requirePositionals('append-scope', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const paths = parsed.values.path ?? []
  if (paths.length === 0)
    fail('invalid_arguments', '--path is required at least once.')
  assertSingleStdinInput([
    ['--authorization-file', parsed.values['authorization-file']],
  ])
  const authorization = parsed.values['authorization-file']
    ? readInputFile<ImplementationAuthorizationInput>(
        cwd,
        parsed.values['authorization-file'],
        '--authorization-file',
      )
    : undefined
  const store = openTaskStoreV2(cwd)
  let result: ReturnType<typeof appendWorkspaceScope>
  try {
    result = appendWorkspaceScope(store, parsed.positionals[0], {
      expectRevision,
      actor,
      paths,
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
            appended_paths: result.appendedPaths,
          },
          briefDetails: {
            plan_revision: result.task.plan_revision,
            work_revision: result.task.work_revision,
            authorization_applied: result.authorizationApplied,
            appended_paths: compactMutationStrings(result.appendedPaths),
          },
        },
      ),
    )

  process.stdout.write(
    `Appended ${result.appendedPaths.length} workspace scope path(s) to ${result.task.id}: ${result.appendedPaths.join(', ')}.\n`,
  )
  process.stdout.write(
    result.authorizationApplied
      ? `Lifecycle: plan revision ${result.previousPlanRevision} -> ${result.task.plan_revision}; work revision ${result.previousWorkRevision} -> ${result.task.work_revision}; task revision ${expectRevision} -> ${result.task.revision}; phase dev; authorization applied.\n`
      : `Lifecycle: plan revision ${result.previousPlanRevision} -> ${result.task.plan_revision}; task revision ${expectRevision} -> ${result.task.revision}; phase plan; authorization not-applied.\n`,
  )
  printWarnings(result.warnings)
}
