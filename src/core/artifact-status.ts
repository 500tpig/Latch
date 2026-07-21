import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TaskArtifact } from './types.js'

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

export function untrackedWorktreeWarnings(workspaceRoot: string): string[] {
  const result = spawnSync(
    'git',
    ['-C', workspaceRoot, 'ls-files', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  )
  if (result.status !== 0 || !result.stdout) return []
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map(
      (path) =>
        `Worktree delivery: ${path} is untracked; it may not be delivered by Git.`,
    )
}
