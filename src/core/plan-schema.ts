import { posix } from 'node:path'
import type { TaskPlan, TaskProfile } from './types.js'

export const LIGHT_PLAN_TEMPLATE_COMMAND =
  'latch checkpoint --print-plan-template light'
export const STANDARD_PLAN_TEMPLATE_COMMAND =
  'latch checkpoint --print-plan-template standard'

const planTemplateHelp =
  `Run \`${LIGHT_PLAN_TEMPLATE_COMMAND}\` or ` +
  `\`${STANDARD_PLAN_TEMPLATE_COMMAND}\` for a shape-valid scaffold.`

type WritableTaskPlan = TaskPlan & {
  workspace_scope: NonNullable<TaskPlan['workspace_scope']>
}

const lightPlanCoreFields = [
  'goal',
  'workspace_scope',
  'scope',
  'acceptance',
  'approach',
  'verification_plan',
] as const satisfies ReadonlyArray<keyof TaskPlan>

const lightPlanDefaultFields = [
  'api_assumptions',
  'permission_assumptions',
  'data_assumptions',
  'user_flow',
  'out_of_scope',
  'open_questions',
] as const satisfies ReadonlyArray<keyof TaskPlan>

const verificationCommandSentinel = 'replace-with-real-command'
const verificationPlanScaffold: TaskPlan['verification_plan'] = [
  {
    name: 'check',
    command: [verificationCommandSentinel],
    kind: 'gate',
  },
]

type LightPlanCoreField = (typeof lightPlanCoreFields)[number]
type LightPlanDefaultField = (typeof lightPlanDefaultFields)[number]

export type LightPlanAuthoringInput =
  Pick<TaskPlan, LightPlanCoreField> &
  Partial<Pick<TaskPlan, LightPlanDefaultField>>

type PlanFieldSpec = {
  scaffold: unknown
  shapeRequired: boolean
  writableRequired: boolean
  summary: string
  validateShape: (value: unknown, path: string) => void
  authorizable?: (value: unknown, profile: TaskProfile) => string | undefined
}

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

function invalidFieldMessage(
  field: string,
  expected: string,
  value: unknown,
  minimumLegalValue: unknown,
  path: string,
) {
  return (
    `Invalid ${field} in ${path}: expected ${expected}, got ${actualType(value)}. ` +
    `Minimal legal value: ${JSON.stringify(minimumLegalValue)}. ` +
    planTemplateHelp
  )
}

function invalidField(
  field: string,
  expected: string,
  value: unknown,
  minimumLegalValue: unknown,
  path: string,
): never {
  throw new Error(
    invalidFieldMessage(field, expected, value, minimumLegalValue, path),
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

function validateWorkspaceScope(value: unknown, path: string) {
  if (!isRecord(value))
    invalidField(
      'plan.workspace_scope',
      '{ paths: string[] }',
      value,
      { paths: [] },
      path,
    )
  requireStringArray(
    value.paths,
    'plan.workspace_scope.paths',
    path,
  )
  value.paths = [
    ...new Set(
      value.paths.map((entry) => normalizeWorkspaceScopePath(entry, path)),
    ),
  ]
}

function validateVerificationPlan(value: unknown, path: string) {
  if (!Array.isArray(value))
    invalidField(
      'plan.verification_plan',
      'Array<{ name: non-empty string; command: non-empty string[]; kind: "gate" | "diagnostic" }>',
      value,
      [],
      path,
    )

  const errors: string[] = []
  const verificationNames = new Set<string>()
  const exampleItem = verificationPlanScaffold[0]
  for (const verification of value) {
    if (!isRecord(verification)) {
      errors.push(
        invalidFieldMessage(
          'plan.verification_plan[]',
          'object',
          verification,
          exampleItem,
          path,
        ),
      )
      continue
    }
    if (typeof verification.name !== 'string' || verification.name.trim() === '')
      errors.push(
        invalidFieldMessage(
          'verification_plan.name',
          'non-empty string',
          verification.name,
          'check',
          path,
        ),
      )
    else if (verificationNames.has(verification.name))
      errors.push(
        `Duplicate verification_plan.name in ${path}: ${verification.name}.`,
      )
    else verificationNames.add(verification.name)
    if (
      !Array.isArray(verification.command) ||
      verification.command.some((entry) => typeof entry !== 'string')
    )
      errors.push(
        invalidFieldMessage(
          'verification_plan.command',
          'string[]',
          verification.command,
          [verificationCommandSentinel],
          path,
        ),
      )
    else if (verification.command.length === 0)
      errors.push(
        `Invalid empty verification_plan.command in ${path}: expected non-empty string[], got empty array. ` +
          `Minimal legal value: ${JSON.stringify([verificationCommandSentinel])}. ` +
          planTemplateHelp,
      )
    if (verification.kind !== 'gate' && verification.kind !== 'diagnostic')
      errors.push(
        invalidFieldMessage(
          'verification_plan.kind',
          '"gate" | "diagnostic"',
          verification.kind,
          'gate',
          path,
        ),
      )
  }
  if (errors.length === 1) throw new Error(errors[0])
  if (errors.length > 1) throw new Error(errors.join('; '))
}

function stringArraySpec(
  field: string,
  authorizable?: PlanFieldSpec['authorizable'],
): PlanFieldSpec {
  return {
    scaffold: [],
    shapeRequired: true,
    writableRequired: false,
    summary: `plan.${field}: string[]`,
    validateShape(value, path) {
      requireStringArray(value, `plan.${field}`, path)
    },
    ...(authorizable ? { authorizable } : {}),
  }
}

function requireMeaningfulItem(value: unknown) {
  return (value as string[]).some((entry) => entry.trim() !== '')
    ? undefined
    : 'must contain at least one non-empty item'
}

const planFieldSpecs = {
  goal: {
    scaffold: 'Describe the intended outcome.',
    shapeRequired: true,
    writableRequired: false,
    summary: 'plan.goal: non-empty string',
    validateShape(value, path) {
      requireString(value, 'plan.goal', path, 'Describe the intended outcome.')
    },
    authorizable(value) {
      return typeof value === 'string' && value.trim() !== ''
        ? undefined
        : 'must be non-empty'
    },
  },
  workspace_scope: {
    scaffold: { paths: [] },
    shapeRequired: false,
    writableRequired: true,
    summary: 'plan.workspace_scope: { paths: repo-relative POSIX path[] }',
    validateShape: validateWorkspaceScope,
    authorizable(value) {
      return (value as NonNullable<TaskPlan['workspace_scope']>).paths.length > 0
        ? undefined
        : 'must contain at least one path'
    },
  },
  scope: stringArraySpec('scope', requireMeaningfulItem),
  acceptance: stringArraySpec('acceptance', requireMeaningfulItem),
  approach: stringArraySpec('approach', requireMeaningfulItem),
  api_assumptions: stringArraySpec('api_assumptions'),
  permission_assumptions: stringArraySpec('permission_assumptions'),
  data_assumptions: stringArraySpec('data_assumptions'),
  user_flow: stringArraySpec('user_flow'),
  out_of_scope: stringArraySpec('out_of_scope'),
  verification_plan: {
    scaffold: verificationPlanScaffold,
    shapeRequired: true,
    writableRequired: false,
    summary:
      'plan.verification_plan: Array<{ name: non-empty string; command: non-empty string[]; kind: "gate" | "diagnostic" }>',
    validateShape: validateVerificationPlan,
    authorizable(value, profile) {
      const verificationPlan = value as TaskPlan['verification_plan']
      if (
        verificationPlan.some((verification) =>
          verification.command.includes(verificationCommandSentinel),
        )
      )
        return `must replace every ${verificationCommandSentinel} sentinel with a real command`
      return profile === 'light' &&
          !verificationPlan.some(
            (verification) => verification.kind === 'gate',
          )
        ? 'must contain at least one gate'
        : undefined
    },
  },
  open_questions: stringArraySpec('open_questions', (value) =>
    (value as string[]).length === 0 ? undefined : 'must be empty'),
} satisfies Record<keyof TaskPlan, PlanFieldSpec>

const planFieldEntries = Object.entries(planFieldSpecs) as Array<
  [keyof TaskPlan, PlanFieldSpec]
>
const requiredPlanFields = planFieldEntries
  .filter(([, spec]) => spec.shapeRequired)
  .map(([field]) => field)
const planSchemaSummary = planFieldEntries
  .map(([, spec]) => spec.summary)
  .join('; ')
const lightPlanFieldEntries = lightPlanCoreFields.map(
  (field) => [field, planFieldSpecs[field]] as const,
)
const lightPlanSchemaSummary = lightPlanFieldEntries
  .map(([, spec]) => spec.summary)
  .join('; ')

export function planTemplate(
  profile: TaskProfile,
): TaskPlan | LightPlanAuthoringInput {
  switch (profile) {
    case 'light':
      return Object.fromEntries(
        lightPlanFieldEntries.map(([field, spec]) => [
          field,
          structuredClone(spec.scaffold),
        ]),
      ) as LightPlanAuthoringInput
    case 'standard':
      return Object.fromEntries(
        planFieldEntries.map(([field, spec]) => [
          field,
          structuredClone(spec.scaffold),
        ]),
      ) as TaskPlan
  }
}

export function assertTaskPlan(
  plan: unknown,
  path: string,
): asserts plan is TaskPlan {
  const minimumPlan = planTemplate('standard')
  if (!isRecord(plan))
    invalidField('plan', 'object', plan, minimumPlan, path)

  const missingFields = requiredPlanFields.filter(
    (field) => plan[field] === undefined,
  )
  if (missingFields.length > 0)
    throw new Error(
      `Missing required plan fields in ${path}: ` +
        `${missingFields.map((field) => `plan.${field}`).join(', ')}. ` +
        `Expected schema: ${planSchemaSummary}. ` +
        `Minimal legal plan: ${JSON.stringify(minimumPlan)}. ` +
        planTemplateHelp,
    )

  for (const [field, spec] of planFieldEntries) {
    const value = plan[field]
    if (value === undefined) continue
    spec.validateShape(value, path)
  }
}

export function assertWritableTaskPlan(
  plan: unknown,
  path: string,
): asserts plan is WritableTaskPlan {
  assertTaskPlan(plan, path)
  const missingFields = planFieldEntries
    .filter(([, spec]) => spec.writableRequired)
    .map(([field]) => field)
    .filter((field) => plan[field] === undefined)
  if (missingFields.length > 0)
    throw new Error(
      `Missing required writable plan fields in ${path}: ` +
        `${missingFields.map((field) => `plan.${field}`).join(', ')}. ` +
      planTemplateHelp,
    )
}

function assertLightPlanAuthoringInput(
  plan: unknown,
  path: string,
): asserts plan is LightPlanAuthoringInput {
  const minimumPlan = planTemplate('light')
  if (!isRecord(plan))
    invalidField('plan', 'object', plan, minimumPlan, path)

  const missingFields = lightPlanCoreFields.filter(
    (field) => plan[field] === undefined,
  )
  if (missingFields.length > 0)
    throw new Error(
      `Missing required Light plan fields in ${path}: ` +
        `${missingFields.map((field) => `plan.${field}`).join(', ')}. ` +
        `Expected Light authoring schema: ${lightPlanSchemaSummary}. ` +
        `Minimal legal plan: ${JSON.stringify(minimumPlan)}. ` +
        planTemplateHelp,
    )

  for (const [field, spec] of lightPlanFieldEntries)
    spec.validateShape(plan[field], path)
}

export function normalizeTaskPlanInput(
  plan: unknown,
  profile: TaskProfile,
  path: string,
): WritableTaskPlan {
  if (profile === 'standard') {
    assertWritableTaskPlan(plan, path)
    return plan
  }

  assertLightPlanAuthoringInput(plan, path)
  const normalized = {
    ...Object.fromEntries(
      lightPlanDefaultFields.map((field) => [field, []]),
    ),
    ...plan,
  }
  assertWritableTaskPlan(normalized, path)
  return normalized
}

function notAuthorizable(
  profile: TaskProfile,
  field: string,
  requirement: string,
  path: string,
): never {
  throw new Error(
    `Plan is not authorizable for profile=${profile} in ${path}: ` +
      `plan.${field} ${requirement}. Printed scaffolds prove shape validity only; ` +
      'complete the plan before creating work_basis.',
  )
}

export function assertAuthorizableTaskPlan(
  plan: unknown,
  profile: TaskProfile,
  path: string,
): asserts plan is WritableTaskPlan {
  assertWritableTaskPlan(plan, path)
  for (const [field, spec] of planFieldEntries) {
    const requirement = spec.authorizable?.(plan[field], profile)
    if (requirement) notAuthorizable(profile, field, requirement, path)
  }
}
