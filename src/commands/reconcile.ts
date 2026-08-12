import {
  commonOptions,
  json,
  parseCommand,
  positiveInteger,
  printWarnings,
} from '../cli-support.js'
import { reconcileWorkspaceViolations } from '../core/progress.js'
import { openTaskStoreV2 } from '../core/task-store.js'
import {
  currentWritableTask,
  mutationJson,
  requirePositionals,
} from './task-common.js'
import { commandUsage } from './usage.js'

const sampleLimit = 8

function boundedIds(ids: string[]) {
  const sorted = [...ids].sort()
  return {
    total: sorted.length,
    sample_limit: sampleLimit,
    sample: sorted.slice(0, sampleLimit),
    truncated: sorted.length > sampleLimit,
  }
}

function humanIds(ids: ReturnType<typeof boundedIds>) {
  if (ids.sample.length === 0) return 'none'
  return `${ids.sample.join(', ')}${ids.truncated ? ', ...' : ''}`
}

export function runReconcile(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage.reconcile}\n`)
  requirePositionals('reconcile', parsed.positionals, 1)
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  const store = openTaskStoreV2(cwd)
  currentWritableTask(store, parsed.positionals[0])
  const result = reconcileWorkspaceViolations(store, parsed.positionals[0], {
    expectRevision,
    actor,
  })
  const resolved = boundedIds(result.resolvedIds)
  const remaining = boundedIds(result.remainingIds)
  if (parsed.values.json)
    return json({
      ...mutationJson(
        store,
        result.task,
        actor,
        result.warnings,
        expectRevision,
      ),
      resolved_count: resolved.total,
      remaining_count: remaining.total,
      resolved_ids: resolved,
      remaining_ids: remaining,
    })
  process.stdout.write(
    `Reconciled ${result.task.id}: ${resolved.total} restored, ${remaining.total} remaining; ` +
      `revision ${expectRevision} -> ${result.task.revision}.\n` +
      `Resolved IDs: ${humanIds(resolved)}.\n` +
      `Remaining IDs: ${humanIds(remaining)}.\n`,
  )
  printWarnings(result.warnings)
}
