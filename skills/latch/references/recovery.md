# Recovery router

Read this reference only after a stable `error.code`, typed `next_action`, blocked
state, workspace/proof mismatch, plan gap, or explicit reviewer decision points to
recovery. Resolve conditions in this order: read-only or writer state → blocked →
proof/workspace → plan → current phase. Do not announce a lower-priority mutation
before the higher-priority condition is resolved.

## Writer and blocked state

- `writer_mismatch`: remain read-only and request explicit takeover authorization
  for the named task and revision. After authorization, run `takeover`, then derive
  the next action from its returned state. Takeover never approves a plan. Read
  [session actors and handoff](session-actors-and-handoff.md) before acting.
- `blocked`: wait for the recorded `waiting_for` condition. When evidence shows it
  is satisfied, use the current revision with `save --unblock`; do not clear a
  block by assumption.
- `historical_read_only`, `archived_read_only`, `caller_read_only`, or an unknown
  state: stop. Do not claim, migrate, spoof an actor, or try another writer route.

## Proof and workspace

- `proof_stale` in review: the current writer runs `reopen-review`, then
  `verify-all`, then creates a new `submit`. Do not model stale proof as reviewer
  feedback or reuse the old submission.
- `workspace_violation`: if an unintended change has already been precisely
  restored, run `reconcile` without selectors. If the change should enter scope,
  first obtain explicit plan-delta approval and use `append-scope`. If neither is
  established, stop; never reset, clean, stash, roll back, ignore the violation,
  or widen scope automatically.
- In `dev` or `check`, correct an in-scope implementation issue and run
  `verify-all`. Do not use `approve --feedback`. Both `verify-all` and `reconcile`
  advance proof generation.

## Plan changes

- Open questions require a user-input boundary. Pass complete, ordered answers to
  `resolve-open-questions`; answers alone do not approve implementation.
- A scope-only addition uses `append-scope`; a change to one existing gate argv
  uses `update-verification-command`; any other material goal, acceptance,
  contract, user-flow, or boundary change uses `save --plan-file`.
- Every material plan change returns to `plan`, invalidates prior authorization
  and proof, and requires a new explicit approval. Do not use a generic delta or
  infer approval from clarification.

## Review feedback and closeout

- In review with current proof, executable implementation correction uses
  `approve --feedback`; a non-implementation explanation uses
  `approve --non-implementation-feedback`. If classification is uncertain, treat
  it as implementation correction.
- Use `artifact add|remove` only for artifact-only repair. Use
  `submit --verbose-warnings` only when the full untracked warning list is needed.
- Before closeout, read [task lifecycle](task-lifecycle.md) completely. Archive
  intent alone is not risk acceptance. Do not run `done` or create follow-up work
  without the required explicit decision.

`phase_mismatch` means the selected primitive is illegal for the current phase:
read bounded status and choose the legal action. `command_failed` is unclassified:
stop automatic routing and perform bounded diagnostics instead of parsing its
English message or trying commands in sequence.
