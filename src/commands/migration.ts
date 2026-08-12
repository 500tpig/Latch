import {
  commonOptions,
  fail,
  json,
  parseCommand,
  positiveInteger,
  printWarnings,
} from '../cli-support.js'
import {
  downgradeTaskV2,
  openTaskStoreV2,
  upgradeTaskV4,
} from '../core/task-store.js'
import {
  currentWritableTask,
  mutationJson,
  requirePositionals,
} from './task-common.js'
import { commandUsage } from './usage.js'

export function runDowngradeV2(args: string[], cwd: string, actor: string) {
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
      ...mutationJson(store, result.task, actor, result.warnings, expectRevision),
      backup_path: result.backupPath,
    })
  process.stdout.write(
    `Downgraded ${result.task.id} to schema v2. Backup: ${result.backupPath}\n`,
  )
  printWarnings(result.warnings)
}

export function runUpgradeV4(args: string[], cwd: string, actor: string) {
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
      ...mutationJson(store, result.task, actor, result.warnings, expectRevision),
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
