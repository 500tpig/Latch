import { lstatSync } from 'node:fs'
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import { fail, readInputFile } from '../cli-support.js'
import { discoverWorkspaceRoot } from '../core/paths.js'
import { normalizeTaskPlanInput } from '../core/plan-schema.js'
import { jsonEnvelopeV2 } from '../core/task-view.js'
import {
  nextAction,
  workspaceProofView,
} from '../core/task-view/list-status.js'
import {
  assertGroupIdV3,
  openTaskStoreV2,
  readContextTaskV2,
} from '../core/task-store.js'
import type {
  TaskArtifact,
  TaskProfile,
  TaskProvenance,
  TaskV2,
} from '../core/types.js'
import { sharedWorktreeProjection } from '../core/progress/shared.js'
import { commandUsage } from './usage.js'

export function requirePositionals(
  command: string,
  positionals: string[],
  count: number | [number, number],
) {
  const minimum = Array.isArray(count) ? count[0] : count
  const maximum = Array.isArray(count) ? count[1] : count
  if (positionals.length < minimum || positionals.length > maximum)
    fail('invalid_arguments', commandUsage[command])
}

export function groupId(raw: string | undefined) {
  if (raw === undefined) return undefined
  try {
    assertGroupIdV3(raw, '--group')
    return raw
  } catch (error) {
    fail('invalid_arguments', error instanceof Error ? error.message : String(error))
  }
}

export function taskProvenance(raw: string | undefined) {
  if (raw === undefined) return undefined
  if (raw !== 'clean' && raw !== 'mixed')
    fail('invalid_arguments', '--provenance must be clean or mixed.')
  return raw as TaskProvenance
}

export function artifact(raw: string): TaskArtifact {
  const separator = raw.indexOf(':')
  if (separator <= 0)
    fail('invalid_arguments', `Artifact must be <kind>:<path>, got: ${raw}`)
  const kind = raw.slice(0, separator).trim()
  const inputPath = raw.slice(separator + 1).trim()
  if (!kind || !inputPath)
    fail('invalid_arguments', `Artifact kind and path are required, got: ${raw}`)
  if (isAbsolute(inputPath))
    fail('invalid_arguments', `Artifact path must be relative to workspace root: ${inputPath}`)
  const normalizedPath = normalize(inputPath)
  if (
    normalizedPath === '.' ||
    normalizedPath === '..' ||
    normalizedPath.startsWith(`..${sep}`)
  )
    fail('invalid_arguments', `Artifact path escapes workspace root: ${inputPath}`)
  return { kind, path: normalizedPath.split(sep).join('/') }
}

function artifactKey(value: TaskArtifact) {
  return `${value.kind}\u0000${value.path}`
}

export function artifactLabel(value: TaskArtifact) {
  return `${value.kind}:${value.path}`
}

export function artifactChanges(
  currentArtifacts: TaskArtifact[],
  addedValues: string[],
  removedValues: string[],
) {
  const addedArtifacts = addedValues.map(artifact)
  const removedArtifacts = removedValues.map(artifact)
  const removedKeys = new Set(removedArtifacts.map(artifactKey))
  const actuallyRemoved = currentArtifacts.filter((value) =>
    removedKeys.has(artifactKey(value)),
  )
  const nextArtifacts = currentArtifacts.filter(
    (value) => !removedKeys.has(artifactKey(value)),
  )
  const existingKeys = new Set(nextArtifacts.map(artifactKey))
  const actuallyAdded: TaskArtifact[] = []
  for (const value of addedArtifacts) {
    const key = artifactKey(value)
    if (!existingKeys.has(key)) {
      nextArtifacts.push(value)
      actuallyAdded.push(value)
      existingKeys.add(key)
    }
  }
  return {
    nextArtifacts,
    actuallyAdded,
    actuallyRemoved,
    changed: JSON.stringify(nextArtifacts) !== JSON.stringify(currentArtifacts),
  }
}

export function readPlan(
  cwd: string,
  planFile: string | undefined,
  profile: TaskProfile = 'standard',
) {
  if (!planFile) fail('invalid_arguments', '--plan-file is required.')
  const plan = readInputFile<unknown>(cwd, planFile, '--plan-file')
  const normalized = normalizeTaskPlanInput(plan, profile, planFile)
  const workspaceRoot = discoverWorkspaceRoot(cwd)
  for (const candidate of normalized.workspace_scope.paths) {
    if (candidate.endsWith('/')) continue
    try {
      if (!lstatSync(resolve(workspaceRoot, candidate)).isDirectory()) continue
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      throw error
    }
    throw new Error(
      `Invalid plan.workspace_scope.paths in ${planFile}: ${candidate} is an existing directory. ` +
        'Paths without a trailing "/" are exact files; ' +
        `use ${candidate}/ for a directory prefix.`,
    )
  }
  return normalized
}

export function mutationJson(
  store: ReturnType<typeof openTaskStoreV2>,
  task: TaskV2,
  actor: string,
  warnings: string[],
  previousRevision?: number,
  archived = false,
) {
  const workspaceProof = workspaceProofView(store, task, archived)
  return {
    ...jsonEnvelopeV2(),
    task_id: task.id,
    ...(previousRevision !== undefined ? { previous_revision: previousRevision } : {}),
    revision: task.revision,
    phase: task.phase,
    next_action: nextAction(
      task,
      actor,
      workspaceProof?.live_status,
      archived,
    ),
    shared_worktree: sharedWorktreeProjection(store, task),
    ...(workspaceProof ? { workspace_proof: workspaceProof } : {}),
    warnings,
  }
}

export function currentWritableTask(
  store: ReturnType<typeof openTaskStoreV2>,
  id: string,
) {
  const task = readContextTaskV2(store, id).task
  if (task.schema_version !== 5)
    fail(
      'writer_version_mismatch',
      `Candidate CLI 0.5.0 only mutates schema_version 5 tasks; the current Latch runner treats task ${task.id} as historical read-only and requires its matching runner for schema_version ${task.schema_version}.`,
    )
  return task
}
