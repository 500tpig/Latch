import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  evaluateContextBenchmark,
  parseContextBenchCase,
  parseContextBenchRun,
} from '../dist/core/context-benchmark.js'

const cli = join(process.cwd(), 'dist/cli.js')
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-context-bench-'))
  temporaryDirectories.push(directory)
  return directory
}

function fixture(name) {
  return JSON.parse(readFileSync(
    join(process.cwd(), 'benchmarks', 'context', 'cases', name),
    'utf8',
  ))
}

function runValue(overrides = {}) {
  return {
    case_id: 'cross-file-cli',
    path: 'context_pack',
    tool_steps_to_first_actionable: 3,
    chars_read: 600,
    estimated_tokens: 150,
    critical_hits: ['src/cli.ts', 'src/core/context-pack.ts'],
    critical_misses: [],
    wrong_doc: false,
    freshness_failures: 0,
    ...overrides,
  }
}

function broadValue(overrides = {}) {
  return {
    case_id: 'cross-file-cli',
    path: 'broad',
    tool_steps_to_first_actionable: 6,
    chars_read: 1_000,
    estimated_tokens: 250,
    critical_hits: ['src/cli.ts', 'src/core/context-pack.ts'],
    critical_misses: [],
    wrong_doc: false,
    freshness_failures: 0,
    ...overrides,
  }
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test('all three benchmark case fixtures satisfy the contract', () => {
  for (const name of [
    'cross-file-cli.json',
    'doc-route-knowledge.json',
    'regression-budget.json',
  ]) {
    const value = parseContextBenchCase(fixture(name))
    assert.ok(value.gold_critical.length > 0)
    assert.ok(value.baseline_broad_entry.length > 0)
  }
})

test('benchmark separates main success from the 30 percent token goal', () => {
  const benchmarkCase = parseContextBenchCase(fixture('cross-file-cli.json'))
  const passed = evaluateContextBenchmark(
    benchmarkCase,
    parseContextBenchRun(runValue()),
    parseContextBenchRun(broadValue()),
  )
  assert.equal(passed.pass_main, true)
  assert.equal(passed.comparison_metric, 'estimated_tokens')
  assert.equal(passed.reduction_ratio, 0.4)
  assert.equal(passed.token_goal_miss, false)

  const goalMiss = evaluateContextBenchmark(
    benchmarkCase,
    parseContextBenchRun(runValue({ estimated_tokens: 200 })),
    parseContextBenchRun(broadValue()),
  )
  assert.equal(goalMiss.pass_main, true)
  assert.equal(goalMiss.token_goal_miss, true)
})

test('critical misses, wrong docs, slow evidence, and freshness failures fail main', () => {
  const benchmarkCase = parseContextBenchCase(fixture('cross-file-cli.json'))
  const result = evaluateContextBenchmark(
    benchmarkCase,
    parseContextBenchRun(runValue({
      tool_steps_to_first_actionable: 9,
      critical_hits: [],
      critical_misses: ['src/cli.ts', 'src/core/context-pack.ts'],
      wrong_doc: true,
      freshness_failures: 1,
    })),
  )
  assert.equal(result.pass_main, false)
  assert.deepEqual(result.failures, [
    'critical_misses',
    'wrong_doc',
    'tool_step_limit',
    'freshness_failures',
  ])
  assert.throws(
    () => evaluateContextBenchmark(
      benchmarkCase,
      parseContextBenchRun(runValue({
        critical_hits: ['src/cli.ts'],
        critical_misses: [],
      })),
    ),
    /does not classify critical entry/,
  )
})

test('benchmark context CLI evaluates supplied case and run files only', () => {
  const cwd = temporaryDirectory()
  writeFileSync(join(cwd, 'case.json'), JSON.stringify(fixture('cross-file-cli.json')))
  writeFileSync(join(cwd, 'run.json'), JSON.stringify(runValue()))
  writeFileSync(join(cwd, 'broad.json'), JSON.stringify(broadValue()))
  const result = spawnSync(process.execPath, [
    cli,
    'benchmark',
    'context',
    '--case-file', 'case.json',
    '--run-file', 'run.json',
    '--baseline-run-file', 'broad.json',
    '--json',
  ], {
    cwd,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.benchmark.pass_main, true)
  assert.equal(output.benchmark.token_goal_miss, false)
  assert.equal('pack' in output, false)
})
