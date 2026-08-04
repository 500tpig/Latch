import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const cli = join(process.cwd(), 'dist/cli.js')
const temporaryDirectories = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'latch-cli-benchmark-'))
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
    ...runValue(overrides),
    path: 'broad',
    tool_steps_to_first_actionable: 6,
    chars_read: 1_000,
    estimated_tokens: 250,
  }
}

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
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
  ], { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.benchmark.pass_main, true)
  assert.equal(output.benchmark.token_goal_miss, false)
  assert.equal('pack' in output, false)
})
