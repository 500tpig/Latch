import { now } from '../utils.js'

export type JsonEnvelopeV3 = {
  schema_version: 3
  generated_at: string
}

export function jsonEnvelopeV3(): JsonEnvelopeV3 {
  return {
    schema_version: 3,
    generated_at: now(),
  }
}

export type NextAction =
  | {
      kind: 'command'
      command: 'verify-all' | 'reopen-review'
    }
  | {
      kind: 'command'
      command: 'submit'
      mode?: 'no_verify'
    }
  | {
      kind: 'await_user'
      boundary: 'plan_input' | 'approval' | 'review' | 'closeout'
      reason:
        | 'open_questions'
        | 'implementation_plan'
        | 'takeover'
        | 'review_decision'
        | 'unverified_items'
    }
  | {
      kind: 'stop'
      reason:
        | 'archived_read_only'
        | 'historical_read_only'
        | 'caller_read_only'
        | 'blocked'
        | 'implementation_diagnosis'
        | 'invalid_review_state'
        | 'invalid_task_state'
    }

export const NEXT_ACTIONS = {
  archivedReadOnly: { kind: 'stop', reason: 'archived_read_only' },
  historicalReadOnly: { kind: 'stop', reason: 'historical_read_only' },
  callerReadOnly: { kind: 'stop', reason: 'caller_read_only' },
  blocked: { kind: 'stop', reason: 'blocked' },
  implementationDiagnosis: {
    kind: 'stop',
    reason: 'implementation_diagnosis',
  },
  invalidReviewState: { kind: 'stop', reason: 'invalid_review_state' },
  invalidTaskState: { kind: 'stop', reason: 'invalid_task_state' },
  takeover: { kind: 'await_user', boundary: 'approval', reason: 'takeover' },
  openQuestions: {
    kind: 'await_user',
    boundary: 'plan_input',
    reason: 'open_questions',
  },
  implementationPlan: {
    kind: 'await_user',
    boundary: 'approval',
    reason: 'implementation_plan',
  },
  reviewDecision: {
    kind: 'await_user',
    boundary: 'review',
    reason: 'review_decision',
  },
  unverifiedItems: {
    kind: 'await_user',
    boundary: 'closeout',
    reason: 'unverified_items',
  },
  verifyAll: { kind: 'command', command: 'verify-all' },
  submit: { kind: 'command', command: 'submit' },
  submitNoVerify: { kind: 'command', command: 'submit', mode: 'no_verify' },
  reopenReview: { kind: 'command', command: 'reopen-review' },
} as const satisfies Record<string, NextAction>

export const SCHEMA5_VIEW_SAMPLE_LIMIT = 8

export function concise(value: string, limit = 160) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= limit) return compact
  return `${compact.slice(0, limit - 1).trimEnd()}…`
}
