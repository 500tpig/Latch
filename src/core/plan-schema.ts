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

export type PlanValidationIssueReason =
  | 'required'
  | 'type_mismatch'
  | 'invalid_value'
  | 'duplicate'
  | 'non_empty_required'
  | 'directory_suffix_required'
  | 'sentinel_not_replaced'
  | 'gate_required'
  | 'must_be_empty'

export type PlanValidationIssue = {
  path: string
  reason: PlanValidationIssueReason
  expected?: string
  actual_type?: string
  actual_value?: string
  minimal_legal_value?: unknown
}

export class PlanValidationError extends Error {
  constructor(
    message: string,
    readonly issues: PlanValidationIssue[],
  ) {
    super(message)
    this.name = 'PlanValidationError'
  }
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
  jsonPath: string
  expected: string
  validateShape: (value: unknown, path: string) => void
  authorizable?: (
    value: unknown,
    profile: TaskProfile,
  ) => AuthorizableRequirement | AuthorizableRequirement[] | undefined
}

type AuthorizableRequirement = {
  requirement: string
  issue: PlanValidationIssue
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

function machineActualType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
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
  jsonPath: string,
  machineExpected = expected,
): never {
  throw new PlanValidationError(
    invalidFieldMessage(field, expected, value, minimumLegalValue, path),
    [{
      path: jsonPath,
      reason: 'type_mismatch',
      expected: machineExpected,
      actual_type: machineActualType(value),
      minimal_legal_value: minimumLegalValue,
    }],
  )
}

function requireString(
  value: unknown,
  field: string,
  path: string,
  minimumLegalValue: string,
  jsonPath: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '')
    invalidField(
      field,
      'non-empty string',
      value,
      minimumLegalValue,
      path,
      jsonPath,
      'non_empty_string',
    )
}

function requireStringArray(
  value: unknown,
  field: string,
  path: string,
  minimumLegalValue: string[] = [],
  jsonPath: string,
): asserts value is string[] {
  if (!Array.isArray(value))
    invalidField(
      field,
      'string[]',
      value,
      minimumLegalValue,
      path,
      jsonPath,
      'string_array',
    )
  const invalidIndex = value.findIndex((entry) => typeof entry !== 'string')
  if (invalidIndex >= 0)
    throw new PlanValidationError(
      invalidFieldMessage(field, 'string[]', value, minimumLegalValue, path),
      [{
        path: `${jsonPath}/${invalidIndex}`,
        reason: 'type_mismatch',
        expected: 'string',
        actual_type: machineActualType(value[invalidIndex]),
        minimal_legal_value: '',
      }],
    )
}

function invalidWorkspaceScopePath(
  value: string,
  index: number,
  message: string,
): never {
  throw new PlanValidationError(message, [{
    path: `/workspace_scope/paths/${index}`,
    reason: 'invalid_value',
    expected: 'repo_relative_posix_path',
    actual_type: 'string',
    actual_value: value,
  }])
}

function normalizeWorkspaceScopePath(value: string, path: string, index: number) {
  if (value === '' || value === '.' || value === '..')
    invalidWorkspaceScopePath(
      value,
      index,
      `Invalid plan.workspace_scope.paths in ${path}: empty or root path.`,
    )
  if (
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes('\\') ||
    value.startsWith(':') ||
    /[*?[\]]/.test(value) ||
    value.includes('\0')
  )
    invalidWorkspaceScopePath(
      value,
      index,
      `Invalid plan.workspace_scope.paths in ${path}: ${value}.`,
    )
  const directory = value.endsWith('/')
  const normalized = posix.normalize(value)
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.split('/').includes('..')
  )
    invalidWorkspaceScopePath(
      value,
      index,
      `Invalid plan.workspace_scope.paths in ${path}: ${value}.`,
    )
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
      '/workspace_scope',
      'workspace_scope',
    )
  requireStringArray(
    value.paths,
    'plan.workspace_scope.paths',
    path,
    [],
    '/workspace_scope/paths',
  )
  value.paths = [
    ...new Set(
      value.paths.map((entry, index) =>
        normalizeWorkspaceScopePath(entry, path, index)),
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
      '/verification_plan',
      'verification_plan',
    )

  const errors: string[] = []
  const issues: PlanValidationIssue[] = []
  const verificationNames = new Set<string>()
  const exampleItem = verificationPlanScaffold[0]
  for (const [index, verification] of value.entries()) {
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
      issues.push({
        path: `/verification_plan/${index}`,
        reason: 'type_mismatch',
        expected: 'verification_item',
        actual_type: machineActualType(verification),
        minimal_legal_value: exampleItem,
      })
      continue
    }
    if (typeof verification.name !== 'string' || verification.name.trim() === '') {
      errors.push(
        invalidFieldMessage(
          'verification_plan.name',
          'non-empty string',
          verification.name,
          'check',
          path,
        ),
      )
      issues.push({
        path: `/verification_plan/${index}/name`,
        reason: typeof verification.name === 'string'
          ? 'non_empty_required'
          : 'type_mismatch',
        expected: 'non_empty_string',
        actual_type: machineActualType(verification.name),
        ...(typeof verification.name === 'string'
          ? { actual_value: verification.name }
          : {}),
        minimal_legal_value: 'check',
      })
    } else if (verificationNames.has(verification.name)) {
      errors.push(
        `Duplicate verification_plan.name in ${path}: ${verification.name}.`,
      )
      issues.push({
        path: `/verification_plan/${index}/name`,
        reason: 'duplicate',
        expected: 'unique_verification_name',
        actual_type: 'string',
        actual_value: verification.name,
      })
    } else verificationNames.add(verification.name)
    if (
      !Array.isArray(verification.command) ||
      verification.command.some((entry) => typeof entry !== 'string')
    ) {
      errors.push(
        invalidFieldMessage(
          'verification_plan.command',
          'string[]',
          verification.command,
          [verificationCommandSentinel],
          path,
        ),
      )
      issues.push({
        path: `/verification_plan/${index}/command`,
        reason: 'type_mismatch',
        expected: 'non_empty_string_array',
        actual_type: machineActualType(verification.command),
        minimal_legal_value: [verificationCommandSentinel],
      })
    } else if (verification.command.length === 0) {
      errors.push(
        `Invalid empty verification_plan.command in ${path}: expected non-empty string[], got empty array. ` +
          `Minimal legal value: ${JSON.stringify([verificationCommandSentinel])}. ` +
          planTemplateHelp,
      )
      issues.push({
        path: `/verification_plan/${index}/command`,
        reason: 'non_empty_required',
        expected: 'non_empty_string_array',
        actual_type: 'array',
        minimal_legal_value: [verificationCommandSentinel],
      })
    }
    if (verification.kind !== 'gate' && verification.kind !== 'diagnostic') {
      errors.push(
        invalidFieldMessage(
          'verification_plan.kind',
          '"gate" | "diagnostic"',
          verification.kind,
          'gate',
          path,
        ),
      )
      issues.push({
        path: `/verification_plan/${index}/kind`,
        reason: typeof verification.kind === 'string'
          ? 'invalid_value'
          : 'type_mismatch',
        expected: 'gate_or_diagnostic',
        actual_type: machineActualType(verification.kind),
        ...(typeof verification.kind === 'string'
          ? { actual_value: verification.kind }
          : {}),
        minimal_legal_value: 'gate',
      })
    }
  }
  if (errors.length > 0)
    throw new PlanValidationError(errors.join('; '), issues)
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
    jsonPath: `/${field}`,
    expected: 'string_array',
    validateShape(value, path) {
      requireStringArray(value, `plan.${field}`, path, [], `/${field}`)
    },
    ...(authorizable ? { authorizable } : {}),
  }
}

function requireMeaningfulItem(field: 'scope' | 'acceptance' | 'approach') {
  return (value: unknown): AuthorizableRequirement | undefined =>
    (value as string[]).some((entry) => entry.trim() !== '')
      ? undefined
      : {
          requirement: 'must contain at least one non-empty item',
          issue: {
            path: `/${field}`,
            reason: 'non_empty_required',
            expected: 'string_array_with_non_empty_item',
          },
        }
}

const planFieldSpecs = {
  goal: {
    scaffold: 'Describe the intended outcome.',
    shapeRequired: true,
    writableRequired: false,
    summary: 'plan.goal: non-empty string',
    jsonPath: '/goal',
    expected: 'non_empty_string',
    validateShape(value, path) {
      requireString(
        value,
        'plan.goal',
        path,
        'Describe the intended outcome.',
        '/goal',
      )
    },
    authorizable(value) {
      return typeof value === 'string' && value.trim() !== ''
        ? undefined
        : {
            requirement: 'must be non-empty',
            issue: {
              path: '/goal',
              reason: 'non_empty_required',
              expected: 'non_empty_string',
              minimal_legal_value: 'Describe the intended outcome.',
            },
          }
    },
  },
  workspace_scope: {
    scaffold: { paths: [] },
    shapeRequired: false,
    writableRequired: true,
    summary: 'plan.workspace_scope: { paths: repo-relative POSIX path[] }',
    jsonPath: '/workspace_scope',
    expected: 'workspace_scope',
    validateShape: validateWorkspaceScope,
    authorizable(value) {
      return (value as NonNullable<TaskPlan['workspace_scope']>).paths.length > 0
        ? undefined
        : {
            requirement: 'must contain at least one path',
            issue: {
              path: '/workspace_scope/paths',
              reason: 'non_empty_required',
              expected: 'non_empty_repo_relative_posix_path_array',
            },
          }
    },
  },
  scope: stringArraySpec('scope', requireMeaningfulItem('scope')),
  acceptance: stringArraySpec(
    'acceptance',
    requireMeaningfulItem('acceptance'),
  ),
  approach: stringArraySpec('approach', requireMeaningfulItem('approach')),
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
    jsonPath: '/verification_plan',
    expected: 'verification_plan',
    validateShape: validateVerificationPlan,
    authorizable(value, profile) {
      const verificationPlan = value as TaskPlan['verification_plan']
      const sentinels = verificationPlan.flatMap((verification, index) =>
        verification.command.includes(verificationCommandSentinel)
          ? [{
              requirement:
                `must replace every ${verificationCommandSentinel} sentinel with a real command`,
              issue: {
                path: `/verification_plan/${index}/command`,
                reason: 'sentinel_not_replaced' as const,
                expected: 'real_command_argv',
              },
            }]
          : [])
      if (sentinels.length > 0) return sentinels
      return profile === 'light' &&
          !verificationPlan.some(
            (verification) => verification.kind === 'gate',
          )
        ? {
            requirement: 'must contain at least one gate',
            issue: {
              path: '/verification_plan',
              reason: 'gate_required',
              expected: 'verification_plan_with_gate',
            },
          }
        : undefined
    },
  },
  open_questions: stringArraySpec('open_questions', (value) =>
    (value as string[]).length === 0
      ? undefined
      : {
          requirement: 'must be empty',
          issue: {
            path: '/open_questions',
            reason: 'must_be_empty',
            expected: 'empty_array',
            minimal_legal_value: [],
          },
        }),
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
    invalidField('plan', 'object', plan, minimumPlan, path, '', 'object')

  const missingFields = requiredPlanFields.filter(
    (field) => plan[field] === undefined,
  )
  if (missingFields.length > 0)
    throw new PlanValidationError(
      `Missing required plan fields in ${path}: ` +
        `${missingFields.map((field) => `plan.${field}`).join(', ')}. ` +
        `Expected schema: ${planSchemaSummary}. ` +
        `Minimal legal plan: ${JSON.stringify(minimumPlan)}. ` +
        planTemplateHelp,
      missingFields.map((field) => ({
        path: planFieldSpecs[field].jsonPath,
        reason: 'required',
        expected: planFieldSpecs[field].expected,
        minimal_legal_value: structuredClone(planFieldSpecs[field].scaffold),
      })),
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
    throw new PlanValidationError(
      `Missing required writable plan fields in ${path}: ` +
        `${missingFields.map((field) => `plan.${field}`).join(', ')}. ` +
      planTemplateHelp,
      missingFields.map((field) => ({
        path: planFieldSpecs[field].jsonPath,
        reason: 'required',
        expected: planFieldSpecs[field].expected,
        minimal_legal_value: structuredClone(planFieldSpecs[field].scaffold),
      })),
    )
}

function assertLightPlanAuthoringInput(
  plan: unknown,
  path: string,
): asserts plan is LightPlanAuthoringInput {
  const minimumPlan = planTemplate('light')
  if (!isRecord(plan))
    invalidField('plan', 'object', plan, minimumPlan, path, '', 'object')

  const missingFields = lightPlanCoreFields.filter(
    (field) => plan[field] === undefined,
  )
  if (missingFields.length > 0)
    throw new PlanValidationError(
      `Missing required Light plan fields in ${path}: ` +
        `${missingFields.map((field) => `plan.${field}`).join(', ')}. ` +
        `Expected Light authoring schema: ${lightPlanSchemaSummary}. ` +
        `Minimal legal plan: ${JSON.stringify(minimumPlan)}. ` +
        planTemplateHelp,
      missingFields.map((field) => ({
        path: planFieldSpecs[field].jsonPath,
        reason: 'required',
        expected: planFieldSpecs[field].expected,
        minimal_legal_value: structuredClone(planFieldSpecs[field].scaffold),
      })),
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
  requirements: AuthorizableRequirement[],
  path: string,
): never {
  throw new PlanValidationError(
    `Plan is not authorizable for profile=${profile} in ${path}: ` +
      `plan.${field} ${requirements[0].requirement}. ` +
      'Printed scaffolds prove shape validity only; complete the plan before creating work_basis.',
    requirements.map((requirement) => requirement.issue),
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
    if (requirement)
      notAuthorizable(
        profile,
        field,
        Array.isArray(requirement) ? requirement : [requirement],
        path,
      )
  }
}
