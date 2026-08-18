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
  updateVerificationCommand,
} from '../core/progress.js'
import { openTaskStoreV2 } from '../core/task-store.js'
import type { ImplementationAuthorizationInput } from '../core/types.js'
import { compactMutationStrings } from '../core/task-view/mutation.js'
import { mutationJson } from './task-common.js'
import { commandUsage } from './usage.js'

function splitCommandArgs(args: string[]) {
  const separator = args.indexOf('--')
  if (separator === -1) {
    return {
      optionArgs: args,
      command: [] as string[],
      hasSeparator: false,
    }
  }
  return {
    optionArgs: args.slice(0, separator),
    command: args.slice(separator + 1),
    hasSeparator: true,
  }
}

function renderArgv(command: string[]) {
  return command.map((arg) => JSON.stringify(arg)).join(' ')
}

export function runUpdateVerificationCommand(
  args: string[],
  cwd: string,
  actor: string,
) {
  const { optionArgs, command, hasSeparator } = splitCommandArgs(args)
  const parsed = parseCommand(optionArgs, {
    ...mutationOptions(),
    'expect-revision': { type: 'string' },
    name: { type: 'string' },
    'authorization-file': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(
      `${commandUsage['update-verification-command']}\n`,
    )
  validateBrief(parsed.values.json, parsed.values.brief)
  if (parsed.positionals.length === 0)
    fail('invalid_arguments', commandUsage['update-verification-command'])
  if (parsed.positionals.length > 1)
    fail(
      'invalid_arguments',
      'update-verification-command command argv must follow --.',
    )
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  if (!parsed.values.name)
    fail('invalid_arguments', '--name is required.')
  if (!hasSeparator || command.length === 0)
    fail(
      'invalid_arguments',
      'update-verification-command requires a non-empty command after --.',
    )
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
  let result: ReturnType<typeof updateVerificationCommand>
  try {
    result = updateVerificationCommand(store, parsed.positionals[0], {
      expectRevision,
      actor,
      name: parsed.values.name,
      command,
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
            verification: {
              name: result.gateName,
              kind: 'gate',
              previous_command: result.previousCommand,
              command: result.command,
            },
          },
          briefDetails: {
            plan_revision: result.task.plan_revision,
            work_revision: result.task.work_revision,
            authorization_applied: result.authorizationApplied,
            verification: {
              name: result.gateName,
              kind: 'gate',
              command: compactMutationStrings(result.command),
            },
          },
        },
      ),
    )

  process.stdout.write(
    `Updated verification command for ${result.task.id} gate ${result.gateName}: ${renderArgv(result.command)}.\n`,
  )
  process.stdout.write(
    result.authorizationApplied
      ? `Lifecycle: plan revision ${result.previousPlanRevision} -> ${result.task.plan_revision}; work revision ${result.previousWorkRevision} -> ${result.task.work_revision}; task revision ${expectRevision} -> ${result.task.revision}; phase dev; authorization applied.\n`
      : `Lifecycle: plan revision ${result.previousPlanRevision} -> ${result.task.plan_revision}; task revision ${expectRevision} -> ${result.task.revision}; phase plan; authorization not-applied.\n`,
  )
  printWarnings(result.warnings)
}
