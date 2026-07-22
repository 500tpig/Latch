# Session actors and handoff

Read this reference for actor adapters, writer mismatch, takeover, forks or new conversations, handoff prompts, and provenance changes.

## Session actor adapter

- Core accepts only a canonical `LATCH_ACTOR`; do not add vendor-specific environment detection to Core.
- Inject `<tool>:session:<opaque-id>` only in a host adapter after obtaining a stable, session-unique ID from the host runtime or protocol.
- Do not tell a user to guess or export `LATCH_ACTOR`, and do not derive it from `default`, a random UUID, PID, machine name, working directory, or user input.
- Without an adapter-provided canonical actor, remain read-only and use only `latch list` or `latch context <task-id>`.
- Preserve the distributed Codex compatibility path: when `LATCH_ACTOR` is absent and Codex supplies stable `CODEX_THREAD_ID`, inject `codex:session:<thread-id>` before Core reads the actor; keep an explicit empty `LATCH_ACTOR` fail closed.

## Cross-session handoff

Treat a move to a new conversation, a fork, a full-context handoff, or a conversation nearing its limit as a cross-session handoff. Treat a fork and a new conversation as new session actors even when they share a workspace.

Before generating a handoff prompt, read the named task context and `git status --short`. Include this complete template:

```text
Continue Latch task <task-id>.
Current phase/revision: <phase> / <revision>.
Current primary_writer: <old-writer>.
Unfinished work: <remaining approved-plan items and pending gates>.
Worktree status: <git status --short summary and shared-worktree warning, if any>.

The old session must stop writing this task. I explicitly authorize the new session to take over this task with `latch takeover <task-id> --expect-revision <revision> --reason <reason> --json`.
<Include this sentence only when true: I also explicitly approve the current plan revision <plan-revision>.>
```

- Do not run takeover from handoff intent alone; require explicit user authorization for the named task and expected revision.
- Treat takeover as ownership transfer, not implementation approval. When one user message explicitly authorizes both takeover and the current plan, run takeover first and use its returned JSON `revision` for `approve`; otherwise preserve the phase and wait for separate approval.
- Require the old session to stop task writes. Latch cannot prevent it from changing a shared Git worktree, so report the shared-worktree risk.
- Keep a normal sequential handoff `provenance: clean`; use `mixed` only after the user explicitly accepts overlapping parallel work.

## Provenance

- Treat missing task provenance as `clean`; write new schema 3 tasks with `provenance: clean`.
- Set provenance to `mixed` only after explicit user acceptance of overlapping parallel work, using standalone `latch save <task-id> --expect-revision <n> --provenance mixed --provenance-reason <text> --json`.
- Reset provenance to `clean` only after explicit user confirmation that isolation is restored, using the same standalone mutation with `--provenance clean` and a reason.
- Never reset provenance through phase changes, submit, done, or takeover.
- Keep provenance as a task-root current fact shown by list/context and copied by archive; do not add another authoritative value to submission or closure.
