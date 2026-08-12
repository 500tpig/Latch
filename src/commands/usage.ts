import { benchmarkUsage } from './benchmark.js'
import { contextPackUsage, contextUsage } from './context.js'
import { knowledgeUsage } from './knowledge.js'
import { recordUsage } from './record.js'

export const commandUsage: Record<string, string> = {
  init: 'Usage: latch init [--json]',
  checkpoint:
    'Usage: latch checkpoint <title> --plan-file <path|-> [--profile <light|standard>] [--authorize-request <reason> | --authorization-file <path|-> | --retrospective-file <path|->] [--source-record <id> --source-record-revision <revision>] [--artifact <kind>:<path>] [--json]\n       latch checkpoint --print-plan-template <light|standard>',
  use: 'Usage: latch use <task-id> [--json]',
  list:
    'Usage: latch list [--group <id> [--include-archive]] [--json] [--brief]',
  context: contextUsage,
  'context-pack': contextPackUsage,
  record: recordUsage,
  knowledge: knowledgeUsage,
  benchmark: benchmarkUsage,
  claim:
    'Usage: latch claim <task-id> --expect-revision <revision> [--reason <text>] [--json]',
  takeover:
    'Usage: latch takeover <task-id> --expect-revision <revision> --reason <text> [--json]',
  save:
    'Usage: latch save <task-id> --expect-revision <revision> [--plan-file <path|->] [--feedback <text>] [--decision <text>] [--artifact <kind>:<path>] [--remove-artifact <kind>:<path>] [--block-reason <text> --waiting-for <text> | --unblock] [--profile <light|standard> --profile-reason <text> [--user-requested-narrowing] | --provenance <clean|mixed> --provenance-reason <text> | --group <id> | --clear-group] [--json]',
  approve:
    'Usage: latch approve <task-id> --expect-revision <revision> (--reason <text> | --authorization-file <path|-> | --retrospective-file <path|->) [--json]\n' +
    '       latch approve <task-id> --expect-revision <revision> --feedback <text> [--authorization-file <path|->] [--json]\n' +
    '       latch approve <task-id> --expect-revision <revision> --non-implementation-feedback <text> [--json]',
  verify:
    'Usage: latch verify <task-id> --expect-revision <revision> --name <name> [--diagnostic] [-- command...] [--json]',
  'verify-all':
    'Usage: latch verify-all <task-id> --expect-revision <revision> [--json]',
  reconcile:
    'Usage: latch reconcile <task-id> --expect-revision <revision> [--json]',
  'reopen-review':
    'Usage: latch reopen-review <task-id> --expect-revision <revision> --reason <text> [--json]',
  artifact:
    'Usage: latch artifact <add|remove> <task-id> --expect-revision <revision> <kind:path>... [--json]',
  submit:
    'Usage: latch submit <task-id> --expect-revision <revision> --changes <text> [--unverified-item <summary>...] [--knowledge-impact-none <reason> | --knowledge-impact-file <path|->] [--no-verify --reason <text>] [--verbose-warnings] [--json]',
  'patch-submission-knowledge-impact':
    'Usage: latch patch-submission-knowledge-impact <task-id> --expect-revision <revision> --knowledge-impact-file <path|-> [--reason <text>] [--json]',
  'upgrade-v4':
    'Usage: latch upgrade-v4 --task <task-id> --expect-revision <revision> [--recover-writer --reason <text>] [--json]',
  'downgrade-v2':
    'Usage: latch downgrade-v2 --task <task-id> --expect-revision <revision> --confirm-data-loss [--json]',
  done:
    'Usage: latch done <task-id> --expect-revision <revision> [--closeout-file <path|->] [--json]',
  abandon:
    'Usage: latch abandon <task-id> --expect-revision <revision> --reason <text> [--json]',
}

const topLevelCommands = [
  'init',
  'checkpoint',
  'use',
  'list',
  'context',
  'context-pack',
  'record',
  'knowledge',
  'benchmark',
  'takeover',
  'save',
  'approve',
  'verify',
  'verify-all',
  'reconcile',
  'reopen-review',
  'artifact',
  'submit',
  'patch-submission-knowledge-impact',
  'done',
  'abandon',
] as const

function topLevelCommandUsage(command: string) {
  return commandUsage[command]
    .split('\n')
    .map((line) =>
      `  ${line
        .replace(/^Usage: latch /, '')
        .replace(/^\s*latch /, '')}`,
    )
    .join('\n')
}

export const usage = `Usage: latch <command> [options]
       latch --version [--json]

Commands:
${topLevelCommands
  .map((command) => topLevelCommandUsage(command))
  .join('\n')}`

export const actorRequiredCommands = new Set([
  'checkpoint',
  'use',
  'claim',
  'takeover',
  'save',
  'approve',
  'verify',
  'verify-all',
  'reconcile',
  'reopen-review',
  'artifact',
  'submit',
  'patch-submission-knowledge-impact',
  'upgrade-v4',
  'downgrade-v2',
  'done',
  'abandon',
])
