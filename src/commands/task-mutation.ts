import {
  commonOptions,
  fail,
  json,
  mutationOptions,
  parseCommand,
  positiveInteger,
  printWarnings,
  validateBrief,
} from '../cli-support.js'
import { changeTaskProfileV3 } from '../core/progress.js'
import {
  claimTaskV3,
  openTaskStoreV2,
  takeoverTaskV3,
  updateTaskV2,
  updateTaskV4,
} from '../core/task-store.js'
import type { TaskProfile } from '../core/types.js'
import { now } from '../core/utils.js'
import {
  artifactChanges,
  artifactLabel,
  currentWritableTask,
  groupId,
  mutationJson,
  readPlan,
  requirePositionals,
  taskProvenance,
} from './task-common.js'
import { commandUsage } from './usage.js'

export function runClaim(args: string[], cwd: string, actor: string) {
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
    return json(
      mutationJson(store, result.task, actor, result.warnings, expectRevision),
    )
  process.stdout.write(
    `Claimed ${result.task.id} for ${actor} and upgraded it to schema v4.\n`,
  )
  printWarnings(result.warnings)
}

export function runTakeover(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...mutationOptions(),
    'expect-revision': { type: 'string' },
    reason: { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage.takeover}\n`)
  validateBrief(parsed.values.json, parsed.values.brief)
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
    return json(
      mutationJson(store, result.task, actor, result.warnings, expectRevision, {
        brief: Boolean(parsed.values.brief),
      }),
    )
  process.stdout.write(`Transferred ${result.task.id} to ${actor}.\n`)
  printWarnings(result.warnings)
}

export function runSave(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...mutationOptions(),
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
  validateBrief(parsed.values.json, parsed.values.brief)
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
      return json(
        mutationJson(store, result.task, actor, result.warnings, expectRevision, {
          brief: Boolean(parsed.values.brief),
        }),
      )
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
      return json(
        mutationJson(store, result.task, actor, result.warnings, expectRevision, {
          brief: Boolean(parsed.values.brief),
        }),
      )
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
      return json(
        mutationJson(store, result.task, actor, result.warnings, expectRevision, {
          brief: Boolean(parsed.values.brief),
        }),
      )
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
    ? readPlan(cwd, parsed.values['plan-file'], current.profile)
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
    return json(
      mutationJson(store, result.task, actor, result.warnings, current.revision, {
        brief: Boolean(parsed.values.brief),
      }),
    )
  process.stdout.write(
    `Saved ${result.task.id}: revision ${current.revision} -> ${result.task.revision}\n`,
  )
  printWarnings(result.warnings)
}

export function runArtifact(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...mutationOptions(),
    'expect-revision': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${commandUsage.artifact}\n`)
  validateBrief(parsed.values.json, parsed.values.brief)
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
    return json(
      mutationJson(store, result.task, actor, result.warnings, expectRevision, {
        brief: Boolean(parsed.values.brief),
      }),
    )
  process.stdout.write(
    `Updated ${result.task.id} artifacts: revision ${expectRevision} -> ${result.task.revision}\n`,
  )
  printWarnings(result.warnings)
}
