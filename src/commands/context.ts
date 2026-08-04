import {
  commonOptions,
  fail,
  json,
  parseCommand,
  readInputFile,
  validateBrief,
} from '../cli-support.js'
import { isWritableActor } from '../core/actor.js'
import {
  buildContextPack,
  loadContextPackSections,
  parseContextPackRequest,
  type ContextPackSectionInput,
} from '../core/context-pack.js'
import { discoverWorkspaceRoot } from '../core/paths.js'
import {
  contextHumanV2,
  contextJsonV2,
  type ContextHistoryView,
} from '../core/task-view.js'
import {
  currentTaskIdV2,
  openTaskStoreV2,
  readContextTaskV2,
  readOpenContextTaskV2,
} from '../core/task-store.js'

export const contextUsage =
  'Usage: latch context [task-id] [--json] [--brief | --status | --since-revision <revision>] [--history <timeline|events|both>]'
export const contextPackUsage =
  'Usage: latch context pack --input-file <path> [--json]'

function nonNegativeInteger(raw: string | undefined, name: string) {
  if (raw === undefined || !/^\d+$/.test(raw))
    fail('invalid_arguments', `${name} must be a non-negative integer.`)
  return Number(raw)
}

function contextHistoryView(raw: string | undefined): ContextHistoryView | undefined {
  if (raw === undefined) return undefined
  if (raw !== 'timeline' && raw !== 'events' && raw !== 'both')
    fail('invalid_arguments', '--history must be timeline, events, or both.')
  return raw
}

function targetTask(cwd: string, actor: string, id: string | undefined) {
  const store = openTaskStoreV2(cwd)
  const taskId = id ?? currentTaskIdV2(store, actor)
  if (!taskId) fail('task_not_found', 'No current Latch v2 task.')
  return { store, context: readContextTaskV2(store, taskId) }
}

export function runContext(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    brief: { type: 'boolean' },
    status: { type: 'boolean' },
    'since-revision': { type: 'string' },
    history: { type: 'string' },
  })
  if (parsed.values.help) return process.stdout.write(`${contextUsage}\n`)
  if (parsed.positionals.length > 1)
    fail('invalid_arguments', contextUsage)
  validateBrief(parsed.values.json, parsed.values.brief)
  if (
    (parsed.values.status ||
      parsed.values['since-revision'] !== undefined ||
      parsed.values.history !== undefined) &&
    !parsed.values.json
  )
    fail('invalid_arguments', '--status, --since-revision, and --history require --json.')
  const history = contextHistoryView(parsed.values.history)
  if (parsed.values.status && history !== undefined)
    fail('invalid_arguments', '--history cannot be combined with --status.')
  const selectedViews = [
    Boolean(parsed.values.brief),
    Boolean(parsed.values.status),
    parsed.values['since-revision'] !== undefined,
  ].filter(Boolean).length
  if (selectedViews > 1)
    fail(
      'invalid_arguments',
      '--brief, --status, and --since-revision are mutually exclusive.',
    )
  if (!parsed.positionals[0] && !isWritableActor(actor))
    fail(
      'actor_required',
      'Actor required for context without task id.\n' +
        'Pass an explicit task id or set a session actor.',
    )
  const { store, context } = targetTask(cwd, actor, parsed.positionals[0])
  const task = context.task
  const sinceRevision =
    parsed.values['since-revision'] !== undefined
      ? nonNegativeInteger(parsed.values['since-revision'], '--since-revision')
      : undefined
  if (sinceRevision !== undefined && sinceRevision > task.revision)
    fail(
      'invalid_arguments',
      `--since-revision cannot exceed current task revision ${task.revision}.`,
    )
  if (parsed.values.json)
    return json(contextJsonV2(store, context, actor, {
      brief: Boolean(parsed.values.brief),
      status: Boolean(parsed.values.status),
      sinceRevision,
      history,
    }))
  process.stdout.write(`${contextHumanV2(store, context, actor)}\n`)
}

export function runContextPack(args: string[], cwd: string, actor: string) {
  const parsed = parseCommand(args, {
    ...commonOptions(),
    'input-file': { type: 'string' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${contextPackUsage}\n`)
  if (parsed.positionals.length > 0)
    fail('invalid_arguments', contextPackUsage)
  const request = parseContextPackRequest(
    readInputFile<unknown>(cwd, parsed.values['input-file'], '--input-file'),
  )

  let workspaceRoot: string
  let effectiveRequest = request
  const automaticSections: ContextPackSectionInput[] = []
  if (request.task_id) {
    const store = openTaskStoreV2(cwd)
    const contextTask = readOpenContextTaskV2(store, request.task_id)
    const task = contextTask.task
    const context = contextJsonV2(store, contextTask, actor, true)
    workspaceRoot = store.paths.workspaceRoot
    effectiveRequest = {
      ...request,
      task_id: task.id,
      ...(request.orientation
        ? { orientation: { ...request.orientation, task_id: task.id } }
        : {}),
    }
    automaticSections.push({
      kind: 'task',
      content: JSON.stringify(context.task, null, 2),
    })
    if ('group' in context)
      automaticSections.push({
        kind: 'sibling',
        content: JSON.stringify(context.group, null, 2),
      })
  } else {
    workspaceRoot = discoverWorkspaceRoot(cwd, { forInit: true })
  }

  const requestedSections = loadContextPackSections(workspaceRoot, effectiveRequest)
  const result = buildContextPack(effectiveRequest, [
    ...automaticSections,
    ...requestedSections,
  ])
  process.stdout.write(result.serialized)
}
