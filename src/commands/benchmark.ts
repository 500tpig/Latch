import {
  assertSingleStdinInput,
  commonOptions,
  fail,
  json,
  parseCommand,
  readInputFile,
} from '../cli-support.js'
import {
  evaluateContextBenchmark,
  parseContextBenchCase,
  parseContextBenchRun,
} from '../core/context-benchmark.js'
import { jsonEnvelopeV3 } from '../core/task-view.js'

export const benchmarkUsage =
  'Usage: latch benchmark context --case-file <path|-> --run-file <path|-> [--baseline-run-file <path|->] [--json]'

export function runBenchmark(args: string[], cwd: string) {
  const subject = args[0]
  if (!subject || subject === '--help' || subject === '-h')
    return process.stdout.write(`${benchmarkUsage}\n`)
  if (subject !== 'context')
    fail('invalid_arguments', `Unknown benchmark command: ${subject}\n${benchmarkUsage}`)
  const parsed = parseCommand(args.slice(1), {
    ...commonOptions(),
    'case-file': { type: 'string' },
    'run-file': { type: 'string' },
    'baseline-run-file': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${benchmarkUsage}\n`)
  if (parsed.positionals.length > 0)
    fail('invalid_arguments', benchmarkUsage)
  assertSingleStdinInput([
    ['--case-file', parsed.values['case-file']],
    ['--run-file', parsed.values['run-file']],
    ['--baseline-run-file', parsed.values['baseline-run-file']],
  ])
  const benchmarkCase = parseContextBenchCase(
    readInputFile<unknown>(cwd, parsed.values['case-file'], '--case-file'),
  )
  const run = parseContextBenchRun(
    readInputFile<unknown>(cwd, parsed.values['run-file'], '--run-file'),
  )
  const baseline = parsed.values['baseline-run-file']
    ? parseContextBenchRun(
        readInputFile<unknown>(
          cwd,
          parsed.values['baseline-run-file'],
          '--baseline-run-file',
        ),
      )
    : undefined
  const result = evaluateContextBenchmark(benchmarkCase, run, baseline)
  if (parsed.values.json)
    return json({ ...jsonEnvelopeV3(), benchmark: result })
  process.stdout.write([
    `Benchmark: ${result.case_id}`,
    `Main: ${result.pass_main ? 'pass' : 'fail'}`,
    `Failures: ${result.failures.join(', ') || '-'}`,
    ...(result.token_goal_evaluated
      ? [`Token goal: ${result.token_goal_miss ? 'miss' : 'pass'}`]
      : ['Token goal: not evaluated']),
  ].join('\n') + '\n')
}
