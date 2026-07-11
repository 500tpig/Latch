export function actorId() {
  if (process.env.LATCH_ACTOR) return process.env.LATCH_ACTOR
  if (process.env.CODEX_THREAD_ID)
    return `codex:default:${process.env.CODEX_THREAD_ID}`
  if (Object.keys(process.env).some((key) => key.startsWith('CLAUDE_CODE_')))
    return 'claude:default'
  if (Object.keys(process.env).some((key) => key.startsWith('OPENCODE_')))
    return 'opencode:default'
  return 'unknown:default'
}
