import { parseArgs, type ParseArgsConfig } from 'node:util'
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

export function readInputFile<T>(
  cwd: string,
  path: string | undefined,
  option: string,
) {
  if (!path) fail('invalid_arguments', `${option} is required.`)
  return readJsonFile<T>(resolve(cwd, path))
}

export function validateBrief(
  jsonOutput: boolean | undefined,
  brief: boolean | undefined,
) {
  if (brief && !jsonOutput)
    fail('invalid_arguments', '--brief requires --json.')
}
