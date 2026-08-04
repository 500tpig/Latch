import { isDeepStrictEqual } from 'node:util'
import {
  artifactDeliveryWarnings,
  untrackedWorktreeWarnings,
} from '../artifact-status.js'
import {
  archiveTaskV2,
  assertKnowledgeImpact,
  assertTaskWritableV2,
  readArchivedTaskV2,
  readTaskV2,
  updateTaskV2,
  updateTaskV4,
} from '../task-store.js'
import type { TaskStoreV2, TaskWriteResultV2 } from '../task-store.js'
import type {
  CloseoutResolution,
  KnowledgeImpact,
  TaskCloseoutInput,
  WorkspaceSnapshot,
} from '../types.js'
import { now } from '../utils.js'
import {
  captureWorkspaceSnapshot,
  compareWorkspaceSnapshots,
} from '../workspace-evidence.js'
import {
  assertSubmissionProof,
  assertValidWorkBasis,
  cliArgument,
  gatePlan,
  missingCurrentGates,
  profileOf,
  requireText,
  usesLightProofPackage,
  withWarnings,
} from './shared.js'
import {
  assertReadyForWork,
  invalidateWorkspaceProof,
  readBaselineSnapshot,
  reconcileViolations,
  requireWorkspaceScope,
  validateCurrentGateEvidence,
  verificationSummary,
} from './verification.js'

export type SubmitTaskV2Input = {
  expectRevision: number
  actor: string
  changes: string
  unverified?: string
  unverifiedItems?: string[]
  noVerify: boolean
  reason?: string
  knowledgeImpact?: KnowledgeImpact
  verboseWarnings?: boolean
}

export function submitTaskV2(
  store: TaskStoreV2,
  id: string,
  input: SubmitTaskV2Input,
): TaskWriteResultV2 {
  const current = assertTaskWritableV2(
    store,
    id,
    input.actor,
    input.expectRevision,
  )
  assertReadyForWork(current)
  const workspaceScope = requireWorkspaceScope(current)
  if (current.plan.open_questions.length > 0)
    throw new Error('Cannot submit while plan.open_questions is not empty.')
  const changes = requireText(input.changes, '--changes is required.')
  const unverifiedItems = current.schema_version === 5
    ? (input.unverifiedItems ?? []).map((summary, index) => ({
        item_id: `U${index + 1}`,
        summary: requireText(summary, '--unverified entries must be non-empty.'),
      }))
    : undefined
  if (current.schema_version === 5 && input.unverified !== undefined)
    throw new Error('Schema 5 submit uses unverifiedItems.')
  if (current.schema_version !== 5 && typeof input.unverified !== 'string')
    throw new Error('--unverified is required.')
  const gates = gatePlan(current)
  let noVerifyReason: string | undefined
  if (input.noVerify) {
    if (profileOf(current) === 'light')
      throw new Error('Light submit denied: --no-verify is not allowed for profile=light.')
    if (current.phase !== 'dev')
      throw new Error('No-verify submission requires phase dev.')
    if (gates.length > 0)
      throw new Error('No-verify submission requires a plan without gates.')
    noVerifyReason = requireText(input.reason, '--reason is required with --no-verify.')
  } else {
    if (input.reason) throw new Error('--reason requires --no-verify.')
    if (current.phase !== 'check')
      throw new Error('Gate submission requires phase check.')
    if (gates.length === 0)
      throw new Error('Gate submission requires at least one planned gate.')
    if (!current.workspace_proof)
      throw new Error('Current task does not have a workspace proof generation.')
    try {
      validateCurrentGateEvidence(store, current)
    } catch (error) {
      throw new Error(
        `Submit workspace evidence error: ${error instanceof Error ? error.message : String(error)}.`,
      )
    }
    const live = captureWorkspaceSnapshot(
      store.paths.workspaceRoot,
      workspaceScope,
      current.artifacts,
    )
    if (!live.complete)
      throw new Error(
        `Submit workspace evidence error: ${live.error ?? 'capture incomplete'}.`,
      )
    let baseline: WorkspaceSnapshot
    try {
      baseline = readBaselineSnapshot(store, current)!
    } catch (error) {
      throw new Error(
        `Submit workspace evidence error: ${error instanceof Error ? error.message : String(error)}.`,
      )
    }
    const liveDelta = compareWorkspaceSnapshots(baseline, live, workspaceScope)
    const reconciled = reconcileViolations(current, live)
    if (
      liveDelta.status !== 'unchanged' ||
      reconciled.restored.length > 0 ||
      reconciled.reclassified.length > 0
    ) {
      const invalidated = invalidateWorkspaceProof(
        store,
        current,
        { expectRevision: input.expectRevision, actor: input.actor },
        live,
        liveDelta,
        'workspace_baseline_mismatch',
        'submit',
      )
      throw new Error(
        `Submit denied: workspace proof generation advanced to ${invalidated.task.workspace_proof!.generation} at revision ${invalidated.task.revision}; rerun all named gates.`,
      )
    }
    if (current.workspace_proof.unresolved_violations.length > 0)
      throw new Error(
        `Submit denied: ${current.workspace_proof.unresolved_violations.length} unresolved workspace violation(s).`,
      )
    const missing = missingCurrentGates(current)
    if (missing.length > 0)
      throw new Error(
        `Current work revision has incomplete gates: ${missing.map((item) => item.name).join(', ')}.`,
      )
  }
  if (usesLightProofPackage(current)) {
    if (!input.knowledgeImpact)
      throw new Error('--knowledge-impact-file is required for structured submission.')
    if (
      input.knowledgeImpact.kind === 'updated' &&
      Array.isArray(input.knowledgeImpact.artifact_refs) &&
      input.knowledgeImpact.artifact_refs.every(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          typeof item.kind === 'string' &&
          typeof item.path === 'string',
      )
    ) {
      assertKnowledgeImpact(
        input.knowledgeImpact,
        [...current.artifacts, ...input.knowledgeImpact.artifact_refs],
        'submit input',
      )
      const attached = new Set(
        current.artifacts.map((item) => `${item.kind}\u0000${item.path}`),
      )
      const missing = input.knowledgeImpact.artifact_refs.filter(
        (item) => !attached.has(`${item.kind}\u0000${item.path}`),
      )
      if (missing.length > 0) {
        const labels = missing.map((item) => `${item.kind}:${item.path}`)
        throw new Error(
          `Knowledge impact artifacts are not attached to the task: ${labels.join(', ')}. ` +
          `Run: latch artifact add ${cliArgument(current.id)} --expect-revision ${current.revision} ${labels.map(cliArgument).join(' ')}`,
        )
      }
    }
    assertKnowledgeImpact(input.knowledgeImpact, current.artifacts, 'submit input')
  } else if (input.knowledgeImpact) {
    throw new Error(
      'Knowledge impact requires schema_version 4; legacy data was not modified.',
    )
  }
  const verified = verificationSummary(current)
  return withWarnings(updateTaskV2(store, current.id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    events: [
      {
        type: 'submitted',
        fields: {
          ...(usesLightProofPackage(current)
            ? { plan_revision: current.plan_revision }
            : {}),
          work_revision: current.work_revision,
          no_verify: input.noVerify,
          ...(input.knowledgeImpact
            ? { knowledge_impact_kind: input.knowledgeImpact.kind }
            : {}),
          ...(current.schema_version === 5
            ? {
                unverified_item_ids: unverifiedItems!.map((item) => item.item_id),
                unverified_count: unverifiedItems!.length,
              }
            : {}),
        },
      },
    ],
    update(task) {
      task.submission = {
        ...(usesLightProofPackage(task)
          ? { plan_revision: task.plan_revision }
          : {}),
        work_revision: task.work_revision,
        changes,
        verified,
        ...(task.schema_version === 5
          ? { unverified_items: structuredClone(unverifiedItems!) }
          : { unverified: input.unverified! }),
        ...(input.knowledgeImpact
          ? { knowledge_impact: structuredClone(input.knowledgeImpact) }
          : {}),
        ...(noVerifyReason ? { no_verify: { reason: noVerifyReason } } : {}),
        submitted_at: now(),
      }
      task.phase = 'review'
    },
  }), [
    ...artifactDeliveryWarnings(store.paths.workspaceRoot, current.artifacts),
    ...untrackedWorktreeWarnings(
      store.paths.workspaceRoot,
      input.verboseWarnings,
    ),
  ])
}


export type PatchSubmissionKnowledgeImpactV3Input = {
  expectRevision: number
  actor: string
  knowledgeImpact: KnowledgeImpact
  reason?: string
}

export function patchSubmissionKnowledgeImpactV3(
  store: TaskStoreV2,
  id: string,
  input: PatchSubmissionKnowledgeImpactV3Input,
): TaskWriteResultV2 {
  const current = readTaskV2(store, id)
  if (!usesLightProofPackage(current))
    throw new Error(
      'Submission patch requires a structured profile; legacy data was not modified.',
    )
  if (current.blocked) throw new Error(`Task is blocked: ${current.blocked.reason}`)
  if (current.phase !== 'review')
    throw new Error('Patch denied: task must be in review.')
  const submission = current.submission
  if (!submission) throw new Error('Patch denied: submission is required.')
  const previousImpact = submission.knowledge_impact
  const correction = previousImpact !== undefined
  const reason = correction
    ? requireText(input.reason, 'Patch correction requires a non-empty reason.')
    : undefined
  if (correction && isDeepStrictEqual(previousImpact, input.knowledgeImpact))
    throw new Error('Patch denied: knowledge_impact is unchanged.')
  if (
    submission.plan_revision !== undefined &&
    submission.plan_revision !== current.plan_revision
  )
    throw new Error('Patch denied: submission plan_revision mismatch.')
  if (submission.work_revision !== current.work_revision)
    throw new Error('Patch denied: submission work_revision mismatch.')
  assertValidWorkBasis(current)
  assertSubmissionProof(current)
  assertKnowledgeImpact(input.knowledgeImpact, current.artifacts, 'patch input')

  return updateTaskV4(store, current.id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    events: [{
      type: 'submission_knowledge_impact_patched',
      fields: {
        plan_revision: current.plan_revision,
        work_revision: current.work_revision,
        knowledge_impact_kind: input.knowledgeImpact.kind,
        operation: correction ? 'correction' : 'backfill',
        ...(correction
          ? {
              reason,
              previous_knowledge_impact: structuredClone(previousImpact),
              knowledge_impact: structuredClone(input.knowledgeImpact),
            }
          : {}),
      },
    }],
    update(task) {
      task.submission!.plan_revision = task.plan_revision
      task.submission!.knowledge_impact = structuredClone(input.knowledgeImpact)
    },
  })
}

export type DoneTaskV2Input = {
  expectRevision: number
  actor: string
  followup?: string
  closeout?: TaskCloseoutInput
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactInputKeys(value: Record<string, unknown>, keys: string[]) {
  const expected = new Set(keys)
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  )
}

function validExternalAccountUri(value: unknown) {
  if (typeof value !== 'string') return false
  try {
    const uri = new URL(value)
    if (uri.username || uri.password) return false
    if (uri.protocol === 'mailto:') {
      const separator = uri.pathname.indexOf('@')
      return (
        separator > 0 &&
        separator < uri.pathname.length - 1 &&
        !uri.search &&
        !uri.hash
      )
    }
    return (
      uri.protocol === 'https:' &&
      Boolean(uri.hostname) &&
      uri.pathname !== '/' &&
      uri.pathname !== ''
    )
  } catch {
    return false
  }
}

function materializeCloseout(
  input: unknown,
  items: Array<{ item_id: string }>,
): CloseoutResolution[] {
  if (!isRecord(input) || !exactInputKeys(input, ['resolutions']))
    throw new Error('Invalid --closeout-file: expected a resolutions array.')
  if (!Array.isArray(input.resolutions))
    throw new Error('Invalid --closeout-file: resolutions must be an array.')
  const expected = new Set(items.map((item) => item.item_id))
  const seen = new Set<string>()
  const recordedAt = now()
  const materialized = input.resolutions.map((entry): CloseoutResolution => {
    if (!isRecord(entry) || typeof entry.item_id !== 'string')
      throw new Error('Invalid closeout resolution item_id.')
    if (!expected.has(entry.item_id))
      throw new Error(`Unknown closeout resolution item_id: ${entry.item_id}.`)
    if (seen.has(entry.item_id))
      throw new Error(`Duplicate closeout resolution item_id: ${entry.item_id}.`)
    seen.add(entry.item_id)
    if (entry.outcome === 'resolved') {
      if (!exactInputKeys(entry, ['item_id', 'outcome', 'resolution']))
        throw new Error(`Invalid resolved closeout for ${entry.item_id}.`)
      return {
        item_id: entry.item_id,
        outcome: 'resolved',
        resolution: requireText(
          entry.resolution as string | undefined,
          `Resolved closeout for ${entry.item_id} requires resolution.`,
        ),
      }
    }
    if (entry.outcome === 'accepted_risk') {
      if (
        !exactInputKeys(entry, ['item_id', 'outcome', 'user_acceptance']) ||
        !isRecord(entry.user_acceptance) ||
        !exactInputKeys(entry.user_acceptance, ['statement'])
      )
        throw new Error(`Invalid accepted_risk closeout for ${entry.item_id}.`)
      return {
        item_id: entry.item_id,
        outcome: 'accepted_risk',
        user_acceptance: {
          accepted_by: 'user',
          statement: requireText(
            entry.user_acceptance.statement as string | undefined,
            `Accepted risk for ${entry.item_id} requires user_acceptance.statement.`,
          ),
          recorded_at: recordedAt,
        },
      }
    }
    if (entry.outcome === 'followup') {
      if (
        !exactInputKeys(entry, ['item_id', 'outcome', 'followup']) ||
        !isRecord(entry.followup) ||
        !exactInputKeys(entry.followup, ['action', 'owner']) ||
        !isRecord(entry.followup.owner) ||
        !exactInputKeys(entry.followup.owner, ['kind', 'account_uri']) ||
        entry.followup.owner.kind !== 'external' ||
        !validExternalAccountUri(entry.followup.owner.account_uri)
      )
        throw new Error(`Invalid followup closeout for ${entry.item_id}.`)
      return {
        item_id: entry.item_id,
        outcome: 'followup',
        followup: {
          action: requireText(
            entry.followup.action as string | undefined,
            `Followup closeout for ${entry.item_id} requires action.`,
          ),
          owner: {
            kind: 'external',
            account_uri: entry.followup.owner.account_uri as string,
          },
        },
      }
    }
    throw new Error(`Invalid closeout outcome for ${entry.item_id}.`)
  })
  const missing = [...expected].filter((itemId) => !seen.has(itemId))
  if (missing.length > 0)
    throw new Error(`Missing closeout resolution item_id: ${missing.join(', ')}.`)
  return materialized
}

export function doneTaskV2(
  store: TaskStoreV2,
  id: string,
  input: DoneTaskV2Input,
): TaskWriteResultV2 {
  const archived = readArchivedTaskV2(store, id)
  if (archived) {
    if (archived.outcome !== 'done')
      throw new Error(`Task was already archived as ${archived.outcome}.`)
    return { task: archived, warnings: [] }
  }
  const current = readTaskV2(store, id)
  if (current.blocked) throw new Error(`Task is blocked: ${current.blocked.reason}`)
  if (current.phase !== 'review')
    throw new Error(`Cannot complete task in phase ${current.phase}.`)
  const submission = current.submission
  if (!submission || submission.work_revision !== current.work_revision)
    throw new Error('Current work revision does not have a valid submission.')
  if (usesLightProofPackage(current)) {
    if (submission.plan_revision !== current.plan_revision)
      throw new Error('Current submission plan_revision is stale.')
    if (!submission.knowledge_impact)
      throw new Error('Current submission does not have knowledge_impact.')
    assertKnowledgeImpact(
      submission.knowledge_impact,
      current.artifacts,
      'current submission',
    )
    assertValidWorkBasis(current)
  }
  assertSubmissionProof(current)
  const unverifiedItems = current.schema_version === 5
    ? (submission.unverified_items ?? [])
    : []
  if (current.schema_version === 5 && unverifiedItems.length > 0 && !input.closeout)
    throw new Error('--closeout-file is required while unverified items remain.')
  if (current.schema_version === 5 && input.followup !== undefined)
    throw new Error('Schema 5 done uses --closeout-file, not --followup.')
  if (current.schema_version !== 5 && input.closeout !== undefined)
    throw new Error('--closeout-file requires schema_version 5.')
  const resolutions = current.schema_version === 5
    ? materializeCloseout(input.closeout ?? { resolutions: [] }, unverifiedItems)
    : undefined
  const outcomeCounts = resolutions
    ? {
        resolved_count: resolutions.filter((item) => item.outcome === 'resolved').length,
        accepted_risk_count: resolutions.filter((item) => item.outcome === 'accepted_risk').length,
        followup_count: resolutions.filter((item) => item.outcome === 'followup').length,
      }
    : undefined
  return archiveTaskV2(store, current.id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    outcome: 'done',
    ...(outcomeCounts ? { eventFields: outcomeCounts } : {}),
    update(task) {
      task.closure = task.schema_version === 5
        ? {
            changes: submission.changes,
            verified: submission.verified,
            unverified_items: structuredClone(unverifiedItems),
            resolutions: structuredClone(resolutions!),
            accepted_at: now(),
          }
        : {
            changes: submission.changes,
            verified: submission.verified,
            unverified: submission.unverified!,
            followup: input.followup ?? '',
            accepted_at: now(),
          }
    },
  })
}

export type AbandonTaskV2Input = {
  expectRevision: number
  actor: string
  reason: string
}

export function abandonTaskV2(
  store: TaskStoreV2,
  id: string,
  input: AbandonTaskV2Input,
): TaskWriteResultV2 {
  const archived = readArchivedTaskV2(store, id)
  if (archived) {
    if (archived.outcome !== 'abandoned')
      throw new Error(`Task was already archived as ${archived.outcome}.`)
    return { task: archived, warnings: [] }
  }
  const reason = requireText(input.reason, '--reason is required.')
  return archiveTaskV2(store, id, {
    expectRevision: input.expectRevision,
    actor: input.actor,
    outcome: 'abandoned',
    eventFields: { reason },
  })
}
