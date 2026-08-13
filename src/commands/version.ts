import { readFileSync } from 'node:fs'
import { fail, json } from '../cli-support.js'
import { jsonEnvelopeV3 } from '../core/task-view.js'

const versionUsage = 'Usage: latch --version [--json]'

function cliVersion() {
  const metadata = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as unknown
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('version' in metadata) ||
    typeof metadata.version !== 'string' ||
    metadata.version.length === 0
  )
    throw new Error(
      'Invalid CLI package metadata: version must be a non-empty string.',
    )
  return metadata.version
}

export function runVersion(argv: string[]) {
  const versionCount = argv.filter((arg) => arg === '--version').length
  const jsonCount = argv.filter((arg) => arg === '--json').length
  const unexpected = argv.filter(
    (arg) => arg !== '--version' && arg !== '--json',
  )
  if (versionCount !== 1 || jsonCount > 1 || unexpected.length > 0)
    fail('invalid_arguments', versionUsage)

  const version = cliVersion()
  if (!argv.includes('--json')) {
    process.stdout.write(`${version}\n`)
    return
  }
  json({
    ...jsonEnvelopeV3(),
    cli_version: version,
    envelope_schema_version: 3,
    current_task_schema_version: 5,
    historical_readable_task_schema_versions: [2, 3, 4],
  })
}
