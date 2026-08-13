import { parseArgs, type ParseArgsConfig } from 'node:util'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readJsonFile } from './core/utils.js'

export class CliV2Error extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function fail(code: string, message: string): never {
  throw new CliV2Error(code, message)
}

export function positiveInteger(raw: string | undefined, name: string) {
  if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1)
    fail('invalid_arguments', `${name} must be a positive integer.`)
  return Number(raw)
}

export function boundedPositiveInteger(
  raw: string | undefined,
  name: string,
  maximum: number,
) {
  if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > maximum)
    fail(
      'invalid_arguments',
      `${name} must be a decimal integer from 1 to ${maximum}.`,
    )
  return Number(raw)
}

export function assertOptionNotRepeated(args: string[], name: string) {
  let count = 0
  for (const argument of args) {
    if (argument === '--') break
    if (argument === name || argument.startsWith(`${name}=`)) count += 1
  }
  if (count > 1) fail('invalid_arguments', `${name} may only be provided once.`)
}

export function json(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function printWarnings(warnings: string[]) {
  for (const warning of warnings) process.stderr.write(`Warning: ${warning}\n`)
}

export function parseCommand<
  T extends NonNullable<ParseArgsConfig['options']>,
>(args: string[], options: T) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail('invalid_arguments', message)
  }
}

export function commonOptions() {
  return {
    help: { type: 'boolean', short: 'h' },
    json: { type: 'boolean' },
  } as const
}

export function assertSingleStdinInput(
  inputs: Array<[option: string, path: string | undefined]>,
) {
  const consumers = inputs
    .filter(([, path]) => path === '-')
    .map(([option]) => option)
  if (consumers.length > 1)
    fail(
      'invalid_arguments',
      `Only one structured JSON file option may use stdin (-) per command: ${consumers.join(', ')}.`,
    )
}

let stdinConsumed = false

function readStdinJson<T>(option: string) {
  if (stdinConsumed)
    fail('invalid_arguments', 'Structured JSON stdin may only be read once per command.')
  stdinConsumed = true
  let content: string
  try {
    content = readFileSync(0, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail('invalid_arguments', `Cannot read ${option} from stdin: ${message}`)
  }
  if (!content.trim())
    fail('invalid_arguments', `Cannot read ${option} from stdin: input is empty.`)
  try {
    return JSON.parse(content) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail('invalid_arguments', `Cannot parse ${option} from stdin as JSON: ${message}`)
  }
}

export function readInputFile<T>(
  cwd: string,
  path: string | undefined,
  option: string,
) {
  if (!path) fail('invalid_arguments', `${option} is required.`)
  if (path === '-') return readStdinJson<T>(option)
  return readJsonFile<T>(resolve(cwd, path))
}

export function validateBrief(
  jsonOutput: boolean | undefined,
  brief: boolean | undefined,
) {
  if (brief && !jsonOutput)
    fail('invalid_arguments', '--brief requires --json.')
}
