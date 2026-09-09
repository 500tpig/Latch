import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export type LatchPathsV2 = {
  workspaceRoot: string
  latchDir: string
  tasksDir: string
  archiveDir: string
  recordsDir: string
  recordBodiesDir: string
  recordIndexPath: string
  locksDir: string
  taskLocksDir: string
  recordLockPath: string
  statePath: string
  stateLockPath: string
}

export class NotInitializedError extends Error {
  readonly code = 'not_initialized'

  constructor(readonly workspace_root: string) {
    super(
      `Latch is not initialized from ${workspace_root}. Run \`latch init\` in the project root.`,
    )
    this.name = 'NotInitializedError'
  }
}

function canonicalDirectory(path: string) {
  return realpathSync.native(resolve(path))
}

export function pathsForWorkspace(workspaceRoot: string): LatchPathsV2 {
  const canonicalRoot = canonicalDirectory(workspaceRoot)
  const v2LatchDir = join(canonicalRoot, '.latch')
  const locksDir = join(v2LatchDir, '.locks')
  return {
    workspaceRoot: canonicalRoot,
    latchDir: v2LatchDir,
    tasksDir: join(v2LatchDir, 'tasks'),
    archiveDir: join(v2LatchDir, 'archive'),
    recordsDir: join(v2LatchDir, 'records'),
    recordBodiesDir: join(v2LatchDir, 'records', 'bodies'),
    recordIndexPath: join(v2LatchDir, 'records', 'index.json'),
    locksDir,
    taskLocksDir: join(locksDir, 'tasks'),
    recordLockPath: join(locksDir, 'records.lock'),
    statePath: join(v2LatchDir, 'state.json'),
    stateLockPath: join(locksDir, 'state.lock'),
  }
}

// Git repo 只在本 repo 根以内查找，避免嵌套 repo 误用父项目状态。
export function findExistingLatchRoot(
  cwd: string,
  stopAt?: string,
): string | undefined {
  let current = canonicalDirectory(cwd)
  const boundary = stopAt ? canonicalDirectory(stopAt) : undefined
  while (true) {
    if (existsSync(join(current, '.latch'))) return current
    if (boundary && current === boundary) return undefined
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

export function findGitRoot(cwd: string): string | undefined {
  try {
    return canonicalDirectory(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    )
  } catch {
    return undefined
  }
}

export function discoverWorkspaceRoot(
  cwd: string,
  options: { forInit?: boolean } = {},
): string {
  const canonicalCwd = canonicalDirectory(cwd)
  const gitRoot = findGitRoot(canonicalCwd)
  if (gitRoot) {
    const existingRoot = findExistingLatchRoot(canonicalCwd, gitRoot)
    if (existingRoot) return existingRoot
    if (options.forInit) return gitRoot
    throw new NotInitializedError(canonicalCwd)
  }

  const existingRoot = findExistingLatchRoot(canonicalCwd)
  if (existingRoot) return existingRoot
  if (options.forInit) return canonicalCwd

  throw new NotInitializedError(canonicalCwd)
}
