import { isAbsolute, posix } from 'node:path'

export type ContextBenchCase = {
  id: string
  title: string
  kind: 'cross_file' | 'doc_route' | 'regression'
  prompt: string
  gold_critical: string[]
  gold_optional?: string[]
  baseline_broad_entry: string[]
  max_tool_steps_main: number
}

export type ContextBenchRun = {
  case_id: string
  path: 'broad' | 'rg' | 'codegraph' | 'context_pack'
  tool_steps_to_first_actionable: number | null
  chars_read: number
  estimated_tokens?: number
  critical_hits: string[]
  critical_misses: string[]
  wrong_doc: boolean
  freshness_failures: number
  pack_meta?: {
    orientation_id: string
    char_count: number
    char_budget: number
    truncated: boolean
    sources: Array<{ kind: string; path?: string; freshness?: string }>
    expand_batches: number
    expand_chars_cum: number
  }
}

export type ContextBenchmarkResult = {
  case_id: string
  pass_main: boolean
  failures: string[]
  token_goal_evaluated: boolean
  comparison_metric?: 'estimated_tokens' | 'chars_read'
  reduction_ratio?: number
  token_goal_miss?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Invalid context benchmark ${field}.`)
  return value
}

function integer(value: unknown, field: string, minimum: number) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new Error(`Invalid context benchmark ${field}.`)
  return value as number
}

function stringArray(value: unknown, field: string) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || entry.trim() === '')
  )
    throw new Error(`Invalid context benchmark ${field}.`)
  const values = [...value] as string[]
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate context benchmark ${field}.`)
  return values
}

function relativePaths(value: unknown, field: string) {
  const values = stringArray(value, field)
  for (const path of values) {
    const normalized = path.replaceAll('\\', '/')
    if (
      normalized.startsWith('/') ||
      /^[A-Za-z]:\//.test(normalized) ||
      isAbsolute(normalized) ||
      normalized.split('/').includes('..') ||
      posix.normalize(normalized) === '.' ||
      posix.normalize(normalized).startsWith('../')
    )
      throw new Error(`Invalid context benchmark ${field} path: ${path}.`)
  }
  return values
}

export function parseContextBenchCase(value: unknown): ContextBenchCase {
  if (!isRecord(value)) throw new Error('Invalid context benchmark case.')
  if (value.kind !== 'cross_file' && value.kind !== 'doc_route' && value.kind !== 'regression')
    throw new Error('Invalid context benchmark case.kind.')
  const maxSteps = value.max_tool_steps_main === undefined
    ? 8
    : integer(value.max_tool_steps_main, 'case.max_tool_steps_main', 1)
  const optional = value.gold_optional === undefined
    ? undefined
    : relativePaths(value.gold_optional, 'case.gold_optional')
  const goldCritical = relativePaths(value.gold_critical, 'case.gold_critical')
  const broadEntry = relativePaths(
    value.baseline_broad_entry,
    'case.baseline_broad_entry',
  )
  if (goldCritical.length === 0 || broadEntry.length === 0)
    throw new Error('Context benchmark critical and broad entry lists cannot be empty.')
  return {
    id: requireString(value.id, 'case.id'),
    title: requireString(value.title, 'case.title'),
    kind: value.kind,
    prompt: requireString(value.prompt, 'case.prompt'),
    gold_critical: goldCritical,
    ...(optional === undefined ? {} : { gold_optional: optional }),
    baseline_broad_entry: broadEntry,
    max_tool_steps_main: maxSteps,
  }
}

function parsePackMeta(value: unknown): ContextBenchRun['pack_meta'] {
  if (!isRecord(value)) throw new Error('Invalid context benchmark run.pack_meta.')
  if (typeof value.truncated !== 'boolean' || !Array.isArray(value.sources))
    throw new Error('Invalid context benchmark run.pack_meta.')
  const sources = value.sources.map((source, index) => {
    if (!isRecord(source))
      throw new Error(`Invalid context benchmark run.pack_meta.sources[${index}].`)
    return {
      kind: requireString(source.kind, `run.pack_meta.sources[${index}].kind`),
      ...(source.path === undefined
        ? {}
        : { path: requireString(source.path, `run.pack_meta.sources[${index}].path`) }),
      ...(source.freshness === undefined
        ? {}
        : {
            freshness: requireString(
              source.freshness,
              `run.pack_meta.sources[${index}].freshness`,
            ),
          }),
    }
  })
  return {
    orientation_id: requireString(value.orientation_id, 'run.pack_meta.orientation_id'),
    char_count: integer(value.char_count, 'run.pack_meta.char_count', 0),
    char_budget: integer(value.char_budget, 'run.pack_meta.char_budget', 1),
    truncated: value.truncated,
    sources,
    expand_batches: integer(value.expand_batches, 'run.pack_meta.expand_batches', 0),
    expand_chars_cum: integer(value.expand_chars_cum, 'run.pack_meta.expand_chars_cum', 0),
  }
}

export function parseContextBenchRun(value: unknown): ContextBenchRun {
  if (!isRecord(value)) throw new Error('Invalid context benchmark run.')
  if (
    value.path !== 'broad' &&
    value.path !== 'rg' &&
    value.path !== 'codegraph' &&
    value.path !== 'context_pack'
  )
    throw new Error('Invalid context benchmark run.path.')
  const steps = value.tool_steps_to_first_actionable === null
    ? null
    : integer(
        value.tool_steps_to_first_actionable,
        'run.tool_steps_to_first_actionable',
        0,
      )
  const estimatedTokens = value.estimated_tokens === undefined
    ? undefined
    : integer(value.estimated_tokens, 'run.estimated_tokens', 0)
  if (typeof value.wrong_doc !== 'boolean')
    throw new Error('Invalid context benchmark run.wrong_doc.')
  return {
    case_id: requireString(value.case_id, 'run.case_id'),
    path: value.path,
    tool_steps_to_first_actionable: steps,
    chars_read: integer(value.chars_read, 'run.chars_read', 0),
    ...(estimatedTokens === undefined ? {} : { estimated_tokens: estimatedTokens }),
    critical_hits: stringArray(value.critical_hits, 'run.critical_hits'),
    critical_misses: stringArray(value.critical_misses, 'run.critical_misses'),
    wrong_doc: value.wrong_doc,
    freshness_failures: integer(
      value.freshness_failures,
      'run.freshness_failures',
      0,
    ),
    ...(value.pack_meta === undefined ? {} : { pack_meta: parsePackMeta(value.pack_meta) }),
  }
}

function validateCriticalClassification(
  benchmarkCase: ContextBenchCase,
  run: ContextBenchRun,
) {
  const gold = new Set(benchmarkCase.gold_critical)
  const hits = new Set(run.critical_hits)
  const misses = new Set(run.critical_misses)
  for (const value of [...hits, ...misses])
    if (!gold.has(value))
      throw new Error(`Context benchmark run classifies non-critical entry: ${value}.`)
  for (const value of hits)
    if (misses.has(value))
      throw new Error(`Context benchmark run classifies critical entry twice: ${value}.`)
  for (const value of gold)
    if (!hits.has(value) && !misses.has(value))
      throw new Error(`Context benchmark run does not classify critical entry: ${value}.`)
}

export function evaluateContextBenchmark(
  benchmarkCase: ContextBenchCase,
  run: ContextBenchRun,
  broadBaseline?: ContextBenchRun,
): ContextBenchmarkResult {
  if (run.case_id !== benchmarkCase.id)
    throw new Error('Context benchmark run case_id does not match case.id.')
  if (run.path !== 'context_pack')
    throw new Error('Context benchmark main run must use path=context_pack.')
  validateCriticalClassification(benchmarkCase, run)
  if (broadBaseline) {
    if (broadBaseline.case_id !== benchmarkCase.id || broadBaseline.path !== 'broad')
      throw new Error('Context benchmark baseline must match the case and use path=broad.')
  }

  const failures: string[] = []
  if (run.critical_misses.length > 0) failures.push('critical_misses')
  if (run.wrong_doc) failures.push('wrong_doc')
  if (run.tool_steps_to_first_actionable === null)
    failures.push('no_actionable_evidence')
  else if (run.tool_steps_to_first_actionable > benchmarkCase.max_tool_steps_main)
    failures.push('tool_step_limit')
  if (run.freshness_failures > 0) failures.push('freshness_failures')
  if (run.pack_meta && run.pack_meta.char_count > run.pack_meta.char_budget)
    failures.push('pack_budget_exceeded')
  const passMain = failures.length === 0

  if (!broadBaseline)
    return {
      case_id: benchmarkCase.id,
      pass_main: passMain,
      failures,
      token_goal_evaluated: false,
    }

  const useTokens =
    broadBaseline.estimated_tokens !== undefined &&
    run.estimated_tokens !== undefined &&
    broadBaseline.estimated_tokens > 0
  const baselineValue = useTokens
    ? broadBaseline.estimated_tokens!
    : broadBaseline.chars_read
  const runValue = useTokens ? run.estimated_tokens! : run.chars_read
  if (baselineValue <= 0)
    return {
      case_id: benchmarkCase.id,
      pass_main: passMain,
      failures,
      token_goal_evaluated: false,
    }
  const reduction = (baselineValue - runValue) / baselineValue
  return {
    case_id: benchmarkCase.id,
    pass_main: passMain,
    failures,
    token_goal_evaluated: true,
    comparison_metric: useTokens ? 'estimated_tokens' : 'chars_read',
    reduction_ratio: reduction,
    token_goal_miss: passMain && reduction < 0.3,
  }
}
