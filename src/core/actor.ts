export function actorId() {
  return process.env.LATCH_ACTOR ?? 'unknown:default'
}

export function isWritableActor(actor: string): boolean {
  const match = /^([^:\s]+):session:([^\s]+)$/.exec(actor)
  return Boolean(match && match[2].toLowerCase() !== 'default')
}

export function assertWritableActor(actor: string): void {
  if (isWritableActor(actor)) return
  throw new Error(
    `Actor not writable: ${actor || '(empty)'}.\n` +
      'The host adapter must provide LATCH_ACTOR=<tool>:session:<opaque-id>.',
  )
}
