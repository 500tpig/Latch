export type TaskPhase = 'plan' | 'dev' | 'check' | 'review'

export type TaskOutcome = 'done' | 'abandoned'

export type TaskPlan = {
  goal: string
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
}

export type TaskArtifact = {
  kind: string
  path: string
}

export type TaskProfile = 'light' | 'standard'

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

// C1-C3 期间 schema 3 仅供临时 fixture；默认产品创建仍固定为 schema 2。
export type TaskV2 = {
  schema_version: 2 | 3
  id: string
  title: string
  phase: TaskPhase
  outcome?: TaskOutcome
  primary_writer?: string
  profile?: TaskProfile
  group_id?: string
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
  classification: 'implementation_correction' | 'evaluative' | 'plan_change'
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
