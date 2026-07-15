export function actorId() {
  if (Object.hasOwn(process.env, 'LATCH_ACTOR'))
    return process.env.LATCH_ACTOR ?? ''
  if (process.env.CODEX_THREAD_ID)
    return `codex:session:${process.env.CODEX_THREAD_ID}`
  if (Object.keys(process.env).some((key) => key.startsWith('CLAUDE_CODE_')))
    return 'claude:default'
  if (Object.keys(process.env).some((key) => key.startsWith('OPENCODE_')))
    return 'opencode:default'
  return 'unknown:default'
}

export function isWritableActor(actor: string): boolean {
  const match = /^([^:\s]+):session:([^\s]+)$/.exec(actor)
  return Boolean(match && match[2].toLowerCase() !== 'default')
}

export function assertWritableActor(actor: string): void {
  if (isWritableActor(actor)) return
  throw new Error(
    `Actor not writable: ${actor || '(empty)'}.\n` +
      'Set LATCH_ACTOR=<tool>:session:<opaque-id> and retry.',
  )
}
