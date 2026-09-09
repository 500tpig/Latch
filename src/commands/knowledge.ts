import {
  commonOptions,
  fail,
  json,
  parseCommand,
} from '../cli-support.js'
import {
  checkKnowledgeDocument,
  checkTaskKnowledgeDocuments,
  fingerprintKnowledgeDocument,
  type KnowledgeCheckResult,
} from '../core/knowledge.js'
import { discoverWorkspaceRoot } from '../core/paths.js'
import { jsonEnvelopeV3 } from '../core/task-view.js'
import { openTaskStoreV2, readTaskV2 } from '../core/task-store.js'

export const knowledgeUsage =
  'Usage: latch knowledge fingerprint --path <path> [--json]\n       latch knowledge check (--path <path> | --task <task-id>) [--json]'

function knowledgeCheckHuman(result: KnowledgeCheckResult) {
  return [
    `Knowledge: ${result.path}`,
    `Freshness: ${result.freshness}`,
    `Review needed: ${result.review_needed ? 'yes' : 'no'}`,
    ...(result.fingerprint ? [`Fingerprint: ${result.fingerprint}`] : []),
    `Files: ${result.files.length}`,
    ...(result.error ? [`Error: ${result.error}`] : []),
    ...result.warnings.map((warning) => `Warning: ${warning}`),
  ].join('\n')
}

export function runKnowledge(args: string[], cwd: string) {
  const action = args[0]
  if (!action || action === '--help' || action === '-h')
    return process.stdout.write(`${knowledgeUsage}\n`)
  if (action !== 'fingerprint' && action !== 'check')
    fail('invalid_arguments', `Unknown knowledge command: ${action}\n${knowledgeUsage}`)

  const parsed = parseCommand(args.slice(1), {
    ...commonOptions(),
    path: { type: 'string' },
    task: { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${knowledgeUsage}\n`)
  if (parsed.positionals.length > 0)
    fail('invalid_arguments', knowledgeUsage)

  if (action === 'fingerprint') {
    if (!parsed.values.path || parsed.values.task)
      fail('invalid_arguments', 'knowledge fingerprint requires --path and does not accept --task.')
    const workspaceRoot = discoverWorkspaceRoot(cwd, { forInit: true })
    const result = fingerprintKnowledgeDocument(workspaceRoot, parsed.values.path)
    if (parsed.values.json)
      return json({ ...jsonEnvelopeV3(), knowledge: result })
    process.stdout.write([
      `Knowledge: ${result.path}`,
      `Algorithm: ${result.algorithm}`,
      `Fingerprint: ${result.fingerprint}`,
      `Files: ${result.files.length}`,
      ...result.warnings.map((warning) => `Warning: ${warning}`),
    ].join('\n') + '\n')
    return
  }

  if (Boolean(parsed.values.path) === Boolean(parsed.values.task))
    fail('invalid_arguments', 'knowledge check requires exactly one of --path or --task.')
  if (parsed.values.path) {
    const workspaceRoot = discoverWorkspaceRoot(cwd, { forInit: true })
    const result = checkKnowledgeDocument(workspaceRoot, parsed.values.path)
    if (parsed.values.json)
      return json({ ...jsonEnvelopeV3(), knowledge: result })
    process.stdout.write(`${knowledgeCheckHuman(result)}\n`)
    return
  }

  const store = openTaskStoreV2(cwd)
  const task = readTaskV2(store, parsed.values.task!)
  const result = checkTaskKnowledgeDocuments(store.paths.workspaceRoot, task)
  if (parsed.values.json)
    return json({ ...jsonEnvelopeV3(), ...result })
  process.stdout.write([
    `Task: ${result.task_id}`,
    ...result.documents.map(knowledgeCheckHuman),
  ].join('\n') + '\n')
}
