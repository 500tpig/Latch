import type { LatchPathsV2 } from '../paths.js'
import type {
  TaskArtifact,
  TaskEvent,
  TaskEventType,
  TaskEventTypeV2,
  TaskPlan,
  TaskProfile,
  TaskSourceRecord,
  TaskV2,
  WorkBasisInput,
} from '../types.js'

export type TaskStoreV2 = {
  paths: LatchPathsV2
}

export type ContextTaskReadV2 = {
  task: TaskV2
  archived: boolean
  eventLog: {
    events: TaskEvent[]
    warnings: string[]
  }
}

export type CreateTaskV2Input = {
  title: string
  plan: TaskPlan
  artifacts?: TaskArtifact[]
}

export type CreateTaskV3Input = CreateTaskV2Input & {
  profile: TaskProfile
  groupId?: string
  sourceRecord?: TaskSourceRecord
  workBasis?: WorkBasisInput
}

export type CreateTaskV4Input = CreateTaskV3Input
export type CreateTaskV5Input = CreateTaskV3Input

export type TaskWriteResultV2 = {
  task: TaskV2
  warnings: string[]
}

export type SharedWorktreeProjection = {
  active_task_count: number
  overlap_task_count: number
  plan_task_count?: number
  active_writer_task_count?: number
  review_only_task_count?: number
  plan_overlap_task_count?: number
  active_writer_overlap_task_count?: number
  review_only_overlap_task_count?: number
  sample_limit: number
  total_count: number
  returned_count: number
  sample: Array<{
    task_id: string
    phase: TaskV2['phase']
    current_path: string
    other_path: string
  }>
  truncated: boolean
}

export type TaskEventInputV2 = {
  type: TaskEventTypeV2
  fields?: Record<string, unknown>
}

type TaskEventInput = {
  type: TaskEventType
  fields?: Record<string, unknown>
}

export type UpdateTaskV2Options = {
  expectRevision: number
  actor: string
  events: TaskEventInputV2[]
  update: (task: TaskV2) => void
}

export type UpdateTaskV3Options = Omit<UpdateTaskV2Options, 'events'> & {
  events: TaskEventInput[]
}

export type ArchiveTaskV2Options = {
  expectRevision: number
  actor: string
  outcome: 'done' | 'abandoned'
  update?: (task: TaskV2) => void
  eventFields?: Record<string, unknown>
}

export type ClaimTaskV3Options = {
  expectRevision: number
  actor: string
  reason?: string
}

export type TakeoverTaskV3Options = {
  expectRevision: number
  actor: string
  reason: string
}

export type UpgradeTaskV4Options = {
  expectRevision: number
  actor: string
  recoverWriter?: boolean
  reason?: string
}

export type DowngradeTaskV2Result = TaskWriteResultV2 & {
  backupPath: string
}

export class DowngradeTaskV2Error extends Error {
  constructor(
    message: string,
    readonly backupPath: string,
    readonly warnings: string[],
  ) {
    super(message)
    this.name = 'DowngradeTaskV2Error'
  }
}
