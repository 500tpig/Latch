import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import {
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path'
import {
  checkKnowledgeDocument,
  readKnowledgeDocument,
  type KnowledgeFreshness,
} from './knowledge.js'

const DEFAULT_CHAR_BUDGET = 24_000
const TASK_CHAR_BUDGET = 4_000
const ORIENTATION_CHAR_BUDGET = 48_000
const EXPAND_BATCH_CHAR_BUDGET = 8_000
const L1_CHAR_BUDGET = 6_000

const SOURCE_PRIORITY = {
  task: 0,
  knowledge: 1,
  map: 2,
  sibling: 3,
  excerpt: 4,
  expand: 5,
} as const

export type ContextSourceKind = keyof typeof SOURCE_PRIORITY

export type ContextOrientationInput = {
  orientation_id: string
  task_id?: string
  expand_batches: number
  expand_chars_cum: number
}

export type ContextFileSourceRequest = {
  kind: 'map' | 'excerpt' | 'expand'
  path: string
  start_line?: number
  end_line?: number
  reason?: string
}

export type ContextPackRequest = {
  task_id?: string
  orientation?: ContextOrientationInput
  knowledge_paths: string[]
  sources: ContextFileSourceRequest[]
}

export type ContextPackSectionInput = {
  kind: ContextSourceKind
  path?: string
  freshness?: KnowledgeFreshness
  content: string
  reason?: string
}

export type ContextPackSection = Omit<ContextPackSectionInput, 'reason'>

export type ContextPackMeta = {
  task_id?: string
  orientation_id: string
  char_count: number
  char_budget: number
  truncated: boolean
  truncate_note?: string
  sources: Array<{
    kind: ContextSourceKind
    path?: string
    freshness?: KnowledgeFreshness
  }>
  expand_batches: number
  expand_chars_cum: number
  expand_reason?: string
}

export type ContextPack = {
  meta: ContextPackMeta
  sections: ContextPackSection[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error(`Invalid context pack ${field}.`)
  return value
}

function nonNegativeInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`Invalid context pack ${field}.`)
  return value as number
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new Error(`Invalid context pack ${field}.`)
  return value as number
}

export function parseContextPackRequest(value: unknown): ContextPackRequest {
  if (!isRecord(value)) throw new Error('Invalid context pack request.')
  const taskId = value.task_id === undefined
    ? undefined
    : requireString(value.task_id, 'task_id')

  let orientation: ContextOrientationInput | undefined
  if (value.orientation !== undefined) {
    if (!isRecord(value.orientation))
      throw new Error('Invalid context pack orientation.')
    orientation = {
      orientation_id: requireString(
        value.orientation.orientation_id,
        'orientation.orientation_id',
      ),
      ...(value.orientation.task_id === undefined
        ? {}
        : {
            task_id: requireString(
              value.orientation.task_id,
              'orientation.task_id',
            ),
          }),
      expand_batches: nonNegativeInteger(
        value.orientation.expand_batches,
        'orientation.expand_batches',
      ),
      expand_chars_cum: nonNegativeInteger(
        value.orientation.expand_chars_cum,
        'orientation.expand_chars_cum',
      ),
    }
    if (orientation.task_id !== taskId)
      throw new Error('Context pack orientation task_id does not match request task_id.')
  }

  const knowledgePaths = value.knowledge_paths ?? []
  if (
    !Array.isArray(knowledgePaths) ||
    knowledgePaths.some((path) => typeof path !== 'string' || path.trim() === '')
  )
    throw new Error('Invalid context pack knowledge_paths.')

  const rawSources = value.sources ?? []
  if (!Array.isArray(rawSources))
    throw new Error('Invalid context pack sources.')
  const sources = rawSources.map((source, index): ContextFileSourceRequest => {
    if (!isRecord(source))
      throw new Error(`Invalid context pack sources[${index}].`)
    if (source.kind !== 'map' && source.kind !== 'excerpt' && source.kind !== 'expand')
      throw new Error(`Invalid context pack sources[${index}].kind.`)
    const startLine = source.start_line === undefined
      ? undefined
      : positiveInteger(source.start_line, `sources[${index}].start_line`)
    const endLine = source.end_line === undefined
      ? undefined
      : positiveInteger(source.end_line, `sources[${index}].end_line`)
    if (startLine !== undefined && endLine !== undefined && endLine < startLine)
      throw new Error(`Invalid context pack sources[${index}] line range.`)
    const reason = source.reason === undefined
      ? undefined
      : requireString(source.reason, `sources[${index}].reason`)
    if (source.kind === 'expand' && reason === undefined)
      throw new Error(`Context pack sources[${index}].reason is required for expand.`)
    if (source.kind !== 'expand' && reason !== undefined)
      throw new Error(`Context pack sources[${index}].reason requires kind=expand.`)
    return {
      kind: source.kind,
      path: requireString(source.path, `sources[${index}].path`),
      ...(startLine === undefined ? {} : { start_line: startLine }),
      ...(endLine === undefined ? {} : { end_line: endLine }),
      ...(reason === undefined ? {} : { reason }),
    }
  })

  return {
    ...(taskId === undefined ? {} : { task_id: taskId }),
    ...(orientation === undefined ? {} : { orientation }),
    knowledge_paths: [...knowledgePaths] as string[],
    sources,
  }
}

function codePointCount(value: string) {
  return [...value].length
}

function normalizeRelativePath(value: string) {
  let normalized = value.normalize('NFC').replaceAll('\\', '/')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  if (
    normalized === '' ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    isAbsolute(normalized) ||
    normalized.split('/').includes('..')
  )
    throw new Error(`Invalid context source path: ${value}.`)
  normalized = posix.normalize(normalized)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../'))
    throw new Error(`Invalid context source path: ${value}.`)
  return normalized
}

function readContextSource(
  workspaceRoot: string,
  source: ContextFileSourceRequest,
) {
  const root = realpathSync.native(resolve(workspaceRoot))
  const path = normalizeRelativePath(source.path)
  const absolute = resolve(root, ...path.split('/'))
  const fromRoot = relative(root, absolute)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
    throw new Error(`Context source escapes workspace root: ${path}.`)
  if (!existsSync(absolute)) throw new Error(`Context source does not exist: ${path}.`)
  const stats = lstatSync(absolute)
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new Error(`Context source is not a regular file: ${path}.`)
  const canonical = realpathSync.native(absolute)
  const canonicalFromRoot = relative(root, canonical)
  if (
    canonicalFromRoot === '..' ||
    canonicalFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(canonicalFromRoot)
  )
    throw new Error(`Context source escapes workspace root: ${path}.`)

  const text = readFileSync(canonical, 'utf8')
  if (source.start_line === undefined && source.end_line === undefined)
    return { path, content: text }
  const lines = text.split(/\r?\n/)
  const start = source.start_line ?? 1
  const end = source.end_line ?? lines.length
  if (start > lines.length || end > lines.length)
    throw new Error(`Context source line range exceeds ${path}.`)
  return { path, content: lines.slice(start - 1, end).join('\n') }
}

export function loadContextPackSections(
  workspaceRoot: string,
  request: ContextPackRequest,
) {
  const sections: ContextPackSectionInput[] = []
  for (const path of request.knowledge_paths) {
    try {
      const document = readKnowledgeDocument(workspaceRoot, path)
      const check = checkKnowledgeDocument(workspaceRoot, path)
      sections.push({
        kind: 'knowledge',
        path: document.path,
        freshness: check.freshness,
        content: check.freshness === 'retired'
          ? `${check.summary ?? document.path}\n[retired]`
          : document.body,
      })
    } catch (error) {
      sections.push({
        kind: 'knowledge',
        path: normalizeRelativePath(path),
        freshness: 'error',
        content: `Knowledge unavailable: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  for (const source of request.sources) {
    const loaded = readContextSource(workspaceRoot, source)
    sections.push({
      kind: source.kind,
      path: loaded.path,
      content: loaded.content,
      ...(source.reason === undefined ? {} : { reason: source.reason }),
    })
  }
  return sections
}

function truncateContent(value: string, budget: number) {
  const points = [...value]
  if (points.length <= budget) return value
  if (budget <= 0) return ''
  const marker = [...'\n[truncated]']
  if (budget <= marker.length) return marker.slice(0, budget).join('')
  return [
    ...points.slice(0, budget - marker.length),
    ...marker,
  ].join('')
}

function applyLayerBudgets(sections: ContextPackSectionInput[]) {
  let taskRemaining = TASK_CHAR_BUDGET
  let l1Remaining = L1_CHAR_BUDGET
  let truncated = false
  const kept: ContextPackSectionInput[] = []
  for (const section of sections) {
    const currentLength = codePointCount(section.content)
    const l1 = section.kind === 'knowledge' || section.kind === 'map' || section.kind === 'sibling'
    const remaining = section.kind === 'task'
      ? taskRemaining
      : l1
        ? l1Remaining
        : undefined
    if (remaining === undefined) {
      kept.push(section)
      continue
    }
    if (remaining <= 0) {
      truncated = true
      continue
    }
    const content = truncateContent(section.content, remaining)
    if (content !== section.content) truncated = true
    kept.push({ ...section, content })
    const used = Math.min(currentLength, remaining)
    if (section.kind === 'task') taskRemaining -= used
    else l1Remaining -= used
  }
  return { sections: kept, truncated }
}

function sourceMeta(section: ContextPackSection) {
  return {
    kind: section.kind,
    ...(section.path === undefined ? {} : { path: section.path }),
    ...(section.freshness === undefined ? {} : { freshness: section.freshness }),
  }
}

function stabilizeSerialization(pack: ContextPack) {
  let count = pack.meta.char_count
  for (let iteration = 0; iteration < 20; iteration += 1) {
    pack.meta.char_count = count
    const serialized = `${JSON.stringify(pack, null, 2)}\n`
    const next = codePointCount(serialized)
    if (next === count) return serialized
    count = next
  }
  throw new Error('Context pack char_count did not stabilize.')
}

export function buildContextPack(
  request: ContextPackRequest,
  inputSections: ContextPackSectionInput[],
  options: { charBudget?: number } = {},
) {
  const charBudget = options.charBudget ?? DEFAULT_CHAR_BUDGET
  if (!Number.isSafeInteger(charBudget) || charBudget < 256)
    throw new Error('Context pack char budget must be an integer of at least 256.')

  const sections = inputSections
    .map((section, index) => ({ section, index }))
    .sort((left, right) =>
      SOURCE_PRIORITY[left.section.kind] - SOURCE_PRIORITY[right.section.kind] ||
      left.index - right.index,
    )
    .map(({ section }) => ({ ...section }))

  const expandSections = sections.filter((section) => section.kind === 'expand')
  const expandChars = expandSections.reduce(
    (total, section) => total + codePointCount(section.content),
    0,
  )
  if (expandChars > EXPAND_BATCH_CHAR_BUDGET)
    throw new Error(`Context expand batch exceeds ${EXPAND_BATCH_CHAR_BUDGET} code points.`)
  const previousBatches = request.orientation?.expand_batches ?? 0
  const previousChars = request.orientation?.expand_chars_cum ?? 0
  const expandCharsCum = previousChars + expandChars
  if (expandCharsCum > ORIENTATION_CHAR_BUDGET)
    throw new Error(`Context orientation exceeds ${ORIENTATION_CHAR_BUDGET} expand code points.`)

  const layered = applyLayerBudgets(sections)
  const outputSections: ContextPackSection[] = layered.sections.map((section) => ({
    kind: section.kind,
    ...(section.path === undefined ? {} : { path: section.path }),
    ...(section.freshness === undefined ? {} : { freshness: section.freshness }),
    content: section.content,
  }))
  const expandReasons = [...new Set(
    expandSections
      .map((section) => section.reason)
      .filter((reason): reason is string => reason !== undefined),
  )]
  const pack: ContextPack = {
    meta: {
      ...(request.task_id === undefined ? {} : { task_id: request.task_id }),
      orientation_id: request.orientation?.orientation_id ?? randomUUID(),
      char_count: 0,
      char_budget: charBudget,
      truncated: layered.truncated,
      ...(layered.truncated
        ? { truncate_note: 'Content truncated to satisfy context pack budgets.' }
        : {}),
      sources: outputSections.map(sourceMeta),
      expand_batches: previousBatches + (expandSections.length > 0 ? 1 : 0),
      expand_chars_cum: expandCharsCum,
      ...(expandReasons.length === 0
        ? {}
        : { expand_reason: expandReasons.join('; ') }),
    },
    sections: outputSections,
  }

  let serialized = stabilizeSerialization(pack)
  while (codePointCount(serialized) > charBudget) {
    pack.meta.truncated = true
    pack.meta.truncate_note = 'Content truncated to satisfy context pack budgets.'
    const last = pack.sections.at(-1)
    if (!last)
      throw new Error('Context pack metadata exceeds the configured char budget.')
    const excess = codePointCount(serialized) - charBudget
    const target = Math.max(0, codePointCount(last.content) - excess - 16)
    if (target === 0) pack.sections.pop()
    else last.content = truncateContent(last.content, target)
    pack.meta.sources = pack.sections.map(sourceMeta)
    serialized = stabilizeSerialization(pack)
  }

  return { pack, serialized }
}
