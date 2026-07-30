import type { TaskPlan } from './types.js'
import { posix } from 'node:path'

export const LIGHT_PLAN_TEMPLATE_COMMAND =
  'latch checkpoint --print-plan-template light'

const minimumLightPlanTemplate: TaskPlan = {
  goal: 'Describe the intended outcome.',
  workspace_scope: { paths: [] },
  scope: [],
  acceptance: [],
  approach: [],
  api_assumptions: [],
  permission_assumptions: [],
  data_assumptions: [],
  user_flow: [],
  out_of_scope: [],
  verification_plan: [],
  open_questions: [],
}

const stringArrayPlanFields = [
  'scope',
  'acceptance',
  'approach',
  'api_assumptions',
  'permission_assumptions',
  'data_assumptions',
  'user_flow',
  'out_of_scope',
  'open_questions',
] as const

const requiredPlanFields = [
  'goal',
  'scope',
  'acceptance',
  'approach',
  'api_assumptions',
  'permission_assumptions',
  'data_assumptions',
  'user_flow',
  'out_of_scope',
  'verification_plan',
  'open_questions',
] as const

const planSchemaSummary = [
  'plan.goal: non-empty string',
  'plan.workspace_scope: { paths: repo-relative POSIX path[] }',
  ...stringArrayPlanFields.map((field) => `plan.${field}: string[]`),
  'plan.verification_plan: Array<{ name: non-empty string; command: non-empty string[]; kind: "gate" | "diagnostic" }>',
].join('; ')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function actualType(value: unknown): string {
  if (Array.isArray(value)) {
    const invalidIndex = value.findIndex((entry) => typeof entry !== 'string')
    if (invalidIndex >= 0)
      return `array containing ${actualType(value[invalidIndex])} at index ${invalidIndex}`
    return 'array'
  }
  if (value === null) return 'null'
  return typeof value
}

function invalidField(
  field: string,
  expected: string,
  value: unknown,
  minimumLegalValue: unknown,
  path: string,
): never {
  throw new Error(
    `Invalid ${field} in ${path}: expected ${expected}, got ${actualType(value)}. ` +
      `Minimal legal value: ${JSON.stringify(minimumLegalValue)}. ` +
      `Run \`${LIGHT_PLAN_TEMPLATE_COMMAND}\` for a complete template.`,
  )
}

function requireString(
  value: unknown,
  field: string,
  path: string,
  minimumLegalValue: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '')
    invalidField(field, 'non-empty string', value, minimumLegalValue, path)
}

function requireStringArray(
  value: unknown,
  field: string,
  path: string,
  minimumLegalValue: string[] = [],
): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    invalidField(field, 'string[]', value, minimumLegalValue, path)
}

function normalizeWorkspaceScopePath(value: string, path: string) {
  if (value === '' || value === '.' || value === '..')
    throw new Error(`Invalid plan.workspace_scope.paths in ${path}: empty or root path.`)
  if (
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes('\\') ||
    value.startsWith(':') ||
    /[*?[\]]/.test(value) ||
    value.includes('\0')
  )
    throw new Error(`Invalid plan.workspace_scope.paths in ${path}: ${value}.`)
  const directory = value.endsWith('/')
  const normalized = posix.normalize(value)
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.split('/').includes('..')
  )
    throw new Error(`Invalid plan.workspace_scope.paths in ${path}: ${value}.`)
  return directory ? `${normalized.replace(/\/+$/, '')}/` : normalized
}

function validateWorkspaceScope(plan: Record<string, unknown>, path: string) {
  if (plan.workspace_scope === undefined) return
  if (!isRecord(plan.workspace_scope))
    invalidField(
      'plan.workspace_scope',
      '{ paths: string[] }',
      plan.workspace_scope,
      { paths: [] },
      path,
    )
  requireStringArray(
    plan.workspace_scope.paths,
    'plan.workspace_scope.paths',
    path,
  )
  plan.workspace_scope.paths = [
    ...new Set(
      plan.workspace_scope.paths.map((entry) =>
        normalizeWorkspaceScopePath(entry, path),
      ),
    ),
  ]
}

export function lightPlanTemplate(): TaskPlan {
  return structuredClone(minimumLightPlanTemplate)
}

export function assertTaskPlan(
  plan: unknown,
  path: string,
): asserts plan is TaskPlan {
  if (!isRecord(plan))
    invalidField('plan', 'object', plan, minimumLightPlanTemplate, path)

  const missingFields = requiredPlanFields.filter(
    (field) => plan[field] === undefined,
  )
  if (missingFields.length > 0)
    throw new Error(
      `Missing required plan fields in ${path}: ` +
        `${missingFields.map((field) => `plan.${field}`).join(', ')}. ` +
        `Expected schema: ${planSchemaSummary}. ` +
        `Minimal legal plan: ${JSON.stringify(minimumLightPlanTemplate)}. ` +
        `Run \`${LIGHT_PLAN_TEMPLATE_COMMAND}\` for a complete template.`,
    )

  requireString(plan.goal, 'plan.goal', path, minimumLightPlanTemplate.goal)
  validateWorkspaceScope(plan, path)
  for (const field of stringArrayPlanFields)
    requireStringArray(plan[field], `plan.${field}`, path)

  if (!Array.isArray(plan.verification_plan))
    invalidField(
      'plan.verification_plan',
      'Array<{ name: non-empty string; command: non-empty string[]; kind: "gate" | "diagnostic" }>',
      plan.verification_plan,
      [],
      path,
    )

  const verificationNames = new Set<string>()
  for (const verification of plan.verification_plan) {
    if (!isRecord(verification))
      invalidField(
        'plan.verification_plan[]',
        'object',
        verification,
        {
          name: 'check',
          command: ['replace-with-real-command'],
          kind: 'gate',
        },
        path,
      )
    requireString(
      verification.name,
      'verification_plan.name',
      path,
      'check',
    )
    requireStringArray(
      verification.command,
      'verification_plan.command',
      path,
      ['replace-with-real-command'],
    )
    if (verification.command.length === 0)
      throw new Error(
        `Invalid empty verification_plan.command in ${path}: expected non-empty string[], got empty array. ` +
          'Minimal legal value: ["replace-with-real-command"]. ' +
          `Run \`${LIGHT_PLAN_TEMPLATE_COMMAND}\` for a complete template.`,
      )
    if (verificationNames.has(verification.name))
      throw new Error(
        `Duplicate verification_plan.name in ${path}: ${verification.name}.`,
      )
    verificationNames.add(verification.name)
    if (verification.kind !== 'gate' && verification.kind !== 'diagnostic')
      invalidField(
        'verification_plan.kind',
        '"gate" | "diagnostic"',
        verification.kind,
        'gate',
        path,
      )
  }
}

export function assertWritableTaskPlan(
  plan: unknown,
  path: string,
): asserts plan is TaskPlan {
  assertTaskPlan(plan, path)
  if (!plan.workspace_scope)
    throw new Error(
      `Missing required plan field in ${path}: plan.workspace_scope. ` +
        `Run \`${LIGHT_PLAN_TEMPLATE_COMMAND}\` for a complete template.`,
    )
}
