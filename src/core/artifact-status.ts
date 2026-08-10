import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TaskArtifact, WorkspaceScope } from './types.js'
import { pathInWorkspaceScope } from './workspace-evidence.js'

export type ArtifactGitStatus =
  | 'tracked'
  | 'untracked'
  | 'ignored'
  | 'missing'
  | 'unknown'

export type ArtifactDelivery = TaskArtifact & {
  git_status: ArtifactGitStatus
}

function gitStatus(workspaceRoot: string, path: string): ArtifactGitStatus {
  if (!existsSync(resolve(workspaceRoot, path))) return 'missing'

  const tracked = spawnSync(
    'git',
    ['-C', workspaceRoot, 'ls-files', '--error-unmatch', '--', path],
    { encoding: 'utf8' },
  )
  if (tracked.status === 0) return 'tracked'

  const ignored = spawnSync(
    'git',
    ['-C', workspaceRoot, 'check-ignore', '-q', '--', path],
    { encoding: 'utf8' },
  )
  if (ignored.status === 0) return 'ignored'
  if (ignored.status === 1) return 'untracked'
  return 'unknown'
}

export function artifactDelivery(
  workspaceRoot: string,
  artifacts: TaskArtifact[],
): ArtifactDelivery[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    git_status: gitStatus(workspaceRoot, artifact.path),
  }))
}

export function artifactDeliveryWarnings(
  workspaceRoot: string,
  artifacts: TaskArtifact[],
): string[] {
  return artifactWarnings(artifactDelivery(workspaceRoot, artifacts))
}

export function artifactWarnings(delivery: ArtifactDelivery[]): string[] {
  return delivery
    .filter((artifact) => artifact.git_status !== 'tracked')
    .map(
      (artifact) =>
        `Artifact delivery: ${artifact.kind}:${artifact.path} is ${artifact.git_status}; it may not be delivered by Git.`,
    )
}

export function untrackedWorktreeWarnings(
  workspaceRoot: string,
  scope: WorkspaceScope,
  verbose = false,
): string[] {
  const result = spawnSync(
    'git',
    ['-C', workspaceRoot, 'ls-files', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  )
  if (result.status !== 0 || !result.stdout) return []
  const paths = result.stdout
    .split('\0')
    .filter(Boolean)
    .sort()
  const classified = paths.map((path) => ({
    path,
    scope: pathInWorkspaceScope(path, scope) ? 'in scope' : 'ambient',
  }))
  const inScope = classified.filter((entry) => entry.scope === 'in scope').length
  const ambient = classified.length - inScope
  if (!verbose) {
    const samples = classified
      .slice(0, 8)
      .map((entry) => `${entry.path} (${entry.scope})`)
      .join(', ')
    return [
      `Worktree delivery: ${paths.length} untracked file${paths.length === 1 ? '' : 's'}; ${inScope} in scope, ${ambient} ambient; samples: ${samples}; they may not be delivered by Git.`,
    ]
  }
  return classified
    .map(
      (entry) =>
        `Worktree delivery: ${entry.path} is untracked (${entry.scope}); it may not be delivered by Git.`,
    )
}
