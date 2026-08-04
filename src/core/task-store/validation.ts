import { isAbsolute, normalize, sep } from 'node:path'
import { isWritableActor } from '../actor.js'
import { assertTaskPlan } from '../plan-schema.js'
import {
  SCHEMA_V4_MIN_WRITER_VERSION,
  SCHEMA_V5_MIN_WRITER_VERSION,
} from '../types.js'
import type {
  CloseoutResolution,
  ImplementationAuthorization,
  ImplementationAuthorizationInput,
  KnowledgeImpact,
  LatchStateV2,
  RetrospectiveRecord,
  RetrospectiveRecordInput,
  TaskArtifact,
  TaskV2,
  WorkspaceEvidenceRef,
  WorkBasis,
  WorkBasisInput,
} from '../types.js'
import { now } from '../utils.js'

export const V2_SCHEMA_VERSION = 2 as const
export const V3_SCHEMA_VERSION = 3 as const
export const V4_SCHEMA_VERSION = 4 as const
export const V5_SCHEMA_VERSION = 5 as const
export const CANONICAL_TASK_ID =
  /^\d{17}-[a-z0-9\u4e00-\u9fa5]+(?:-[a-z0-9\u4e00-\u9fa5]+)*-[a-f0-9]{6}$/

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isStructuredTaskSchema(schemaVersion: unknown): schemaVersion is 3 | 4 | 5 {
  return (
    schemaVersion === V3_SCHEMA_VERSION ||
    schemaVersion === V4_SCHEMA_VERSION ||
    schemaVersion === V5_SCHEMA_VERSION
  )
}

export function requireString(
  value: unknown,
  field: string,
  path: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Invalid ${field} in ${path}.`)
}

function requireInteger(value: unknown, field: string, path: string, minimum: number) {
  if (!Number.isInteger(value) || (value as number) < minimum)
    throw new Error(`Invalid ${field} in ${path}.`)
}

function requireStringArray(
  value: unknown,
  field: string,
  path: string,
): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    throw new Error(`Invalid ${field} in ${path}.`)
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: string[],
  field: string,
  path: string,
) {
  const allowed = new Set(keys)
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  const missing = keys.filter((key) => !Object.hasOwn(value, key))
  if (unexpected.length > 0 || missing.length > 0)
    throw new Error(`Invalid ${field} shape in ${path}.`)
}

function assertUnverifiedItems(
  value: unknown,
  field: string,
  path: string,
) {
  if (!Array.isArray(value)) throw new Error(`Invalid ${field} in ${path}.`)
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) throw new Error(`Invalid ${field} in ${path}.`)
    requireExactKeys(item, ['item_id', 'summary'], field, path)
    if (item.item_id !== `U${index + 1}`)
      throw new Error(`Invalid ${field}.item_id in ${path}.`)
    requireString(item.summary, `${field}.summary`, path)
  }
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

function assertCloseoutResolutions(
  value: unknown,
  items: unknown,
  path: string,
): asserts value is CloseoutResolution[] {
  if (!Array.isArray(value))
    throw new Error(`Invalid closure.resolutions in ${path}.`)
  assertUnverifiedItems(items, 'closure.unverified_items', path)
  const expectedIds = new Set(
    (items as Array<{ item_id: string }>).map((item) => item.item_id),
  )
  const seen = new Set<string>()
  for (const resolution of value) {
    if (!isRecord(resolution))
      throw new Error(`Invalid closure.resolutions in ${path}.`)
    requireString(resolution.item_id, 'closure.resolutions.item_id', path)
    if (!expectedIds.has(resolution.item_id as string))
      throw new Error(`Unknown closure resolution item_id in ${path}.`)
    if (seen.has(resolution.item_id as string))
      throw new Error(`Duplicate closure resolution item_id in ${path}.`)
    seen.add(resolution.item_id as string)
    if (resolution.outcome === 'resolved') {
      requireExactKeys(
        resolution,
        ['item_id', 'outcome', 'resolution'],
        'closure.resolutions.resolved',
        path,
      )
      requireString(resolution.resolution, 'closure.resolutions.resolution', path)
      continue
    }
    if (resolution.outcome === 'accepted_risk') {
      requireExactKeys(
        resolution,
        ['item_id', 'outcome', 'user_acceptance'],
        'closure.resolutions.accepted_risk',
        path,
      )
      if (!isRecord(resolution.user_acceptance))
        throw new Error(`Invalid closure.resolutions.user_acceptance in ${path}.`)
      requireExactKeys(
        resolution.user_acceptance,
        ['accepted_by', 'statement', 'recorded_at'],
        'closure.resolutions.user_acceptance',
        path,
      )
      if (resolution.user_acceptance.accepted_by !== 'user')
        throw new Error(`Invalid closure.resolutions.accepted_by in ${path}.`)
      requireString(
        resolution.user_acceptance.statement,
        'closure.resolutions.user_acceptance.statement',
        path,
      )
      requireString(
        resolution.user_acceptance.recorded_at,
        'closure.resolutions.user_acceptance.recorded_at',
        path,
      )
      continue
    }
    if (resolution.outcome === 'followup') {
      requireExactKeys(
        resolution,
        ['item_id', 'outcome', 'followup'],
        'closure.resolutions.followup',
        path,
      )
      if (!isRecord(resolution.followup))
        throw new Error(`Invalid closure.resolutions.followup in ${path}.`)
      requireExactKeys(
        resolution.followup,
        ['action', 'owner'],
        'closure.resolutions.followup',
        path,
      )
      requireString(
        resolution.followup.action,
        'closure.resolutions.followup.action',
        path,
      )
      if (!isRecord(resolution.followup.owner))
        throw new Error(`Invalid closure.resolutions.followup.owner in ${path}.`)
      requireExactKeys(
        resolution.followup.owner,
        ['kind', 'account_uri'],
        'closure.resolutions.followup.owner',
        path,
      )
      if (
        resolution.followup.owner.kind !== 'external' ||
        !validExternalAccountUri(resolution.followup.owner.account_uri)
      )
        throw new Error(`Invalid closure.resolutions.followup.owner in ${path}.`)
      continue
    }
    throw new Error(`Invalid closure resolution outcome in ${path}.`)
  }
  if (seen.size !== expectedIds.size)
    throw new Error(`Missing closure resolution item_id in ${path}.`)
}

export function assertGroupIdV3(
  value: unknown,
  path: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Invalid group_id in ${path}: empty string.`)
  if (value.length > 128)
    throw new Error(`Invalid group_id in ${path}: exceeds max length 128.`)
  if (/[\u0000-\u001f\u007f]/.test(value))
    throw new Error(`Invalid group_id in ${path}: contains ASCII control characters.`)
}

function assertRelativePath(value: string, field: string, path: string) {
  const normalized = normalize(value)
  if (
    isAbsolute(value) ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith(`..${sep}`)
  )
    throw new Error(`Invalid ${field} in ${path}.`)
}

function assertWorkBasis(value: unknown, path: string): asserts value is WorkBasis {
  if (!isRecord(value))
    throw new Error(
      `Invalid work_basis in ${path}: expected an object with kind, source, reason, and scope.summary.`,
    )
  const errors: string[] = []
  if (
    typeof value.plan_revision !== 'number' ||
    !Number.isInteger(value.plan_revision) ||
    value.plan_revision < 1
  )
    errors.push('work_basis.plan_revision must be a positive integer')
  if (typeof value.reason !== 'string' || value.reason.trim() === '')
    errors.push('work_basis.reason must be a non-empty string')
  if (value.kind === 'implementation_authorization') {
    if (typeof value.authorized_at !== 'string' || value.authorized_at.trim() === '')
      errors.push('work_basis.authorized_at must be a non-empty string')
    if (
      value.source !== 'user_request' &&
      value.source !== 'user_approve' &&
      value.source !== 'user_delta'
    )
      errors.push('work_basis.source must be user_request, user_approve, or user_delta')
    if (!isRecord(value.scope)) {
      errors.push('work_basis.scope must be an object with scope.summary')
    } else {
      if (typeof value.scope.summary !== 'string' || value.scope.summary.trim() === '')
        errors.push('work_basis.scope.summary must be a non-empty string')
      if (
        value.scope.paths !== undefined &&
        (!Array.isArray(value.scope.paths) || value.scope.paths.some((entry) => typeof entry !== 'string'))
      )
        errors.push('work_basis.scope.paths must be an array of strings')
      if (
        value.scope.notes !== undefined &&
        (typeof value.scope.notes !== 'string' || value.scope.notes.trim() === '')
      )
        errors.push('work_basis.scope.notes must be a non-empty string')
    }
  } else if (value.kind === 'retrospective_record') {
    if (typeof value.recorded_at !== 'string' || value.recorded_at.trim() === '')
      errors.push('work_basis.recorded_at must be a non-empty string')
    if (value.implemented_before_task !== true)
      errors.push('work_basis.implemented_before_task must be true')
    if (typeof value.scope_summary !== 'string' || value.scope_summary.trim() === '')
      errors.push('work_basis.scope_summary must be a non-empty string')
    if (
      typeof value.work_revision !== 'number' ||
      !Number.isInteger(value.work_revision) ||
      value.work_revision < 1
    )
      errors.push('work_basis.work_revision must be a positive integer')
  } else {
    errors.push('work_basis.kind must be implementation_authorization or retrospective_record')
  }
  if (errors.length > 0)
    throw new Error(`Invalid work_basis in ${path}: ${errors.join('; ')}.`)
}

export function materializeWorkBasisV3(
  input: ImplementationAuthorizationInput,
  planRevision: number,
  workRevision: number,
): ImplementationAuthorization
export function materializeWorkBasisV3(
  input: RetrospectiveRecordInput,
  planRevision: number,
  workRevision: number,
): RetrospectiveRecord
export function materializeWorkBasisV3(
  input: WorkBasisInput,
  planRevision: number,
  workRevision: number,
): WorkBasis
export function materializeWorkBasisV3(
  input: WorkBasisInput,
  planRevision: number,
  workRevision: number,
): WorkBasis {
  let basis: WorkBasis
  if (input?.kind === 'implementation_authorization') {
    basis = {
      kind: input.kind,
      plan_revision: planRevision,
      authorized_at: now(),
      source: input.source,
      reason: input.reason,
      scope: structuredClone(input.scope),
    }
  } else if (input?.kind === 'retrospective_record') {
    basis = {
      kind: input.kind,
      recorded_at: now(),
      reason: input.reason,
      implemented_before_task: input.implemented_before_task,
      scope_summary: input.scope_summary,
      plan_revision: planRevision,
      work_revision: workRevision,
    }
  } else {
    throw new Error(
      'Invalid work_basis input: expected kind, source, reason, and scope.summary for implementation_authorization.',
    )
  }
  assertWorkBasis(basis, 'work basis input')
  return basis
}

export function assertKnowledgeImpact(
  value: unknown,
  artifacts: TaskArtifact[],
  path: string,
): asserts value is KnowledgeImpact {
  if (!isRecord(value)) throw new Error(`Invalid knowledge_impact in ${path}.`)
  if (value.kind === 'none') {
    requireString(value.reason, 'knowledge_impact.reason', path)
    return
  }
  if (value.kind !== 'updated')
    throw new Error(`Invalid knowledge_impact.kind in ${path}.`)
  requireString(value.summary, 'knowledge_impact.summary', path)
  if (!Array.isArray(value.artifact_refs) || value.artifact_refs.length === 0)
    throw new Error(`Invalid knowledge_impact.artifact_refs in ${path}.`)
  const artifactKeys = new Set(artifacts.map((item) => `${item.kind}\u0000${item.path}`))
  for (const reference of value.artifact_refs) {
    if (!isRecord(reference))
      throw new Error(`Invalid knowledge_impact.artifact_refs in ${path}.`)
    requireString(reference.kind, 'knowledge_impact.artifact_refs.kind', path)
    requireString(reference.path, 'knowledge_impact.artifact_refs.path', path)
    assertRelativePath(
      reference.path,
      'knowledge_impact.artifact_refs.path',
      path,
    )
    if (!artifactKeys.has(`${reference.kind}\u0000${reference.path}`))
      throw new Error(
        `Knowledge impact artifact is not attached to the task: ${reference.kind}:${reference.path}.`,
      )
  }
}

export function assertStateV2(value: unknown, path: string): asserts value is LatchStateV2 {
  if (!isRecord(value) || value.schema_version !== V2_SCHEMA_VERSION)
    throw new Error(`Unsupported or invalid Latch schema in ${path}.`)
  const unknownKeys = Object.keys(value).filter(
    (key) => key !== 'schema_version' && key !== 'actors',
  )
  if (unknownKeys.length > 0)
    throw new Error(`Invalid state fields in ${path}: ${unknownKeys.join(', ')}.`)
  if (!isRecord(value.actors)) throw new Error(`Invalid actors in ${path}.`)
  for (const [actor, actorState] of Object.entries(value.actors)) {
    requireString(actor, 'actor', path)
    if (!isRecord(actorState)) throw new Error(`Invalid actor state in ${path}.`)
    const actorKeys = Object.keys(actorState).filter(
      (key) => key !== 'current_task_id',
    )
    if (actorKeys.length > 0)
      throw new Error(`Invalid actor state fields in ${path}: ${actorKeys.join(', ')}.`)
    if (
      actorState.current_task_id !== undefined &&
      (typeof actorState.current_task_id !== 'string' ||
        !CANONICAL_TASK_ID.test(actorState.current_task_id))
    )
      throw new Error(`Invalid current_task_id in ${path}.`)
  }
}

function assertVerificationMap(
  value: unknown,
  field: string,
  expectedKind: 'gate' | 'diagnostic',
  path: string,
) {
  if (!isRecord(value)) throw new Error(`Invalid ${field} in ${path}.`)
  for (const [name, result] of Object.entries(value)) {
    if (!isRecord(result)) throw new Error(`Invalid ${field}.${name} in ${path}.`)
    requireString(result.name, `${field}.${name}.name`, path)
    if (result.name !== name)
      throw new Error(`Verification name does not match key ${field}.${name} in ${path}.`)
    requireStringArray(result.command, `${field}.${name}.command`, path)
    requireInteger(result.exit_code, `${field}.${name}.exit_code`, path, 0)
    requireInteger(result.work_revision, `${field}.${name}.work_revision`, path, 0)
    requireString(result.created_at, `${field}.${name}.created_at`, path)
    if (result.kind !== expectedKind)
      throw new Error(`Invalid ${field}.${name}.kind in ${path}.`)
    if (result.status !== 'pass' && result.status !== 'fail')
      throw new Error(`Invalid ${field}.${name}.status in ${path}.`)
    if (result.proof !== undefined) {
      if (!isRecord(result.proof))
        throw new Error(`Invalid ${field}.${name}.proof in ${path}.`)
      requireInteger(
        result.proof.started_generation,
        `${field}.${name}.proof.started_generation`,
        path,
        1,
      )
      requireInteger(
        result.proof.ended_generation,
        `${field}.${name}.proof.ended_generation`,
        path,
        1,
      )
      for (const key of ['before_ref', 'after_ref', 'delta_ref'] as const)
        assertEvidenceRef(
          result.proof[key],
          `${field}.${name}.proof.${key}`,
          path,
        )
    }
  }
}

function assertEvidenceRef(
  value: unknown,
  field: string,
  taskPath: string,
): asserts value is WorkspaceEvidenceRef {
  if (!isRecord(value))
    throw new Error(`Invalid ${field} in ${taskPath}.`)
  requireString(value.path, `${field}.path`, taskPath)
  if (
    !value.path.startsWith('evidence/') ||
    value.path.includes('\\') ||
    normalize(value.path).startsWith(`..${sep}`)
  )
    throw new Error(`Invalid ${field}.path in ${taskPath}.`)
  if (
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  )
    throw new Error(`Invalid ${field}.sha256 in ${taskPath}.`)
  requireInteger(value.entry_count, `${field}.entry_count`, taskPath, 0)
}

function assertWorkspaceProof(value: unknown, taskPath: string) {
  if (!isRecord(value))
    throw new Error(`Invalid workspace_proof in ${taskPath}.`)
  requireInteger(value.generation, 'workspace_proof.generation', taskPath, 1)
  assertEvidenceRef(
    value.baseline_ref,
    'workspace_proof.baseline_ref',
    taskPath,
  )
  if (!isRecord(value.baseline_counts))
    throw new Error(`Invalid workspace_proof.baseline_counts in ${taskPath}.`)
  for (const key of [
    'tracked_dirty',
    'untracked',
    'explicit_ignored',
    'in_scope',
    'out_of_scope',
  ])
    requireInteger(
      value.baseline_counts[key],
      `workspace_proof.baseline_counts.${key}`,
      taskPath,
      0,
    )
  if (!Array.isArray(value.unresolved_violations))
    throw new Error(`Invalid workspace_proof.unresolved_violations in ${taskPath}.`)
  for (const violation of value.unresolved_violations) {
    if (!isRecord(violation))
      throw new Error(`Invalid workspace violation in ${taskPath}.`)
    requireString(violation.id, 'workspace violation id', taskPath)
    requireString(violation.path, 'workspace violation path', taskPath)
    requireString(violation.source_gate, 'workspace violation source_gate', taskPath)
    requireInteger(
      violation.created_generation,
      'workspace violation created_generation',
      taskPath,
      1,
    )
    if (
      violation.status !== 'unresolved' &&
      violation.status !== 'restored' &&
      violation.status !== 'reclassified'
    )
      throw new Error(`Invalid workspace violation status in ${taskPath}.`)
  }
}

// 读盘后和写盘前复用同一份 schema 校验，避免把无效中间状态写进 task.json。
export function assertTaskV2(value: unknown, path: string): asserts value is TaskV2 {
  if (
    !isRecord(value) ||
    (value.schema_version !== V2_SCHEMA_VERSION &&
      value.schema_version !== V3_SCHEMA_VERSION &&
      value.schema_version !== V4_SCHEMA_VERSION &&
      value.schema_version !== V5_SCHEMA_VERSION)
  )
    throw new Error(`Unsupported or invalid Latch task schema in ${path}.`)
  if (
    value.schema_version === V4_SCHEMA_VERSION ||
    value.schema_version === V5_SCHEMA_VERSION
  ) {
    const minimumWriter = value.schema_version === V5_SCHEMA_VERSION
      ? SCHEMA_V5_MIN_WRITER_VERSION
      : SCHEMA_V4_MIN_WRITER_VERSION
    if (value.min_writer_version !== minimumWriter)
      throw new Error(
        `Invalid min_writer_version in ${path}: schema_version ${value.schema_version} requires ${minimumWriter}.`,
      )
    if (!Object.hasOwn(value, 'primary_writer'))
      throw new Error(`Invalid primary_writer in ${path}: schema_version ${value.schema_version} requires a writer.`)
    if (!Object.hasOwn(value, 'profile'))
      throw new Error(`Invalid profile in ${path}: schema_version ${value.schema_version} requires a profile.`)
    if (!Object.hasOwn(value, 'provenance'))
      throw new Error(`Invalid provenance in ${path}: schema_version ${value.schema_version} requires provenance.`)
  } else if (Object.hasOwn(value, 'min_writer_version')) {
    throw new Error(
      `Invalid min_writer_version in ${path}: schema_version 4 or 5 is required.`,
    )
  }
  if (Object.hasOwn(value, 'primary_writer')) {
    if (!isStructuredTaskSchema(value.schema_version))
      throw new Error(`Invalid primary_writer in ${path}: structured task schema is required.`)
    if (
      typeof value.primary_writer !== 'string' ||
      !isWritableActor(value.primary_writer)
    )
      throw new Error(`Invalid primary_writer in ${path}.`)
  }
  if (value.profile !== undefined) {
    if (!isStructuredTaskSchema(value.schema_version))
      throw new Error(`Invalid profile in ${path}: structured task schema is required.`)
    if (value.profile !== 'light' && value.profile !== 'standard')
      throw new Error(`Invalid profile in ${path}.`)
  }
  if (Object.hasOwn(value, 'provenance')) {
    if (!isStructuredTaskSchema(value.schema_version))
      throw new Error(`Invalid provenance in ${path}: structured task schema is required.`)
    if (value.provenance !== 'clean' && value.provenance !== 'mixed')
      throw new Error(`Invalid provenance in ${path}.`)
  }
  if (Object.hasOwn(value, 'group_id')) {
    if (!isStructuredTaskSchema(value.schema_version))
      throw new Error(`Invalid group_id in ${path}: structured task schema is required.`)
    assertGroupIdV3(value.group_id, path)
  }
  if (Object.hasOwn(value, 'source_record')) {
    if (!isStructuredTaskSchema(value.schema_version))
      throw new Error(`Invalid source_record in ${path}: structured task schema is required.`)
    if (!isRecord(value.source_record))
      throw new Error(`Invalid source_record in ${path}.`)
    requireString(value.source_record.record_id, 'source_record.record_id', path)
    if (
      !/^rec_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        value.source_record.record_id,
      )
    )
      throw new Error(`Invalid source_record.record_id in ${path}.`)
    requireInteger(value.source_record.revision, 'source_record.revision', path, 1)
    if (
      typeof value.source_record.body_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.source_record.body_sha256)
    )
      throw new Error(`Invalid source_record.body_sha256 in ${path}.`)
  }
  if (value.work_basis !== undefined) {
    if (!isStructuredTaskSchema(value.schema_version))
      throw new Error(`Invalid work_basis in ${path}: structured task schema is required.`)
    assertWorkBasis(value.work_basis, path)
  }
  requireString(value.id, 'id', path)
  if (!CANONICAL_TASK_ID.test(value.id as string))
    throw new Error(`Invalid canonical task id in ${path}.`)
  requireString(value.title, 'title', path)
  requireString(value.workspace_root, 'workspace_root', path)
  requireString(value.created_at, 'created_at', path)
  requireString(value.updated_at, 'updated_at', path)
  if (!['plan', 'dev', 'check', 'review'].includes(value.phase as string))
    throw new Error(`Invalid phase in ${path}.`)
  if (
    value.outcome !== undefined &&
    value.outcome !== 'done' &&
    value.outcome !== 'abandoned'
  )
    throw new Error(`Invalid outcome in ${path}.`)
  requireInteger(value.revision, 'revision', path, 1)
  requireInteger(value.plan_revision, 'plan_revision', path, 1)
  requireInteger(value.work_revision, 'work_revision', path, 0)
  assertTaskPlan(value.plan, path)
  if (!isRecord(value.verification))
    throw new Error(`Invalid verification in ${path}.`)
  assertVerificationMap(
    value.verification.gate,
    'verification.gate',
    'gate',
    path,
  )
  if (value.workspace_proof !== undefined)
    assertWorkspaceProof(value.workspace_proof, path)
  assertVerificationMap(
    value.verification.diagnostic,
    'verification.diagnostic',
    'diagnostic',
    path,
  )
  if (value.implementation_approval !== undefined) {
    const approval = value.implementation_approval
    if (!isRecord(approval))
      throw new Error(`Invalid implementation_approval in ${path}.`)
    requireInteger(
      approval.approved_plan_revision,
      'implementation_approval.approved_plan_revision',
      path,
      1,
    )
    requireString(
      approval.approved_at,
      'implementation_approval.approved_at',
      path,
    )
    requireString(approval.reason, 'implementation_approval.reason', path)
    if (approval.source !== 'user')
      throw new Error(`Invalid implementation_approval.source in ${path}.`)
  }
  if (value.blocked !== undefined) {
    if (!isRecord(value.blocked)) throw new Error(`Invalid blocked in ${path}.`)
    requireString(value.blocked.reason, 'blocked.reason', path)
    requireString(value.blocked.waiting_for, 'blocked.waiting_for', path)
    requireString(value.blocked.blocked_at, 'blocked.blocked_at', path)
  }
  if (!Array.isArray(value.artifacts))
    throw new Error(`Invalid artifacts in ${path}.`)
  for (const artifact of value.artifacts) {
    if (!isRecord(artifact)) throw new Error(`Invalid artifact in ${path}.`)
    requireString(artifact.kind, 'artifact.kind', path)
    requireString(artifact.path, 'artifact.path', path)
  }
  if (value.submission !== undefined) {
    if (!isRecord(value.submission))
      throw new Error(`Invalid submission in ${path}.`)
    requireInteger(
      value.submission.work_revision,
      'submission.work_revision',
      path,
      0,
    )
    if (value.submission.plan_revision !== undefined) {
      if (!isStructuredTaskSchema(value.schema_version))
        throw new Error(
          `Invalid submission.plan_revision in ${path}: structured task schema is required.`,
        )
      requireInteger(
        value.submission.plan_revision,
        'submission.plan_revision',
        path,
        1,
      )
    }
    requireString(value.submission.changes, 'submission.changes', path)
    if (typeof value.submission.verified !== 'string')
      throw new Error(`Invalid submission.verified in ${path}.`)
    if (value.schema_version === V5_SCHEMA_VERSION) {
      if (Object.hasOwn(value.submission, 'unverified'))
        throw new Error(`Invalid submission.unverified in ${path}: schema_version 5 uses unverified_items.`)
      assertUnverifiedItems(
        value.submission.unverified_items,
        'submission.unverified_items',
        path,
      )
    } else {
      if (typeof value.submission.unverified !== 'string')
        throw new Error(`Invalid submission.unverified in ${path}.`)
      if (Object.hasOwn(value.submission, 'unverified_items'))
        throw new Error(`Invalid submission.unverified_items in ${path}.`)
    }
    requireString(value.submission.submitted_at, 'submission.submitted_at', path)
    if (value.submission.knowledge_impact !== undefined) {
      if (!isStructuredTaskSchema(value.schema_version))
        throw new Error(
          `Invalid submission.knowledge_impact in ${path}: structured task schema is required.`,
        )
      assertKnowledgeImpact(value.submission.knowledge_impact, value.artifacts, path)
    }
    if (value.submission.no_verify !== undefined) {
      if (!isRecord(value.submission.no_verify))
        throw new Error(`Invalid submission.no_verify in ${path}.`)
      requireString(
        value.submission.no_verify.reason,
        'submission.no_verify.reason',
        path,
      )
    }
  }
  if (value.schema_version === V5_SCHEMA_VERSION && value.outcome === 'done') {
    if (value.submission === undefined)
      throw new Error(`Invalid schema 5 done task in ${path}: submission is required.`)
    if (value.closure === undefined)
      throw new Error(`Invalid schema 5 done task in ${path}: closure is required.`)
  }
  if (value.closure !== undefined) {
    if (!isRecord(value.closure)) throw new Error(`Invalid closure in ${path}.`)
    requireString(value.closure.changes, 'closure.changes', path)
    if (typeof value.closure.verified !== 'string')
      throw new Error(`Invalid closure.verified in ${path}.`)
    if (value.schema_version === V5_SCHEMA_VERSION) {
      if (
        Object.hasOwn(value.closure, 'unverified') ||
        Object.hasOwn(value.closure, 'followup')
      )
        throw new Error(`Invalid legacy closeout fields in ${path}.`)
      assertCloseoutResolutions(
        value.closure.resolutions,
        value.closure.unverified_items,
        path,
      )
      if (!value.submission)
        throw new Error(`Invalid closure in ${path}: submission is required.`)
      if (
        JSON.stringify(value.closure.unverified_items) !==
        JSON.stringify(value.submission.unverified_items)
      )
        throw new Error(`Invalid closure.unverified_items in ${path}.`)
    } else {
      if (typeof value.closure.unverified !== 'string')
        throw new Error(`Invalid closure.unverified in ${path}.`)
      if (typeof value.closure.followup !== 'string')
        throw new Error(`Invalid closure.followup in ${path}.`)
      if (
        Object.hasOwn(value.closure, 'unverified_items') ||
        Object.hasOwn(value.closure, 'resolutions')
      )
        throw new Error(`Invalid structured closeout fields in ${path}.`)
    }
    requireString(value.closure.accepted_at, 'closure.accepted_at', path)
  }
}
