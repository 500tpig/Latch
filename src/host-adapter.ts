import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export type HostAdapterHooks = {
  /** Override Grok active-session resolution (tests). */
  resolveGrokSessionId?: () => string | undefined
  /** Override parent-pid lookup (tests). */
  readParentPid?: (pid: number) => number | undefined
  /** Override active_sessions.json path (tests). */
  grokActiveSessionsPath?: string
}

type GrokActiveSession = {
  session_id?: unknown
  pid?: unknown
}

function isUsableOpaqueId(value: string | undefined): value is string {
  return Boolean(value && value.trim() && value.trim().toLowerCase() !== 'default')
}

function readParentPidViaPs(pid: number): number | undefined {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'ppid='], {
    encoding: 'utf8',
  })
  if (result.status !== 0) return undefined
  const text = result.stdout?.trim()
  if (!text) return undefined
  const ppid = Number.parseInt(text, 10)
  return Number.isFinite(ppid) && ppid > 0 ? ppid : undefined
}

function parentPidChain(
  startPid: number,
  readParentPid: (pid: number) => number | undefined,
  limit = 16,
): number[] {
  const chain: number[] = []
  let pid = startPid
  for (let i = 0; i < limit; i += 1) {
    if (!Number.isFinite(pid) || pid <= 1) break
    if (chain.includes(pid)) break
    chain.push(pid)
    const parent = readParentPid(pid)
    if (parent === undefined || parent === pid) break
    pid = parent
  }
  return chain
}

function defaultGrokActiveSessionsPath(environment: NodeJS.ProcessEnv): string {
  const home = environment.GROK_HOME?.trim() || join(homedir(), '.grok')
  return join(home, 'active_sessions.json')
}

function readGrokActiveSessions(path: string): GrokActiveSession[] {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as GrokActiveSession[]) : []
  } catch {
    return []
  }
}

/**
 * Resolve a stable Grok session id from host registry + ancestor pids.
 * Fail closed when zero or multiple distinct session ids match.
 */
export function resolveGrokSessionFromActiveSessions(
  environment: NodeJS.ProcessEnv = process.env,
  hooks: HostAdapterHooks = {},
  startPid: number = process.ppid,
): string | undefined {
  const path =
    hooks.grokActiveSessionsPath ?? defaultGrokActiveSessionsPath(environment)
  const sessions = readGrokActiveSessions(path)
  if (sessions.length === 0) return undefined

  const readParentPid = hooks.readParentPid ?? readParentPidViaPs
  const chain = new Set(parentPidChain(startPid, readParentPid))
  if (chain.size === 0) return undefined

  const matched = new Set<string>()
  for (const session of sessions) {
    const sessionId =
      typeof session.session_id === 'string' ? session.session_id.trim() : ''
    const pid =
      typeof session.pid === 'number'
        ? session.pid
        : typeof session.pid === 'string'
          ? Number.parseInt(session.pid, 10)
          : Number.NaN
    if (!isUsableOpaqueId(sessionId) || !Number.isFinite(pid)) continue
    if (chain.has(pid)) matched.add(sessionId)
  }

  if (matched.size !== 1) return undefined
  return [...matched][0]
}

/**
 * Inject canonical LATCH_ACTOR from host-provided stable session ids.
 * Core still only consumes LATCH_ACTOR; this stays outside Core vendor detection.
 *
 * Priority:
 * 1. LATCH_ACTOR already declared (including explicit empty) — never override
 * 2. CODEX_THREAD_ID → codex:session:<id>
 * 3. GROK_SESSION_ID → grok:session:<id>
 * 4. GROK_AGENT set + unique active_sessions/pid match → grok:session:<id>
 * 5. otherwise leave unset (unknown:default / read-only)
 */
export function injectHostActor(
  environment: NodeJS.ProcessEnv = process.env,
  hooks: HostAdapterHooks = {},
): void {
  if (Object.hasOwn(environment, 'LATCH_ACTOR')) return

  const codexThread = environment.CODEX_THREAD_ID?.trim()
  if (isUsableOpaqueId(codexThread)) {
    environment.LATCH_ACTOR = `codex:session:${codexThread}`
    return
  }

  const grokSession = environment.GROK_SESSION_ID?.trim()
  if (isUsableOpaqueId(grokSession)) {
    environment.LATCH_ACTOR = `grok:session:${grokSession}`
    return
  }

  if (!environment.GROK_AGENT?.trim()) return

  const resolved = Object.hasOwn(hooks, 'resolveGrokSessionId')
    ? hooks.resolveGrokSessionId?.()
    : resolveGrokSessionFromActiveSessions(environment, hooks)
  if (isUsableOpaqueId(resolved)) {
    environment.LATCH_ACTOR = `grok:session:${resolved}`
  }
}
