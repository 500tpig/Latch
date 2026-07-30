export type TaskPhase = 'plan' | 'dev' | 'check' | 'review'

export type TaskOutcome = 'done' | 'abandoned'

export type TaskPlan = {
  goal: string
  workspace_scope?: WorkspaceScope
  scope: string[]
  acceptance: string[]
  approach: string[]
  api_assumptions: string[]
  permission_assumptions: string[]
  data_assumptions: string[]
  user_flow: string[]
  out_of_scope: string[]
  verification_plan: Array<{
    name: string
    command: string[]
    kind: 'gate' | 'diagnostic'
  }>
  open_questions: string[]
}

export type WorkspaceScope = {
  paths: string[]
}

export type WorkspaceEvidenceCoverage = {
  git_visible: true
  explicit_ignored_files: true
  ignored_tree: false
}

export type WorkspaceFileType =
  | 'file'
  | 'directory'
  | 'symlink'
  | 'submodule'
  | 'missing'

export type WorkspaceEntry = {
  path: string
  scope: 'in_scope' | 'out_of_scope'
  source: 'git_status' | 'workspace_scope' | 'artifact'
  index_state: string
  worktree_state: string
  file_type: WorkspaceFileType
  exists: boolean
  mode?: string
  content_sha256?: string
  index_fingerprint?: string
  submodule_state?: string
  original_path?: string
}

export type WorkspaceSnapshotCounts = {
  tracked_dirty: number
  untracked: number
  explicit_ignored: number
  in_scope: number
  out_of_scope: number
}

export type WorkspaceSnapshot = {
  provider: 'git-v1'
  captured_at: string
  complete: boolean
  coverage: WorkspaceEvidenceCoverage
  counts: WorkspaceSnapshotCounts
  entries: WorkspaceEntry[]
  error?: string
}

export type WorkspaceEvidenceRef = {
  path: string
  sha256: string
  entry_count: number
}

export type WorkspacePathChange = {
  path: string
  old_path?: string
  scope: 'in_scope' | 'out_of_scope'
  change:
    | 'created'
    | 'removed'
    | 'restored_clean'
    | 'state_changed'
    | 'content_changed'
  before?: WorkspaceEntry
  after?: WorkspaceEntry
}

export type WorkspaceDelta = {
  status:
    | 'unchanged'
    | 'in_scope_mutation'
    | 'out_of_scope_mutation'
    | 'mixed_mutation'
    | 'evidence_error'
  changed_count: number
  in_scope_count: number
  out_of_scope_count: number
  samples: WorkspacePathChange[]
  changes_ref?: WorkspaceEvidenceRef
  changes: WorkspacePathChange[]
  error?: string
}

export type WorkspaceViolation = {
  id: string
  path: string
  source_gate: string
  created_generation: number
  status: 'unresolved' | 'restored' | 'reclassified'
  before?: WorkspaceEntry
  after?: WorkspaceEntry
  resolved_at?: string
}

export type WorkspaceProofState = {
  generation: number
  baseline_ref: WorkspaceEvidenceRef
  baseline_counts: WorkspaceSnapshotCounts
  unresolved_violations: WorkspaceViolation[]
}

export type CommandOutcome = {
  status: 'pass' | 'fail' | 'error'
  exit_code: number
  error?: string
}

export type VerificationProofBinding = {
  work_revision: number
  started_generation: number
  ended_generation: number
  before_ref: WorkspaceEvidenceRef
  after_ref: WorkspaceEvidenceRef
  delta_ref: WorkspaceEvidenceRef
}

export type BlockedState = {
  reason: string
  waiting_for: string
  blocked_at: string
}

export type VerifyResult = {
  name: string
  kind: 'gate' | 'diagnostic'
  command: string[]
  status: 'pass' | 'fail'
  exit_code: number
  work_revision: number
  created_at: string
  failure_reason?:
    | 'command_failed'
    | 'workspace_mutated'
    | 'scope_violation'
    | 'evidence_error'
    | 'unresolved_scope_violation'
  command_outcome?: CommandOutcome
  workspace_effect?: Omit<WorkspaceDelta, 'changes'>
  proof?: VerificationProofBinding
  stale_reason?:
    | 'work_revision_changed'
    | 'proof_generation_changed'
    | 'workspace_baseline_mismatch'
    | 'unresolved_scope_violation'
}

export type TaskArtifact = {
  kind: string
  path: string
}

export type TaskProfile = 'light' | 'standard'

export type TaskProvenance = 'clean' | 'mixed'

export type TaskSourceRecord = {
  record_id: string
  revision: number
  body_sha256: string
}

export type ImplementationAuthorization = {
  kind: 'implementation_authorization'
  plan_revision: number
  authorized_at: string
  source: 'user_request' | 'user_approve' | 'user_delta'
  reason: string
  scope: {
    summary: string
    paths?: string[]
    notes?: string
  }
}

export type RetrospectiveRecord = {
  kind: 'retrospective_record'
  recorded_at: string
  reason: string
  implemented_before_task: true
  scope_summary: string
  plan_revision: number
  work_revision: number
}

export type WorkBasis = ImplementationAuthorization | RetrospectiveRecord

export type ImplementationAuthorizationInput = Omit<
  ImplementationAuthorization,
  'plan_revision' | 'authorized_at'
>

export type RetrospectiveRecordInput = Omit<
  RetrospectiveRecord,
  'recorded_at' | 'plan_revision' | 'work_revision'
> & {
  code_unchanged?: true
}

export type WorkBasisInput =
  | ImplementationAuthorizationInput
  | RetrospectiveRecordInput

export type KnowledgeImpact =
  | { kind: 'none'; reason: string }
  | {
      kind: 'updated'
      summary: string
      artifact_refs: TaskArtifact[]
    }

export type TaskSubmission = {
  plan_revision?: number
  work_revision: number
  changes: string
  verified: string
  unverified: string
  knowledge_impact?: KnowledgeImpact
  no_verify?: {
    reason: string
  }
  submitted_at: string
}

// C6 后新 task 写 schema 3；schema 2 继续用于 legacy 读取和 R2 回退。
export type TaskV2 = {
  schema_version: 2 | 3
  id: string
  title: string
  phase: TaskPhase
  outcome?: TaskOutcome
  primary_writer?: string
  profile?: TaskProfile
  provenance?: TaskProvenance
  group_id?: string
  source_record?: TaskSourceRecord
  work_basis?: WorkBasis
  revision: number
  plan_revision: number
  work_revision: number
  workspace_root: string
  plan: TaskPlan
  implementation_approval?: {
    approved_plan_revision: number
    approved_at: string
    source: 'user'
    reason: string
  }
  blocked?: BlockedState
  verification: {
    gate: Record<string, VerifyResult>
    diagnostic: Record<string, VerifyResult>
  }
  workspace_proof?: WorkspaceProofState
  submission?: TaskSubmission
  closure?: {
    changes: string
    verified: string
    unverified: string
    followup: string
    accepted_at: string
  }
  artifacts: TaskArtifact[]
  created_at: string
  updated_at: string
}

export type LatchStateV2 = {
  schema_version: 2
  actors: Record<string, { current_task_id?: string }>
}

export const TASK_EVENT_TYPES = [
  'task_created',
  'plan_updated',
  'artifact_updated',
  'decision_recorded',
  'implementation_approved',
  'work_started',
  'review_feedback',
  'blocked',
  'unblocked',
  'verification_run',
  'submitted',
  'done',
  'abandoned',
] as const

export const WRITER_EVENT_TYPES = [
  'writer_claimed',
  'writer_taken_over',
] as const

export const LIGHT_EVENT_TYPES = [
  'implementation_authorized',
  'retrospective_recorded',
  'profile_changed',
  'submission_knowledge_impact_patched',
  'proof_generation_started',
  'proof_invalidated',
  'workspace_violation_resolved',
] as const

export const GROUP_EVENT_TYPES = ['group_changed'] as const

export const TASK_EVENT_TYPES_V3 = [
  ...TASK_EVENT_TYPES,
  ...WRITER_EVENT_TYPES,
  ...LIGHT_EVENT_TYPES,
  ...GROUP_EVENT_TYPES,
] as const

export type TaskEventTypeV2 = (typeof TASK_EVENT_TYPES)[number]
export type TaskEventType = (typeof TASK_EVENT_TYPES_V3)[number]

export type BaseTaskEvent = {
  type: TaskEventType
  task_id: string
  actor: string
  revision: number
  created_at: string
}

export type TaskEventsMeta = {
  type: 'events_meta'
  events_schema_version: 3
  actor: string
  task_id: string
  revision: 0
  created_at: string
}

export type DecisionEvent = BaseTaskEvent & {
  type: 'decision_recorded'
  plan_revision: number
  question?: string
  answer?: string
  conclusion: string
}

export type ReviewFeedbackEvent = BaseTaskEvent & {
  type: 'review_feedback'
  plan_revision: number
  work_revision: number
  classification:
    | 'implementation_correction'
    | 'non_implementation_correction'
    | 'evaluative'
    | 'plan_change'
  summary: string
}

export type WriterClaimedEvent = BaseTaskEvent & {
  type: 'writer_claimed'
  reason?: string
}

export type WriterTakenOverEvent = BaseTaskEvent & {
  type: 'writer_taken_over'
  from: string
  to: string
  reason: string
}

type StandardTaskEvent = Omit<BaseTaskEvent, 'type'> & {
  type: Exclude<
    TaskEventType,
    | 'decision_recorded'
    | 'review_feedback'
    | 'writer_claimed'
    | 'writer_taken_over'
  >
} & Record<string, unknown>

export type TaskEvent =
  | DecisionEvent
  | ReviewFeedbackEvent
  | WriterClaimedEvent
  | WriterTakenOverEvent
  | StandardTaskEvent
