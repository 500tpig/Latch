#!/usr/bin/env node
import { CliV2Error, fail } from './cli-support.js'
import { runAppendScope } from './commands/append-scope.js'
import { runBenchmark } from './commands/benchmark.js'
import { runUpdateVerificationCommand } from './commands/update-verification-command.js'
import { runContext, runContextPack } from './commands/context.js'
import { runKnowledge } from './commands/knowledge.js'
import { runRecord, recordJsonEnvelope } from './commands/record.js'
import { runReconcile } from './commands/reconcile.js'
import {
  runApprove,
  runReopenReview,
  runVerify,
  runVerifyAll,
} from './commands/review.js'
import {
  runAbandon,
  runDone,
  runPatchSubmissionKnowledgeImpact,
  runSubmit,
} from './commands/submission.js'
import {
  runArtifact,
  runClaim,
  runSave,
  runTakeover,
} from './commands/task-mutation.js'
import { runDowngradeV2, runUpgradeV4 } from './commands/migration.js'
import { actorRequiredCommands, usage } from './commands/usage.js'
import { runVersion } from './commands/version.js'
import {
  runCheckpoint,
  runInit,
  runList,
  runUse,
} from './commands/workspace.js'
import { actorId, assertWritableActor } from './core/actor.js'
import { LatchDomainError } from './core/errors.js'
import { NotInitializedError } from './core/paths.js'
import { jsonEnvelopeV2 } from './core/task-view.js'
import { DowngradeTaskV2Error } from './core/task-store.js'
import { injectHostActor } from './host-adapter.js'

/** CLI options only; tokens after `--` belong to command argv and must not
 *  change top-level Latch flag handling or error output mode. */
function cliOptionArgv(argv: string[]) {
  const separator = argv.indexOf('--')
  return separator === -1 ? argv : argv.slice(0, separator)
}

async function run(argv: string[], cwd: string) {
  const optionArgv = cliOptionArgv(argv)
  // Detect --version only before `--`, but validate the full argv so trailing
  // tokens after `--` still fail closed under the version contract.
  if (optionArgv.includes('--version')) return runVersion(argv)
  const command = argv[0]
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${usage}\n`)
    return
  }
  const args = argv.slice(1)
  const optionArgs = cliOptionArgv(args)
  injectHostActor()
  const actor = actorId()
  const printsCheckpointTemplate =
    command === 'checkpoint' &&
    optionArgs.some(
      (arg) =>
        arg === '--print-plan-template' ||
        arg.startsWith('--print-plan-template='),
    )
  if (
    actorRequiredCommands.has(command) &&
    !optionArgs.includes('--help') &&
    !optionArgs.includes('-h') &&
    !printsCheckpointTemplate
  )
    assertWritableActor(actor)
  switch (command) {
    case 'init':
      return runInit(args, cwd)
    case 'checkpoint':
      return runCheckpoint(args, cwd, actor)
    case 'use':
      return runUse(args, cwd, actor)
    case 'list':
      return runList(args, cwd, actor)
    case 'context':
      if (args[0] === 'pack') return runContextPack(args.slice(1), cwd, actor)
      return runContext(args, cwd, actor)
    case 'record':
      return runRecord(args, cwd)
    case 'knowledge':
      return runKnowledge(args, cwd)
    case 'benchmark':
      return runBenchmark(args, cwd)
    case 'claim':
      return runClaim(args, cwd, actor)
    case 'takeover':
      return runTakeover(args, cwd, actor)
    case 'save':
      return runSave(args, cwd, actor)
    case 'append-scope':
      return runAppendScope(args, cwd, actor)
    case 'update-verification-command':
      return runUpdateVerificationCommand(args, cwd, actor)
    case 'approve':
      return runApprove(args, cwd, actor)
    case 'verify':
      return runVerify(args, cwd, actor)
    case 'verify-all':
      return runVerifyAll(args, cwd, actor)
    case 'reconcile':
      return runReconcile(args, cwd, actor)
    case 'reopen-review':
      return runReopenReview(args, cwd, actor)
    case 'artifact':
      return runArtifact(args, cwd, actor)
    case 'submit':
      return runSubmit(args, cwd, actor)
    case 'patch-submission-knowledge-impact':
      return runPatchSubmissionKnowledgeImpact(args, cwd, actor)
    case 'upgrade-v4':
      return runUpgradeV4(args, cwd, actor)
    case 'downgrade-v2':
      return runDowngradeV2(args, cwd, actor)
    case 'done':
      return runDone(args, cwd, actor)
    case 'abandon':
      return runAbandon(args, cwd, actor)
    default:
      fail('unknown_command', `Unknown command: ${command}\n${usage}`)
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const optionArgv = cliOptionArgv(argv)
  try {
    await run(argv, process.cwd())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code =
      error instanceof CliV2Error ||
      error instanceof LatchDomainError ||
      error instanceof NotInitializedError
        ? error.code
        : 'command_failed'
    if (optionArgv.includes('--json'))
      process.stderr.write(
        `${JSON.stringify({
          ...(optionArgv.includes('--version') || argv[0] !== 'record'
            ? jsonEnvelopeV2()
            : recordJsonEnvelope()),
          ...(error instanceof DowngradeTaskV2Error
            ? {
                backup_path: error.backupPath,
                warnings: error.warnings,
              }
            : {}),
          error: { code, message },
        }, null, 2)}\n`,
      )
    else process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}

void main()
