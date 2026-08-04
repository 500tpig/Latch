import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  CliV2Error,
  commonOptions,
  fail,
  json,
  parseCommand,
  positiveInteger,
  printWarnings,
} from '../cli-support.js'
import {
  archiveProjectRecordV1,
  createProjectRecordV1,
  deleteProjectRecordV1,
  editProjectRecordV1,
  listProjectRecordsV1,
  openRecordStoreV1,
  RECORD_STORE_SCHEMA_VERSION,
  restoreProjectRecordV1,
  showProjectRecordV1,
  type ProjectRecordEntryV1,
  type ProjectRecordWithBodyV1,
} from '../core/record-store.js'
import { jsonEnvelopeV2 } from '../core/task-view.js'

export const recordUsage =
  'Usage: latch record create --title <title> (--body <text> | --body-file <path>) [--tag <tag>...] [--task <id>...] [--group <id>...] [--json]\n       latch record list [--status <active|archived|all>] [--query <text>] [--tag <tag>...] [--task <id>] [--group <id>] [--limit <1..5>] [--json]\n       latch record show <record-id> [--json]\n       latch record edit <record-id> --expect-revision <revision> [--title <title>] [--body <text> | --body-file <path>] [--tag <tag>... | --clear-tags] [--task <id>... | --clear-tasks] [--group <id>... | --clear-groups] [--json]\n       latch record archive <record-id> --expect-revision <revision> [--json]\n       latch record restore <record-id> --expect-revision <revision> [--json]\n       latch record delete <record-id> --expect-revision <revision> --confirm-delete [--confirm-linked] [--json]'

export function recordJsonEnvelope() {
  return {
    ...jsonEnvelopeV2(),
    record_store_schema_version: RECORD_STORE_SCHEMA_VERSION,
  }
}

function recordMutationView(record: ProjectRecordEntryV1) {
  return {
    id: record.id,
    revision: record.revision,
    title: record.title,
    tags: record.tags,
    status: record.status,
    relations: record.relations,
    updated_at: record.updated_at,
  }
}

function recordBodyPreview(body: string) {
  const normalized = body.replace(/\s+/g, ' ').trim()
  return [...normalized].slice(0, 240).join('')
}

function readRecordBodyInput(
  cwd: string,
  workspaceRoot: string,
  body: string | undefined,
  bodyFile: string | undefined,
  required: boolean,
) {
  if (body !== undefined && bodyFile !== undefined)
    fail('invalid_arguments', '--body and --body-file cannot be combined.')
  if (body === undefined && bodyFile === undefined) {
    if (required)
      fail('invalid_arguments', 'Exactly one of --body or --body-file is required.')
    return undefined
  }
  if (body !== undefined) return body
  const inputPath = resolve(cwd, bodyFile!)
  const relativePath = relative(workspaceRoot, inputPath)
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  )
    fail('invalid_arguments', '--body-file must be inside the current project.')
  let canonicalPath: string
  try {
    const stat = lstatSync(inputPath)
    if (stat.isSymbolicLink() || !stat.isFile())
      fail('invalid_arguments', '--body-file must be a regular non-symlink file.')
    canonicalPath = realpathSync.native(inputPath)
  } catch (error) {
    if (error instanceof CliV2Error) throw error
    const message = error instanceof Error ? error.message : String(error)
    fail('invalid_arguments', `Cannot read --body-file: ${message}`)
  }
  const canonicalRelative = relative(workspaceRoot, canonicalPath)
  if (
    canonicalRelative === '..' ||
    canonicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(canonicalRelative)
  )
    fail('invalid_arguments', '--body-file resolves outside the current project.')
  return readFileSync(canonicalPath, 'utf8')
}

function printRecordMutation(result: ProjectRecordWithBodyV1) {
  process.stdout.write([
    `Record: ${result.record.id}`,
    `Revision: ${result.record.revision}`,
    `Title: ${result.record.title}`,
    `Content: ${recordBodyPreview(result.body)}`,
  ].join('\n') + '\n')
}

export function runRecord(args: string[], cwd: string) {
  const action = args[0]
  if (!action || action === '--help' || action === '-h')
    return process.stdout.write(`${recordUsage}\n`)
  if (
    action !== 'create' &&
    action !== 'list' &&
    action !== 'show' &&
    action !== 'edit' &&
    action !== 'archive' &&
    action !== 'restore' &&
    action !== 'delete'
  )
    fail('invalid_arguments', `Unknown record command: ${action}\n${recordUsage}`)
  if (args[1] === '--help' || args[1] === '-h')
    return process.stdout.write(`${recordUsage}\n`)

  const store = openRecordStoreV1(cwd)
  if (action === 'create') {
    const parsed = parseCommand(args.slice(1), {
      ...commonOptions(),
      title: { type: 'string' },
      body: { type: 'string' },
      'body-file': { type: 'string' },
      tag: { type: 'string', multiple: true },
      task: { type: 'string', multiple: true },
      group: { type: 'string', multiple: true },
    })
    if (parsed.values.help)
      return process.stdout.write(`${recordUsage}\n`)
    if (parsed.positionals.length > 0 || !parsed.values.title)
      fail('invalid_arguments', recordUsage)
    const body = readRecordBodyInput(
      cwd,
      store.taskStore.paths.workspaceRoot,
      parsed.values.body,
      parsed.values['body-file'],
      true,
    )!
    const result = createProjectRecordV1(store, {
      title: parsed.values.title,
      body,
      tags: parsed.values.tag,
      taskIds: parsed.values.task,
      groupIds: parsed.values.group,
    })
    if (parsed.values.json)
      return json({
        ...recordJsonEnvelope(),
        record: recordMutationView(result.value.record),
        body_preview: recordBodyPreview(result.value.body),
        warnings: result.warnings,
      })
    printRecordMutation(result.value)
    printWarnings(result.warnings)
    return
  }

  if (action === 'list') {
    const parsed = parseCommand(args.slice(1), {
      ...commonOptions(),
      status: { type: 'string' },
      query: { type: 'string' },
      tag: { type: 'string', multiple: true },
      task: { type: 'string' },
      group: { type: 'string' },
      limit: { type: 'string' },
    })
    if (parsed.values.help)
      return process.stdout.write(`${recordUsage}\n`)
    if (parsed.positionals.length > 0)
      fail('invalid_arguments', recordUsage)
    if (
      parsed.values.status !== undefined &&
      parsed.values.status !== 'active' &&
      parsed.values.status !== 'archived' &&
      parsed.values.status !== 'all'
    )
      fail('invalid_arguments', '--status must be active, archived, or all.')
    const records = listProjectRecordsV1(store, {
      status: parsed.values.status,
      query: parsed.values.query,
      tags: parsed.values.tag,
      taskId: parsed.values.task,
      groupId: parsed.values.group,
      limit: parsed.values.limit
        ? positiveInteger(parsed.values.limit, '--limit')
        : undefined,
    })
    if (parsed.values.json)
      return json({ ...recordJsonEnvelope(), records })
    if (records.length === 0) {
      process.stdout.write('No Records.\n')
      return
    }
    process.stdout.write(
      `${records.map((record) =>
        `${record.id} [${record.status}] ${record.title}${record.tags.length ? ` #${record.tags.join(' #')}` : ''}`,
      ).join('\n')}\n`,
    )
    return
  }

  if (action === 'show') {
    const parsed = parseCommand(args.slice(1), commonOptions())
    if (parsed.values.help)
      return process.stdout.write(`${recordUsage}\n`)
    if (parsed.positionals.length !== 1)
      fail('invalid_arguments', recordUsage)
    const result = showProjectRecordV1(store, parsed.positionals[0])
    if (parsed.values.json)
      return json({ ...recordJsonEnvelope(), ...result })
    process.stdout.write([
      `Record: ${result.record.id}`,
      `Revision: ${result.record.revision}`,
      `Title: ${result.record.title}`,
      `Status: ${result.record.status}`,
      `Tags: ${result.record.tags.join(', ') || '-'}`,
      '',
      result.body,
    ].join('\n') + (result.body.endsWith('\n') ? '' : '\n'))
    return
  }

  if (action === 'edit') {
    const parsed = parseCommand(args.slice(1), {
      ...commonOptions(),
      'expect-revision': { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
      'body-file': { type: 'string' },
      tag: { type: 'string', multiple: true },
      task: { type: 'string', multiple: true },
      group: { type: 'string', multiple: true },
      'clear-tags': { type: 'boolean' },
      'clear-tasks': { type: 'boolean' },
      'clear-groups': { type: 'boolean' },
    })
    if (parsed.values.help)
      return process.stdout.write(`${recordUsage}\n`)
    if (parsed.positionals.length !== 1)
      fail('invalid_arguments', recordUsage)
    if (parsed.values['clear-tags'] && parsed.values.tag)
      fail('invalid_arguments', '--tag and --clear-tags cannot be combined.')
    if (parsed.values['clear-tasks'] && parsed.values.task)
      fail('invalid_arguments', '--task and --clear-tasks cannot be combined.')
    if (parsed.values['clear-groups'] && parsed.values.group)
      fail('invalid_arguments', '--group and --clear-groups cannot be combined.')
    const body = readRecordBodyInput(
      cwd,
      store.taskStore.paths.workspaceRoot,
      parsed.values.body,
      parsed.values['body-file'],
      false,
    )
    const result = editProjectRecordV1(store, parsed.positionals[0], {
      expectRevision: positiveInteger(
        parsed.values['expect-revision'],
        '--expect-revision',
      ),
      title: parsed.values.title,
      body,
      tags: parsed.values['clear-tags'] ? [] : parsed.values.tag,
      taskIds: parsed.values['clear-tasks'] ? [] : parsed.values.task,
      groupIds: parsed.values['clear-groups'] ? [] : parsed.values.group,
    })
    if (parsed.values.json)
      return json({
        ...recordJsonEnvelope(),
        record: recordMutationView(result.value.record),
        body_preview: recordBodyPreview(result.value.body),
        warnings: result.warnings,
      })
    printRecordMutation(result.value)
    printWarnings(result.warnings)
    return
  }

  const parsed = parseCommand(args.slice(1), {
    ...commonOptions(),
    'expect-revision': { type: 'string' },
    'confirm-delete': { type: 'boolean' },
    'confirm-linked': { type: 'boolean' },
  })
  if (parsed.values.help)
    return process.stdout.write(`${recordUsage}\n`)
  if (parsed.positionals.length !== 1)
    fail('invalid_arguments', recordUsage)
  const id = parsed.positionals[0]
  const expectRevision = positiveInteger(
    parsed.values['expect-revision'],
    '--expect-revision',
  )
  if (action === 'delete') {
    if (!parsed.values['confirm-delete'])
      fail(
        'confirmation_required',
        'Record delete requires --confirm-delete and an exact Record ID.',
      )
    const result = deleteProjectRecordV1(
      store,
      id,
      expectRevision,
      Boolean(parsed.values['confirm-linked']),
    )
    if (parsed.values.json)
      return json({
        ...recordJsonEnvelope(),
        record_id: result.value.id,
        previous_revision: result.value.previous_revision,
        deleted: true,
        warnings: result.warnings,
      })
    process.stdout.write(`Deleted Record ${result.value.id} permanently.\n`)
    printWarnings(result.warnings)
    return
  }
  if (parsed.values['confirm-delete'] || parsed.values['confirm-linked'])
    fail(
      'invalid_arguments',
      '--confirm-delete and --confirm-linked are only valid for record delete.',
    )
  const result = action === 'archive'
    ? archiveProjectRecordV1(store, id, expectRevision)
    : restoreProjectRecordV1(store, id, expectRevision)
  if (parsed.values.json)
    return json({
      ...recordJsonEnvelope(),
      record: recordMutationView(result.value),
      warnings: result.warnings,
    })
  process.stdout.write(
    `${action === 'archive' ? 'Archived' : 'Restored'} Record ${result.value.id} at revision ${result.value.revision}.\n`,
  )
}
