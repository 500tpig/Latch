import { createHash } from 'node:crypto'
import {
  existsSync,
  globSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import {
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path'
import { parseDocument } from 'yaml'
import type { TaskV2 } from './types.js'

const FINGERPRINT_ALGORITHM = 'sha256-v1' as const
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.latch',
])

export type KnowledgeFreshness =
  | 'fresh'
  | 'stale'
  | 'baseline_missing'
  | 'error'
  | 'retired'

export type KnowledgeFrontmatter = {
  id: string
  summary: string
  covers: string[]
  status: 'current' | 'stale' | 'retired'
  last_fingerprint: string | null
  last_fingerprint_algo?: typeof FINGERPRINT_ALGORITHM
  provenance: {
    last_verified_task_id: string | null
    last_verified_at: string | null
    optional_commit_sha: string | null
  }
}

export type KnowledgeDocument = {
  path: string
  body: string
  frontmatter?: KnowledgeFrontmatter
  warnings: string[]
}

export type KnowledgeFingerprintResult = {
  path: string
  algorithm: typeof FINGERPRINT_ALGORITHM
  fingerprint: string
  files: string[]
  warnings: string[]
}

export type KnowledgeCheckResult = {
  path: string
  id?: string
  summary?: string
  declared_status?: KnowledgeFrontmatter['status']
  freshness: KnowledgeFreshness
  review_needed: boolean
  algorithm?: typeof FINGERPRINT_ALGORITHM
  baseline?: string | null
  fingerprint?: string
  files: string[]
  warnings: string[]
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string, path: string) {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Invalid knowledge ${field} in ${path}.`)
  return value
}

function nullableString(value: unknown, field: string, path: string) {
  if (value === null) return null
  return requireString(value, field, path)
}

function normalizeRelativePath(value: string, label: string) {
  let normalized = value.normalize('NFC').replaceAll('\\', '/')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  if (
    normalized === '' ||
    normalized.includes('\u0000') ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    isAbsolute(normalized) ||
    normalized.split('/').includes('..')
  )
    throw new Error(`Invalid ${label}: ${value}.`)
  normalized = posix.normalize(normalized)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../'))
    throw new Error(`Invalid ${label}: ${value}.`)
  return normalized
}

function canonicalRoot(workspaceRoot: string) {
  return realpathSync.native(resolve(workspaceRoot))
}

function absoluteWithinRoot(root: string, path: string) {
  const absolute = resolve(root, ...path.split('/'))
  const fromRoot = relative(root, absolute)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
    throw new Error(`Path escapes workspace root: ${path}.`)
  return absolute
}

function requireMarkdownPath(path: string) {
  const normalized = normalizeRelativePath(path, 'knowledge path')
  if (!/\.md(?:own)?$/i.test(normalized))
    throw new Error(`Knowledge path must be Markdown: ${normalized}.`)
  return normalized
}

function splitFrontmatter(source: string, path: string) {
  if (!/^---[ \t]*\r?\n/.test(source))
    return { body: source, warnings: ['frontmatter_missing'] }
  const match = source.match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/,
  )
  if (!match) throw new Error(`Invalid knowledge frontmatter in ${path}: closing --- is missing.`)
  return { yaml: match[1], body: match[2], warnings: [] as string[] }
}

function parseFrontmatter(source: string, path: string) {
  const document = parseDocument(source, {
    prettyErrors: true,
    schema: 'core',
    uniqueKeys: true,
  })
  if (document.errors.length > 0)
    throw new Error(
      `Invalid knowledge frontmatter in ${path}: ${document.errors[0].message}`,
    )
  const value: unknown = document.toJS({ mapAsMap: false })
  if (!isRecord(value)) throw new Error(`Invalid knowledge frontmatter in ${path}.`)

  const id = requireString(value.id, 'id', path)
  const summary = requireString(value.summary, 'summary', path)
  if (
    !Array.isArray(value.covers) ||
    value.covers.some((entry) => typeof entry !== 'string' || entry.trim() === '')
  )
    throw new Error(`Invalid knowledge covers in ${path}.`)
  if (value.status !== 'current' && value.status !== 'stale' && value.status !== 'retired')
    throw new Error(`Invalid knowledge status in ${path}.`)

  const baselineMissing = !Object.hasOwn(value, 'last_fingerprint')
  const lastFingerprint = baselineMissing
    ? null
    : nullableString(value.last_fingerprint, 'last_fingerprint', path)
  if (lastFingerprint !== null && !/^[a-f0-9]{64}$/.test(lastFingerprint))
    throw new Error(`Invalid knowledge last_fingerprint in ${path}.`)
  const algorithm = value.last_fingerprint_algo
  if (algorithm !== undefined && algorithm !== FINGERPRINT_ALGORITHM)
    throw new Error(`Unsupported knowledge fingerprint algorithm in ${path}: ${String(algorithm)}.`)
  if (lastFingerprint !== null && algorithm !== FINGERPRINT_ALGORITHM)
    throw new Error(`Missing knowledge last_fingerprint_algo in ${path}.`)

  if (!isRecord(value.provenance))
    throw new Error(`Invalid knowledge provenance in ${path}.`)
  const verifiedTaskId = nullableString(
    value.provenance.last_verified_task_id,
    'provenance.last_verified_task_id',
    path,
  )
  const verifiedAt = nullableString(
    value.provenance.last_verified_at,
    'provenance.last_verified_at',
    path,
  )
  if (verifiedAt !== null && Number.isNaN(Date.parse(verifiedAt)))
    throw new Error(`Invalid knowledge provenance.last_verified_at in ${path}.`)
  const commitSha = nullableString(
    value.provenance.optional_commit_sha,
    'provenance.optional_commit_sha',
    path,
  )

  return {
    frontmatter: {
      id,
      summary,
      covers: [...value.covers] as string[],
      status: value.status,
      last_fingerprint: lastFingerprint,
      ...(algorithm === FINGERPRINT_ALGORITHM
        ? { last_fingerprint_algo: algorithm }
        : {}),
      provenance: {
        last_verified_task_id: verifiedTaskId,
        last_verified_at: verifiedAt,
        optional_commit_sha: commitSha,
      },
    } satisfies KnowledgeFrontmatter,
    warnings: [
      ...document.warnings.map((warning) => `frontmatter_warning: ${warning.message}`),
      ...(baselineMissing ? ['last_fingerprint_missing'] : []),
      ...(algorithm === undefined ? ['last_fingerprint_algo_missing'] : []),
    ],
  }
}

export function readKnowledgeDocument(
  workspaceRoot: string,
  inputPath: string,
): KnowledgeDocument {
  const root = canonicalRoot(workspaceRoot)
  const path = requireMarkdownPath(inputPath)
  const absolute = absoluteWithinRoot(root, path)
  if (!existsSync(absolute))
    throw new Error(`Knowledge path does not exist: ${path}.`)
  const stats = lstatSync(absolute)
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new Error(`Knowledge path is not a regular file: ${path}.`)
  const split = splitFrontmatter(readFileSync(absolute, 'utf8'), path)
  if (split.yaml === undefined)
    return { path, body: split.body, warnings: split.warnings }
  const parsed = parseFrontmatter(split.yaml, path)
  return {
    path,
    body: split.body,
    frontmatter: parsed.frontmatter,
    warnings: [...split.warnings, ...parsed.warnings],
  }
}

function excluded(path: string) {
  return path.split('/').some((segment) => EXCLUDED_DIRECTORIES.has(segment))
}

function validateGlob(pattern: string, source: string) {
  if (/[?\[\]()]/.test(pattern))
    throw new Error(`Unsupported knowledge cover glob in ${source}: ${pattern}.`)
  const segments = pattern.split('/')
  const recursive = segments.filter((segment) => segment === '**').length
  if (
    recursive > 1 ||
    segments.some((segment) => segment.includes('**') && segment !== '**')
  )
    throw new Error(`Unsupported knowledge cover glob in ${source}: ${pattern}.`)
  for (const segment of segments.slice(0, -1))
    if (
      (segment.includes('*') || segment.includes('{') || segment.includes('}')) &&
      segment !== '**'
    )
      throw new Error(`Unsupported knowledge cover glob in ${source}: ${pattern}.`)
  const name = segments.at(-1) ?? ''
  const withoutBraces = name.replace(/\{[^{}]+\}/g, '')
  if (
    withoutBraces.includes('{') ||
    withoutBraces.includes('}') ||
    [...name.matchAll(/\{([^{}]+)\}/g)].some((match) =>
      match[1].split(',').some((part) => !/^[A-Za-z0-9._-]+$/.test(part)),
    )
  )
    throw new Error(`Unsupported knowledge cover glob in ${source}: ${pattern}.`)
}

type FingerprintFile = { path: string; absolute: string }

function addRegularFile(
  root: string,
  rawPath: string,
  source: string,
  files: Map<string, FingerprintFile>,
) {
  const path = normalizeRelativePath(rawPath, `knowledge cover in ${source}`)
  if (excluded(path)) return false
  const absolute = absoluteWithinRoot(root, path)
  if (!existsSync(absolute)) return false
  const stats = lstatSync(absolute)
  if (stats.isSymbolicLink())
    throw new Error(`Knowledge cover matched a symlink in ${source}: ${path}.`)
  if (!stats.isFile()) return false
  const canonical = realpathSync.native(absolute)
  const fromRoot = relative(root, canonical)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
    throw new Error(`Knowledge cover escapes workspace root in ${source}: ${path}.`)
  const existing = files.get(path)
  if (existing && existing.absolute !== canonical)
    throw new Error(`Knowledge cover has duplicate NFC path in ${source}: ${path}.`)
  files.set(path, { path, absolute: canonical })
  return true
}

function walkDirectory(
  root: string,
  directory: string,
  source: string,
  files: Map<string, FingerprintFile>,
) {
  const absolute = absoluteWithinRoot(root, directory)
  if (!existsSync(absolute))
    throw new Error(`Knowledge cover directory is invalid in ${source}: ${directory}/.`)
  const stats = lstatSync(absolute)
  if (stats.isSymbolicLink() || !stats.isDirectory())
    throw new Error(`Knowledge cover directory is invalid in ${source}: ${directory}/.`)
  let matched = 0
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = `${directory}/${entry.name}`
    const normalized = normalizeRelativePath(child, `knowledge cover in ${source}`)
    if (excluded(normalized) || entry.isSymbolicLink()) continue
    if (entry.isDirectory())
      matched += walkDirectory(root, normalized, source, files)
    else if (entry.isFile() && addRegularFile(root, normalized, source, files))
      matched += 1
  }
  return matched
}

function expandCovers(root: string, covers: string[], source: string) {
  const files = new Map<string, FingerprintFile>()
  const warnings: string[] = []
  if (covers.length === 0) warnings.push('covers_empty')

  for (const rawCover of covers) {
    const directory = rawCover.replaceAll('\\', '/').endsWith('/')
    const cover = normalizeRelativePath(rawCover, `knowledge cover in ${source}`)
    if (excluded(cover))
      throw new Error(`Knowledge cover uses an excluded directory in ${source}: ${cover}.`)
    let matched = 0
    if (directory) {
      matched = walkDirectory(root, cover, source, files)
    } else if (/[*{}?\[\]()]/.test(cover)) {
      validateGlob(cover, source)
      const matches = globSync(cover, { cwd: root })
      for (const match of matches)
        if (addRegularFile(root, match, source, files)) matched += 1
    } else {
      if (addRegularFile(root, cover, source, files)) matched += 1
    }
    if (matched === 0)
      throw new Error(`Knowledge cover matched no regular files in ${source}: ${cover}.`)
  }

  return {
    files: [...files.values()].sort((left, right) =>
      Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
    ),
    warnings,
  }
}

function fingerprintFiles(files: FingerprintFile[]) {
  const aggregate = createHash('sha256')
  for (const file of files) {
    const contentHash = createHash('sha256')
      .update(readFileSync(file.absolute))
      .digest('hex')
    aggregate.update(file.path, 'utf8')
    aggregate.update('\u0000')
    aggregate.update(contentHash, 'utf8')
    aggregate.update('\n')
  }
  return aggregate.digest('hex')
}

export function fingerprintKnowledgeDocument(
  workspaceRoot: string,
  inputPath: string,
): KnowledgeFingerprintResult {
  const root = canonicalRoot(workspaceRoot)
  const document = readKnowledgeDocument(root, inputPath)
  if (!document.frontmatter)
    throw new Error(`Knowledge frontmatter with covers is required in ${document.path}.`)
  const expanded = expandCovers(root, document.frontmatter.covers, document.path)
  return {
    path: document.path,
    algorithm: FINGERPRINT_ALGORITHM,
    fingerprint: fingerprintFiles(expanded.files),
    files: expanded.files.map((file) => file.path),
    warnings: [...document.warnings, ...expanded.warnings],
  }
}

export function checkKnowledgeDocument(
  workspaceRoot: string,
  inputPath: string,
): KnowledgeCheckResult {
  const document = readKnowledgeDocument(workspaceRoot, inputPath)
  if (!document.frontmatter)
    return {
      path: document.path,
      freshness: 'baseline_missing',
      review_needed: true,
      files: [],
      warnings: document.warnings,
    }

  const common = {
    path: document.path,
    id: document.frontmatter.id,
    summary: document.frontmatter.summary,
    declared_status: document.frontmatter.status,
    baseline: document.frontmatter.last_fingerprint,
  }
  if (document.frontmatter.status === 'retired')
    return {
      ...common,
      freshness: 'retired',
      review_needed: false,
      files: [],
      warnings: document.warnings,
    }

  let fingerprint: KnowledgeFingerprintResult
  try {
    fingerprint = fingerprintKnowledgeDocument(workspaceRoot, document.path)
  } catch (error) {
    return {
      ...common,
      freshness: document.frontmatter.status === 'stale' ? 'stale' : 'error',
      review_needed: true,
      files: [],
      warnings: document.warnings,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const freshness: KnowledgeFreshness =
    document.frontmatter.status === 'stale'
      ? 'stale'
      : document.frontmatter.last_fingerprint === null
        ? 'baseline_missing'
        : document.frontmatter.last_fingerprint === fingerprint.fingerprint
          ? 'fresh'
          : 'stale'
  return {
    ...common,
    freshness,
    review_needed: freshness !== 'fresh',
    algorithm: fingerprint.algorithm,
    fingerprint: fingerprint.fingerprint,
    files: fingerprint.files,
    warnings: fingerprint.warnings,
  }
}

export function checkTaskKnowledgeDocuments(
  workspaceRoot: string,
  task: TaskV2,
) {
  const impact = task.submission?.knowledge_impact
  if (!impact) throw new Error(`Task ${task.id} does not have submission knowledge_impact.`)
  if (impact.kind !== 'updated')
    throw new Error(`Task ${task.id} knowledge_impact is not updated.`)
  return {
    task_id: task.id,
    documents: impact.artifact_refs.map((artifact) => ({
      artifact,
      ...checkKnowledgeDocument(workspaceRoot, artifact.path),
    })),
  }
}
