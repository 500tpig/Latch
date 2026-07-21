export function injectHostActor(environment = process.env) {
  if (Object.hasOwn(environment, 'LATCH_ACTOR')) return
  const threadId = environment.CODEX_THREAD_ID
  if (threadId?.trim()) environment.LATCH_ACTOR = `codex:session:${threadId}`
}
