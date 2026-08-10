export type LatchDomainErrorCode =
  | 'phase_mismatch'
  | 'proof_stale'
  | 'workspace_violation'

export class LatchDomainError extends Error {
  constructor(
    readonly code: LatchDomainErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'LatchDomainError'
  }
}
