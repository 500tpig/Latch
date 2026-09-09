import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
} from 'node:fs'
import { join, normalize, relative, sep } from 'node:path'
import type {
  TaskArtifact,
  WorkspaceDelta,
  WorkspaceEntry,
  WorkspaceEvidenceRef,
  WorkspacePathChange,
  WorkspaceScope,
  WorkspaceSnapshot,
} from './types.js'
import { now, writeTextAtomic } from './utils.js'

type GitStatusEntry = {
  path: string
  originalPath?: string
  source: 'git_status'
  indexState: string
  worktreeState: string
  mode?: string
  indexFingerprint?: string
  submoduleState?: string
  untracked: boolean
}

export type WorkspaceCaptureOptions = {
  gitCommand?: string
}

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function runGit(
  workspaceRoot: string,
  args: string[],
  gitCommand = 'git',
) {
  const result = spawnSync(gitCommand, args, {
    cwd: workspaceRoot,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      Buffer.from(result.stderr ?? '').toString('utf8').trim() ||
        `git ${args[0]} exited ${result.status ?? 127}`,
    )
  return Buffer.from(result.stdout ?? '')
}

function gitStatus(workspaceRoot: string, gitCommand?: string) {
  return runGit(
    workspaceRoot,
    ['status', '--porcelain=v2', '-z', '--untracked-files=all'],
    gitCommand,
  )
}

function gitScopePaths(
  workspaceRoot: string,
  scope: WorkspaceScope,
  gitCommand?: string,
) {
  if (scope.paths.length === 0) return []
  return runGit(
    workspaceRoot,
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ...scope.paths,
    ],
    gitCommand,
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
}

function parsePath(record: string, fieldsBeforePath: number) {
  const fields = record.split(' ')
  if (fields.length <= fieldsBeforePath)
    throw new Error(`Invalid porcelain v2 record: ${record}`)
  return fields.slice(fieldsBeforePath).join(' ')
}

export function parseGitStatusPorcelainV2(value: Buffer | string) {
  const records = Buffer.isBuffer(value)
    ? value.toString('utf8').split('\0')
    : value.split('\0')
  const entries: GitStatusEntry[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record || record.startsWith('# ')) continue
    const tag = record[0]
    if (tag === '?') {
      entries.push({
        path: record.slice(2),
        source: 'git_status',
        indexState: '?',
        worktreeState: '?',
        untracked: true,
      })
      continue
    }
    if (tag === '1') {
      const fields = record.split(' ')
      entries.push({
        path: parsePath(record, 8),
        source: 'git_status',
        indexState: fields[1]?.[0] ?? '.',
        worktreeState: fields[1]?.[1] ?? '.',
        submoduleState: fields[2],
        mode: fields[5],
        indexFingerprint: fields[7],
        untracked: false,
      })
      continue
    }
    if (tag === '2') {
      const fields = record.split(' ')
      const originalPath = records[index + 1]
      if (originalPath === undefined)
        throw new Error(`Missing rename origin for ${record}`)
      index += 1
      entries.push({
        path: parsePath(record, 9),
        originalPath,
        source: 'git_status',
        indexState: fields[1]?.[0] ?? '.',
        worktreeState: fields[1]?.[1] ?? '.',
        submoduleState: fields[2],
        mode: fields[5],
        indexFingerprint: fields[7],
        untracked: false,
      })
      continue
    }
    if (tag === 'u') {
      const fields = record.split(' ')
      entries.push({
        path: parsePath(record, 10),
        source: 'git_status',
        indexState: fields[1]?.[0] ?? 'U',
        worktreeState: fields[1]?.[1] ?? 'U',
        submoduleState: fields[2],
        mode: fields[6],
        indexFingerprint: fields[8],
        untracked: false,
      })
      continue
    }
    throw new Error(`Unsupported porcelain v2 record: ${record}`)
  }
  return entries.filter(
    (entry) => entry.path !== '.latch' && !entry.path.startsWith('.latch/'),
  )
}

export function pathInWorkspaceScope(path: string, scope: WorkspaceScope) {
  return scope.paths.some((candidate) =>
    candidate.endsWith('/')
      ? path.startsWith(candidate)
      : path === candidate,
  )
}

export function workspaceScopeDescendantCandidate(
  path: string,
  scope: WorkspaceScope,
) {
  let match: string | undefined
  for (const candidate of scope.paths) {
    if (
      candidate.endsWith('/') ||
      !path.startsWith(`${candidate}/`)
    )
      continue
    if (!match || candidate.length > match.length) match = candidate
  }
  return match
}

function explicitIgnoredCandidates(
  scope: WorkspaceScope,
  artifacts: TaskArtifact[],
) {
  const values = new Map<string, 'workspace_scope' | 'artifact'>()
  for (const path of scope.paths)
    if (!path.endsWith('/')) values.set(path, 'workspace_scope')
  for (const artifact of artifacts)
    if (!artifact.path.endsWith('/') && !values.has(artifact.path))
      values.set(artifact.path, 'artifact')
  return values
}

function isIgnored(
  workspaceRoot: string,
  path: string,
  gitCommand?: string,
) {
  const result = spawnSync(
    gitCommand ?? 'git',
    ['check-ignore', '-q', '--', path],
    {
      cwd: workspaceRoot,
      stdio: 'ignore',
    },
  )
  if (result.error) throw result.error
  if (result.status === 0) return true
  if (result.status === 1) return false
  throw new Error(`git check-ignore exited ${result.status ?? 127} for ${path}`)
}

function statFingerprint(path: string) {
  try {
    const stat = lstatSync(path, { bigint: true })
    return [
      stat.dev,
      stat.ino,
      stat.mode,
      stat.size,
      stat.mtimeNs,
      stat.ctimeNs,
    ].join(':')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}

function fileEvidence(
  workspaceRoot: string,
  status: GitStatusEntry,
  scope: WorkspaceScope,
  source: WorkspaceEntry['source'] = 'git_status',
): WorkspaceEntry {
  const absolutePath = join(workspaceRoot, status.path)
  const beforeStat = statFingerprint(absolutePath)
  let exists = beforeStat !== 'missing'
  let fileType: WorkspaceEntry['file_type'] = 'missing'
  let contentSha256: string | undefined
  let mode = status.mode
  if (exists) {
    const stat = lstatSync(absolutePath)
    mode ??= (stat.mode & 0o777777).toString(8)
    if (status.submoduleState && status.submoduleState !== 'N...') {
      fileType = 'submodule'
    } else if (stat.isSymbolicLink()) {
      fileType = 'symlink'
      contentSha256 = sha256(readlinkSync(absolutePath))
    } else if (stat.isFile()) {
      fileType = 'file'
      contentSha256 = sha256(readFileSync(absolutePath))
    } else if (stat.isDirectory()) {
      fileType = 'directory'
    }
  }
  const afterStat = statFingerprint(absolutePath)
  if (beforeStat !== afterStat)
    throw new Error(`Workspace path changed during evidence capture: ${status.path}`)
  exists = afterStat !== 'missing'
  return {
    path: status.path,
    scope: pathInWorkspaceScope(status.path, scope)
      ? 'in_scope'
      : 'out_of_scope',
    source,
    index_state: status.indexState,
    worktree_state: status.worktreeState,
    file_type: fileType,
    exists,
    ...(mode ? { mode } : {}),
    ...(contentSha256 ? { content_sha256: contentSha256 } : {}),
    ...(status.indexFingerprint && !/^0+$/.test(status.indexFingerprint)
      ? { index_fingerprint: status.indexFingerprint }
      : {}),
    ...(status.submoduleState
      ? { submodule_state: status.submoduleState }
      : {}),
    ...(status.originalPath ? { original_path: status.originalPath } : {}),
  }
}

function captureScopeEntries(
  workspaceRoot: string,
  scope: WorkspaceScope,
  parsed: GitStatusEntry[],
  capturedEntries: Map<string, WorkspaceEntry>,
  gitCommand?: string,
) {
  const statusEntries = new Map(parsed.map((entry) => [entry.path, entry]))
  const paths = new Set(gitScopePaths(workspaceRoot, scope, gitCommand))
  for (const candidate of scope.paths)
    if (!candidate.endsWith('/')) paths.add(candidate)
  for (const entry of capturedEntries.values())
    if (entry.scope === 'in_scope') paths.add(entry.path)

  return [...paths]
    .filter((path) => pathInWorkspaceScope(path, scope))
    .sort()
    .map((path) => {
      const captured = capturedEntries.get(path)
      if (captured) return captured
      return fileEvidence(
        workspaceRoot,
        statusEntries.get(path) ?? {
          path,
          source: 'git_status',
          indexState: '.',
          worktreeState: '.',
          untracked: false,
        },
        scope,
        'workspace_scope',
      )
    })
}

function incompleteSnapshot(error: unknown): WorkspaceSnapshot {
  return {
    provider: 'git-v1',
    captured_at: now(),
    complete: false,
    coverage: {
      git_visible: true,
      explicit_ignored_files: true,
      ignored_tree: false,
    },
    counts: {
      tracked_dirty: 0,
      untracked: 0,
      explicit_ignored: 0,
      in_scope: 0,
      out_of_scope: 0,
    },
    entries: [],
    error: error instanceof Error ? error.message : String(error),
  }
}

export function captureWorkspaceSnapshot(
  workspaceRoot: string,
  scope: WorkspaceScope,
  artifacts: TaskArtifact[] = [],
  options: WorkspaceCaptureOptions = {},
): WorkspaceSnapshot {
  try {
    const statusBefore = gitStatus(workspaceRoot, options.gitCommand)
    const parsed = parseGitStatusPorcelainV2(statusBefore)
    const entries = new Map<string, WorkspaceEntry>()
    for (const item of parsed)
      entries.set(item.path, fileEvidence(workspaceRoot, item, scope))

    let explicitIgnored = 0
    for (const [path, source] of explicitIgnoredCandidates(scope, artifacts)) {
      if (entries.has(path)) continue
      if (!isIgnored(workspaceRoot, path, options.gitCommand)) continue
      const entry = fileEvidence(
        workspaceRoot,
        {
          path,
          source: 'git_status',
          indexState: '!',
          worktreeState: '!',
          untracked: false,
        },
        scope,
        source,
      )
      entries.set(path, entry)
      explicitIgnored += 1
    }

    const scopeEntries = captureScopeEntries(
      workspaceRoot,
      scope,
      parsed,
      entries,
      options.gitCommand,
    )

    const statusAfter = gitStatus(workspaceRoot, options.gitCommand)
    if (!statusBefore.equals(statusAfter))
      throw new Error('Git status changed during evidence capture.')

    const sortedEntries = [...entries.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    )
    const trackedDirty = parsed.filter((entry) => !entry.untracked).length
    const untracked = parsed.filter((entry) => entry.untracked).length
    return {
      provider: 'git-v1',
      captured_at: now(),
      complete: true,
      coverage: {
        git_visible: true,
        explicit_ignored_files: true,
        ignored_tree: false,
      },
      counts: {
        tracked_dirty: trackedDirty,
        untracked,
        explicit_ignored: explicitIgnored,
        in_scope: sortedEntries.filter((entry) => entry.scope === 'in_scope').length,
        out_of_scope: sortedEntries.filter(
          (entry) => entry.scope === 'out_of_scope',
        ).length,
      },
      entries: sortedEntries,
      scope_entries: scopeEntries,
    }
  } catch (error) {
    return incompleteSnapshot(error)
  }
}

function sameWorktreeContent(left: WorkspaceEntry, right: WorkspaceEntry) {
  const leftSubmoduleState =
    left.submodule_state === 'N...' ? undefined : left.submodule_state
  const rightSubmoduleState =
    right.submodule_state === 'N...' ? undefined : right.submodule_state
  return (
    left.file_type === right.file_type &&
    left.exists === right.exists &&
    left.mode === right.mode &&
    left.content_sha256 === right.content_sha256 &&
    leftSubmoduleState === rightSubmoduleState
  )
}

function sameDeliveryState(left: WorkspaceEntry, right: WorkspaceEntry) {
  return (
    left.index_state === right.index_state &&
    left.worktree_state === right.worktree_state &&
    left.original_path === right.original_path
  )
}

function changeScope(
  before: WorkspaceEntry | undefined,
  after: WorkspaceEntry | undefined,
  scope: WorkspaceScope,
) {
  const paths = [
    before?.path,
    before?.original_path,
    after?.path,
    after?.original_path,
  ].filter((path): path is string => Boolean(path))
  return paths.every((path) => pathInWorkspaceScope(path, scope))
    ? 'in_scope'
    : 'out_of_scope'
}

function compareWorkspaceEntries(
  beforeEntries: WorkspaceEntry[],
  afterEntries: WorkspaceEntry[],
  scope: WorkspaceScope,
  scopeContentOnly: boolean,
): WorkspaceDelta {
  const beforeMap = new Map(beforeEntries.map((entry) => [entry.path, entry]))
  const afterMap = new Map(afterEntries.map((entry) => [entry.path, entry]))
  const paths = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort()
  const changes: WorkspacePathChange[] = []
  for (const path of paths) {
    const oldEntry = beforeMap.get(path)
    const newEntry = afterMap.get(path)
    let change: WorkspacePathChange['change'] | undefined
    let category: NonNullable<WorkspacePathChange['category']> | undefined
    if (!oldEntry && newEntry) {
      change = 'created'
      category = 'content'
    } else if (oldEntry && !newEntry) {
      change =
        !scopeContentOnly &&
        oldEntry.source === 'git_status' &&
        oldEntry.index_state !== '?' &&
        oldEntry.worktree_state !== '?'
          ? 'restored_clean'
          : 'removed'
      category = change === 'restored_clean' ? 'delivery_state' : 'content'
    } else if (oldEntry && newEntry) {
      if (!oldEntry.exists && newEntry.exists) {
        change = 'created'
        category = 'content'
      } else if (oldEntry.exists && !newEntry.exists) {
        change = 'removed'
        category = 'content'
      } else if (!sameWorktreeContent(oldEntry, newEntry)) {
        change =
          oldEntry.content_sha256 !== newEntry.content_sha256
            ? 'content_changed'
            : 'state_changed'
        category = 'content'
      } else if (!scopeContentOnly && oldEntry.index_fingerprint !== newEntry.index_fingerprint) {
        change = 'state_changed'
        category = 'index_content'
      } else if (!scopeContentOnly && !sameDeliveryState(oldEntry, newEntry)) {
        change = 'state_changed'
        category = 'delivery_state'
      }
    }
    if (!change || !category) continue
    const scopeClass = changeScope(oldEntry, newEntry, scope)
    changes.push({
      path,
      ...(newEntry?.original_path || oldEntry?.original_path
        ? { old_path: newEntry?.original_path ?? oldEntry?.original_path }
        : {}),
      scope: scopeClass,
      category,
      change,
      ...(oldEntry ? { before: oldEntry } : {}),
      ...(newEntry ? { after: newEntry } : {}),
    })
  }
  const inScopeCount = changes.filter((item) => item.scope === 'in_scope').length
  const outOfScopeCount = changes.length - inScopeCount
  const contentChangedCount = changes.filter(
    (item) => item.category === 'content',
  ).length
  const indexContentChangedCount = changes.filter(
    (item) => item.category === 'index_content',
  ).length
  const deliveryStateChangedCount = changes.filter(
    (item) => item.category === 'delivery_state',
  ).length
  const status =
    changes.length === 0
      ? 'unchanged'
      : inScopeCount > 0 && outOfScopeCount > 0
        ? 'mixed_mutation'
        : outOfScopeCount > 0
          ? 'out_of_scope_mutation'
          : 'in_scope_mutation'
  return {
    status,
    changed_count: changes.length,
    in_scope_count: inScopeCount,
    out_of_scope_count: outOfScopeCount,
    content_changed_count: contentChangedCount,
    index_content_changed_count: indexContentChangedCount,
    delivery_state_changed_count: deliveryStateChangedCount,
    samples: changes.slice(0, 8),
    changes,
  }
}

function incompleteDelta(before: WorkspaceSnapshot, after: WorkspaceSnapshot) {
  return {
    status: 'evidence_error',
    changed_count: 0,
    in_scope_count: 0,
    out_of_scope_count: 0,
    content_changed_count: 0,
    index_content_changed_count: 0,
    delivery_state_changed_count: 0,
    samples: [],
    changes: [],
    error: before.error ?? after.error ?? 'Workspace evidence is incomplete.',
  } satisfies WorkspaceDelta
}

export function compareWorkspaceSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  scope: WorkspaceScope,
): WorkspaceDelta {
  if (!before.complete || !after.complete) return incompleteDelta(before, after)
  return compareWorkspaceEntries(before.entries, after.entries, scope, false)
}

export function compareWorkspaceScopeContent(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  scope: WorkspaceScope,
): WorkspaceDelta {
  if (!before.complete || !after.complete) return incompleteDelta(before, after)
  if (!before.scope_entries || !after.scope_entries)
    return compareWorkspaceSnapshots(before, after, scope)
  return compareWorkspaceEntries(
    before.scope_entries,
    after.scope_entries,
    scope,
    true,
  )
}

function evidenceCount(value: unknown) {
  if (
    typeof value === 'object' &&
    value !== null &&
    'entries' in value &&
    Array.isArray((value as { entries: unknown }).entries)
  )
    return (value as { entries: unknown[] }).entries.length
  if (
    typeof value === 'object' &&
    value !== null &&
    'changes' in value &&
    Array.isArray((value as { changes: unknown }).changes)
  )
    return (value as { changes: unknown[] }).changes.length
  return 0
}

export function writeWorkspaceEvidence(
  taskDirectory: string,
  label: string,
  kind: 'before' | 'after' | 'delta' | 'live',
  value: WorkspaceSnapshot | WorkspaceDelta,
) {
  const evidenceDirectory = join(taskDirectory, 'evidence')
  mkdirSync(evidenceDirectory, { recursive: true })
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80)
  const fileName = `${safeLabel}-${randomUUID()}-${kind}.json`
  const content = `${JSON.stringify(value, null, 2)}\n`
  writeTextAtomic(join(evidenceDirectory, fileName), content)
  return {
    path: `evidence/${fileName}`,
    sha256: sha256(content),
    entry_count: evidenceCount(value),
  } satisfies WorkspaceEvidenceRef
}

export function readWorkspaceEvidence<T>(
  taskDirectory: string,
  reference: WorkspaceEvidenceRef,
) {
  const resolved = normalize(join(taskDirectory, reference.path))
  const relativePath = relative(taskDirectory, resolved)
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    !relativePath.startsWith(`evidence${sep}`)
  )
    throw new Error(`Invalid workspace evidence ref: ${reference.path}`)
  if (!existsSync(resolved))
    throw new Error(`Workspace evidence is missing: ${reference.path}`)
  const content = readFileSync(resolved, 'utf8')
  if (sha256(content) !== reference.sha256)
    throw new Error(`Workspace evidence integrity mismatch: ${reference.path}`)
  const value = JSON.parse(content) as T
  if (evidenceCount(value) !== reference.entry_count)
    throw new Error(`Workspace evidence count mismatch: ${reference.path}`)
  return value
}
