import { Buffer } from 'node:buffer'

export type ContextViewKind = 'status' | 'review' | 'brief'

export const CONTEXT_VIEW_BYTE_BUDGETS: Record<ContextViewKind, number> = {
  status: 3072,
  review: 6144,
  brief: 8192,
}

export const CONTEXT_VIEW_COLLECTION_LIMITS: Record<
  ContextViewKind,
  {
    sharedWorktree: number
    liveChanges: number
    artifactDelivery: number
    warnings: number
    gates: number
    openQuestions: number
    artifacts: number
    closeout: number
  }
> = {
  status: {
    sharedWorktree: 4,
    liveChanges: 4,
    artifactDelivery: 4,
    warnings: 2,
    gates: 0,
    openQuestions: 0,
    artifacts: 0,
    closeout: 0,
  },
  review: {
    sharedWorktree: 4,
    liveChanges: 4,
    artifactDelivery: 8,
    warnings: 4,
    gates: 8,
    openQuestions: 0,
    artifacts: 0,
    closeout: 8,
  },
  brief: {
    sharedWorktree: 8,
    liveChanges: 8,
    artifactDelivery: 8,
    warnings: 4,
    gates: 16,
    openQuestions: 8,
    artifacts: 8,
    closeout: 8,
  },
}

const MAX_TRUNCATION_FIELDS = 16
const GROUPS = [
  'identity',
  'writer',
  'plan_text',
  'gates',
  'submission',
  'closeout',
  'shared_worktree',
  'live_changes',
  'artifact_delivery',
  'warnings',
  'error',
  'misc',
] as const

type ProjectionGroup = (typeof GROUPS)[number]

type TruncationField = {
  path: ProjectionGroup
  original_bytes?: number
  total_count?: number
  returned_count?: number
}

type ProjectionObject = Record<string, unknown>

function isObject(value: unknown): value is ProjectionObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonBytes(value: unknown) {
  return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function boundedUtf8(value: string, limit: number) {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= limit) return value
  let end = limit
  while (end > 0) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(0, end),
      )
    } catch {
      end -= 1
    }
  }
  return ''
}

function pathParts(path: string) {
  return path.split('.').filter(Boolean)
}

function getPath(root: ProjectionObject, path: string) {
  let value: unknown = root
  for (const part of pathParts(path)) {
    if (!isObject(value)) return undefined
    value = value[part]
  }
  return value
}

function setPath(root: ProjectionObject, path: string, value: unknown) {
  const parts = pathParts(path)
  const key = parts.pop()
  if (!key) return
  let current = root
  for (const part of parts) {
    const next = current[part]
    if (!isObject(next)) return
    current = next
  }
  current[key] = value
}

function deletePath(root: ProjectionObject, path: string) {
  const parts = pathParts(path)
  const key = parts.pop()
  if (!key) return undefined
  let current = root
  for (const part of parts) {
    const next = current[part]
    if (!isObject(next)) return undefined
    current = next
  }
  const value = current[key]
  delete current[key]
  return value
}

function projectionGroup(path: string): ProjectionGroup {
  if (
    path === 'task.id' ||
    path === 'task.task_id' ||
    path.endsWith('.item_id') ||
    path.endsWith('.revision')
  ) return 'identity'
  if (path.includes('writer') || path.includes('authorization')) return 'writer'
  if (
    path.includes('goal') ||
    path.includes('scope') ||
    path.includes('acceptance') ||
    path.includes('approach') ||
    path.includes('open_questions') ||
    path.includes('user_flow')
  ) return 'plan_text'
  if (path.includes('gate') || path.includes('verification')) return 'gates'
  if (path.includes('submission') || path.includes('knowledge')) return 'submission'
  if (path.includes('closeout') || path.includes('resolution') || path.includes('unverified')) return 'closeout'
  if (path.includes('shared_worktree')) return 'shared_worktree'
  if (path.includes('live_changes')) return 'live_changes'
  if (path.includes('artifact')) return 'artifact_delivery'
  if (path.includes('warning')) return 'warnings'
  if (path.includes('error')) return 'error'
  return 'misc'
}

function fieldLimit(path: string, key: string, value: string) {
  if (path === 'task.id' || key === 'task_id' || key === 'item_id') return 256
  if (key === 'title') return 256
  if (key === 'name' && path.includes('verification')) return 128
  if (
    key === 'primary_writer' ||
    key === 'caller' ||
    key === 'accepted_by' ||
    key === 'owner'
  ) return 256
  if (key === 'path' || key === 'current_path' || key === 'other_path') return 512
  if (
    key === 'kind' ||
    key === 'enum' ||
    key === 'code' ||
    key === 'command' ||
    key === 'mode' ||
    key === 'phase' ||
    key === 'status' ||
    key === 'profile' ||
    key === 'outcome'
  ) return 64
  if (
    key === 'warning' ||
    key === 'reason' ||
    key === 'waiting_for' ||
    key === 'blocked_reason' ||
    key === 'authorization_reason'
  ) return 256
  if (key === 'message' && path.startsWith('error')) return 2048
  if (
    key === 'changes' ||
    key === 'knowledge' ||
    key === 'knowledge_impact'
  ) return 1024
  if (
    key === 'question' ||
    key === 'summary' ||
    key === 'resolution' ||
    key === 'feedback' ||
    key === 'answer' ||
    key === 'conclusion'
  ) return 512
  return value.length > 0 ? undefined : undefined
}

function addFieldBytes(fields: Map<ProjectionGroup, TruncationField>, path: string, bytes: number) {
  const group = projectionGroup(path)
  const current = fields.get(group) ?? { path: group }
  current.original_bytes = (current.original_bytes ?? 0) + bytes
  fields.set(group, current)
}

function addCollection(
  fields: Map<ProjectionGroup, TruncationField>,
  path: string,
  total: number,
  returned: number,
) {
  const group = projectionGroup(path)
  const current = fields.get(group) ?? { path: group }
  current.total_count = (current.total_count ?? 0) + total
  current.returned_count = (current.returned_count ?? 0) + returned
  fields.set(group, current)
}

function truncateFields(
  value: ProjectionObject,
  fields: Map<ProjectionGroup, TruncationField>,
  path = '',
) {
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (typeof child === 'string') {
      const limit = fieldLimit(childPath, key, child)
      if (limit !== undefined) {
        const originalBytes = Buffer.byteLength(child, 'utf8')
        if (originalBytes > limit) {
          if (
            childPath === 'task.id' ||
            key === 'task_id' ||
            key === 'kind' ||
            key === 'enum' ||
            key === 'code' ||
            key === 'command' ||
            key === 'mode'
          )
            throw new Error(`Projection token ${childPath} exceeds ${limit} UTF-8 bytes.`)
          value[key] = boundedUtf8(child, limit)
          addFieldBytes(fields, childPath, originalBytes)
        }
      }
      continue
    }
    if (Array.isArray(child)) {
      for (let index = 0; index < child.length; index += 1) {
        const item = child[index]
        if (typeof item === 'string') {
          const limit = fieldLimit(`${childPath}.${index}`, key, item)
          if (limit !== undefined) {
            const originalBytes = Buffer.byteLength(item, 'utf8')
            if (originalBytes > limit) {
              if (key === 'command' || key === 'kind' || key === 'code' || key === 'mode')
                throw new Error(`Projection token ${childPath}.${index} exceeds ${limit} UTF-8 bytes.`)
              child[index] = boundedUtf8(item, limit)
              addFieldBytes(fields, childPath, originalBytes)
            }
          }
        } else if (isObject(item)) {
          truncateFields(item, fields, `${childPath}.${index}`)
        }
      }
      continue
    }
    if (isObject(child)) truncateFields(child, fields, childPath)
  }
}

function updateBoundedSample(
  parent: ProjectionObject,
  limit: number,
  path: string,
  fields: Map<ProjectionGroup, TruncationField>,
) {
  if (!Array.isArray(parent.sample)) return
  const total = typeof parent.total_count === 'number'
    ? parent.total_count
    : typeof parent.total === 'number'
      ? parent.total
      : parent.sample.length
  const original = parent.sample.length
  const returned = Math.min(total, limit, original)
  parent.total_count = total
  parent.returned_count = returned
  parent.sample_limit = limit
  parent.sample = parent.sample.slice(0, limit)
  parent.truncated = total > returned || original > returned
  if (parent.truncated) addCollection(fields, path, total, returned)
}

function applyBoundedSamples(
  value: ProjectionObject,
  view: ContextViewKind,
  fields: Map<ProjectionGroup, TruncationField>,
) {
  const limits = CONTEXT_VIEW_COLLECTION_LIMITS[view]
  const paths: Array<[string, number]> = [
    ['task.shared_worktree', limits.sharedWorktree],
    ['task.workspace_proof.live_changes', limits.liveChanges],
    ['task.schema5_view.unverified_items', limits.closeout],
    ['task.schema5_view.closeout.resolutions', limits.closeout],
    ['task.submission.unverified_items_summary', limits.closeout],
    ['task.closure.closeout_summary.resolutions', limits.closeout],
  ]
  for (const [path, limit] of paths) {
    const parent = getPath(value, path)
    if (isObject(parent)) updateBoundedSample(parent, limit, path, fields)
  }
}

function applyDirectCollectionLimits(
  value: ProjectionObject,
  view: ContextViewKind,
  fields: Map<ProjectionGroup, TruncationField>,
) {
  const limits = CONTEXT_VIEW_COLLECTION_LIMITS[view]
  const rules: Array<[string, number]> = [
    ['artifact_delivery', limits.artifactDelivery],
    ['warnings', limits.warnings],
    ['task.verification_plan', limits.gates],
    ['task.plan.verification_plan', limits.gates],
    ['task.open_questions', limits.openQuestions],
    ['task.plan.open_questions', limits.openQuestions],
    ['task.artifacts', limits.artifacts],
    ['recent_events', view === 'brief' ? 8 : limits.gates],
    ['timeline', view === 'brief' ? 8 : limits.gates],
  ]
  for (const [path, limit] of rules) {
    if (limit <= 0) continue
    const current = getPath(value, path)
    if (Array.isArray(current) && current.length > limit) {
      setPath(value, path, current.slice(0, limit))
      addCollection(fields, path, current.length, limit)
    }
  }
  for (const path of ['task.verification.gate', 'task.verification.diagnostic']) {
    const current = getPath(value, path)
    if (!isObject(current) || limits.gates <= 0) continue
    const entries = Object.entries(current)
    if (entries.length <= limits.gates) continue
    setPath(
      value,
      path,
      Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)).slice(0, limits.gates)),
    )
    addCollection(fields, path, entries.length, limits.gates)
  }
}

function addTruncation(value: ProjectionObject, fields: Map<ProjectionGroup, TruncationField>) {
  if (fields.size === 0) return
  const ordered = [...fields.values()].sort((left, right) => left.path.localeCompare(right.path))
  if (ordered.length > MAX_TRUNCATION_FIELDS)
    throw new Error(`Context projection requires ${ordered.length} truncation groups; maximum is ${MAX_TRUNCATION_FIELDS}.`)
  value.truncation = { applied: true, fields: ordered }
}

function clearOptional(
  value: ProjectionObject,
  path: string,
  fields: Map<ProjectionGroup, TruncationField>,
) {
  const original = deletePath(value, path)
  if (original === undefined) return false
  addFieldBytes(fields, path, jsonBytes(original))
  return true
}

function clearSample(
  value: ProjectionObject,
  path: string,
  fields: Map<ProjectionGroup, TruncationField>,
) {
  const parent = getPath(value, path)
  if (!isObject(parent) || !Array.isArray(parent.sample) || parent.sample.length === 0)
    return false
  const total = typeof parent.total_count === 'number'
    ? parent.total_count
    : typeof parent.total === 'number'
      ? parent.total
      : parent.sample.length
  addCollection(fields, path, total, 0)
  parent.sample = []
  parent.returned_count = 0
  parent.truncated = true
  return true
}

function clearArray(
  value: ProjectionObject,
  path: string,
  fields: Map<ProjectionGroup, TruncationField>,
) {
  const current = getPath(value, path)
  if (!Array.isArray(current) || current.length === 0) return false
  addCollection(fields, path, current.length, 0)
  setPath(value, path, [])
  return true
}

/**
 * Fixed clamp order from the consolidation contract §7.4:
 * workspace samples → warnings → artifact delivery → gate detail → plan summary →
 * submission/knowledge summaries → unverified/closeout item bodies (last).
 * History is optional diagnostic content and is cleared with workspace samples.
 * All views share this order so review closeout samples are not sacrificed early.
 */
function freeOptionalContent(
  value: ProjectionObject,
  fields: Map<ProjectionGroup, TruncationField>,
): boolean {
  const workspaceSamples = [
    'task.shared_worktree',
    'task.workspace_proof.live_changes',
  ]
  const closeoutSamples = [
    'task.schema5_view.unverified_items',
    'task.schema5_view.closeout.resolutions',
    'task.submission.unverified_items_summary',
    'task.closure.closeout_summary.resolutions',
  ]
  const operations: Array<() => boolean> = [
    () => workspaceSamples.some((path) => clearSample(value, path, fields)),
    () =>
      clearOptional(value, 'recent_events', fields) ||
      clearOptional(value, 'timeline', fields),
    () => clearArray(value, 'warnings', fields),
    () => clearArray(value, 'artifact_delivery', fields),
    () =>
      clearOptional(value, 'task.verification_plan', fields) ||
      clearOptional(value, 'task.verification', fields),
    () =>
      clearOptional(value, 'task.workspace_scope', fields) ||
      clearOptional(value, 'task.scope', fields) ||
      clearOptional(value, 'task.acceptance', fields) ||
      clearOptional(value, 'task.approach', fields) ||
      clearOptional(value, 'task.user_flow', fields) ||
      clearOptional(value, 'task.open_questions', fields) ||
      clearOptional(value, 'task.goal', fields) ||
      clearOptional(value, 'task.implementation_approval', fields) ||
      clearOptional(value, 'task.work_basis', fields) ||
      clearOptional(value, 'task.authorization.reason', fields) ||
      clearOptional(value, 'task.authorization.source', fields),
    () =>
      clearOptional(value, 'task.submission.changes', fields) ||
      clearOptional(value, 'task.submission.verified', fields) ||
      clearOptional(value, 'task.submission.knowledge_impact', fields) ||
      clearOptional(value, 'task.closure.changes', fields) ||
      clearOptional(value, 'task.closure.verified', fields) ||
      clearOptional(value, 'task.submission.unverified_summary', fields) ||
      clearOptional(value, 'task.closure.resolution_summary', fields),
    () => closeoutSamples.some((path) => clearSample(value, path, fields)),
    () =>
      clearOptional(value, 'task.submission.unverified_items_summary', fields) ||
      clearOptional(value, 'task.closure.closeout_summary.resolutions', fields),
    // Display-heavy fields after routing-critical optionals. Keep writer/authorization
    // status enums, phase, revisions, gate counts, next_action, and task id.
    () =>
      clearOptional(value, 'task.title', fields) ||
      clearOptional(value, 'task.writer.primary_writer', fields) ||
      clearOptional(value, 'task.writer.caller', fields) ||
      clearOptional(value, 'task.blocked.reason', fields) ||
      clearOptional(value, 'task.blocked.waiting_for', fields) ||
      clearOptional(value, 'task.workspace_proof.live_changes', fields) ||
      clearOptional(value, 'task.after_takeover_next_action', fields) ||
      clearOptional(value, 'task.updated_at', fields) ||
      clearOptional(value, 'task.min_writer_version', fields) ||
      clearOptional(value, 'task.provenance', fields),
  ]
  for (const operation of operations) {
    if (operation()) return true
  }
  return false
}

function measuredBytes(
  value: ProjectionObject,
  fields: Map<ProjectionGroup, TruncationField>,
) {
  const clone = structuredClone(value)
  delete clone.truncation
  addTruncation(clone, fields)
  return jsonBytes(clone)
}

export function projectBoundedContext(
  input: ProjectionObject,
  view: ContextViewKind,
) {
  const value = structuredClone(input)
  const fields = new Map<ProjectionGroup, TruncationField>()
  truncateFields(value, fields)
  applyBoundedSamples(value, view, fields)
  applyDirectCollectionLimits(value, view, fields)
  const budget = CONTEXT_VIEW_BYTE_BUDGETS[view]
  let attempts = 0
  while (measuredBytes(value, fields) > budget && attempts < 64) {
    if (!freeOptionalContent(value, fields)) break
    attempts += 1
  }
  delete value.truncation
  addTruncation(value, fields)
  if (jsonBytes(value) > budget)
    throw new Error(
      `Context ${view} projection exceeds ${budget} UTF-8 bytes after mandatory-field clamp.`,
    )
  return value
}

export function contextJsonByteLength(value: unknown) {
  return jsonBytes(value)
}
