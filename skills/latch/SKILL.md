---
name: latch
description: Use Latch only for project opt-in, existing `.latch`, known task continuation, explicit requests, or explicit project-local Record operations; never for write intent alone.
---

# Latch

Require a listed signal. Otherwise run no Latch command or init question; inspect
`.latch`, never `list`. Existing `.latch` only marks support, not task creation.
Pure Q&A creates no task. Create a task only for explicit Latch save/restore,
known continuation/closeout, multiple independent acceptance surfaces, needed
confirmation of goal, root cause, approach, product choice, public contract,
auth, persistence, schema, concurrency, irreversible side effects, wide
impact/cross-session, machine proof. Else change minimum, run narrow checks,
inspect diff; no task. Explicit no-Latch skips Latch only with no known
continuation or closeout duty.

## Select and inspect

- Here use `node dist/cli.js`: CLI `0.6.1`, envelope `3`, new-task schema 5.
  Schema 2–4 are read-only. Stop if any version is unknown.
- On cold start, compaction, or recovery, run `git status --short`, then
  `list --json --brief`. On `not_initialized`, stop; only an explicit one-off or
  no-Latch request may proceed. Do not scaffold, plan, checkpoint, or init
  without the user's choice.
- In a continuous same-thread flow, reuse task ID, `revision`, and `next_action`;
  skip startup unless compaction, revision conflict, judgment warning, or task meaning change.
- Never reread context only for `revision` or `next_action`.
- On cold routes, read status only for a known ID or returned `current_task_id`;
  otherwise no context. Read artifacts first; use 1–3 `docs/INDEX.md` documents
  only for product contracts, architecture, install, docs, or missing evidence.
- Do not read other Codex conversations or Records during startup, recovery, or
  ordinary discussion. Bound large worktree output and full diffs.

## Classify before writing

- A: unclear goal, acceptance, scope, root cause, or high-risk method stays in
  grill.
- B: fixed, low-risk scope with empty `open_questions` uses Light.
- C: plan confirmation, independent acceptance surfaces, a product choice,
  public contract, migration, authentication, destructive data handling, or
  comparable risk uses Standard and waits for explicit approval.

Mechanical lint, typecheck, build, or documentation-index gates do not alone
trigger C; gate count never selects a profile. If implementation reveals missing
information, a changed root cause, a new product choice, plan change, or scope
expansion, stop and re-run A/B/C. A stays in grill, B needs a precise delta
authorization, and C shows short decision highlights plus the task ID and waits
for reapproval. Core validates structure and revision; it does not classify.

For decided-design status sync or a `proposed` artifact, read
[task lifecycle](references/task-lifecycle.md); never bypass writer, scope,
approval, or revalidation.

## Happy path

Use this single route:

```text
list/status → checkpoint/approve → verify-all → submit/review → done
```

Slashes select profile/state. Use compact JSON (`--json --brief`), reuse every
successful `revision` and `next_action`, and never auto-retry a conflict.

- Light: author the six fields directly, then atomically create and authorize with
  `checkpoint --profile light --authorize-request`. Implement, `verify-all`,
  `submit`, and wait for review; run `done` only after explicit completion or
  archive authorization.
- Standard: complete all 12 fields, `checkpoint`, show goal, material scope, risks,
  questions, and task ID; wait. On approval run
  `approve <id> --expect-revision <rev> --reason <text>`, implement,
  `verify-all`, `submit`, and wait for review. Do not paste plan JSON by default.

The Light happy path skips the on-demand, shape-only scaffold. Its gate example
uses `name`, `command: string[]`, `kind: gate`, and `replace-with-real-command`,
so it is not authorizable. Scope binds from `plan.workspace_scope.paths`. Attach
every `knowledge_impact.updated` `artifact_refs`
entry to the task before submit. Submit enters review; never auto-complete.

## Always-on safety

- Pass `--expect-revision` to every task mutation. Missing canonical actor or
  writer mismatch is fail closed. Grok and Codex are equal hosts; never invent or
  export `LATCH_ACTOR`. Takeover changes writer only, never plan approval.
- Structured JSON accepts at most one stdin consumer and fails before mutation.
- On checkpoint `invalid_arguments` with `error.category: plan_validation`, fix
  the bounded issue paths/reasons and retry as directed by `error.retry`; do not
  parse `error.message` or load recovery. `checkpoint` is not a `next_action` command.
- `workspace_scope.paths` uses repo-relative POSIX paths: files omit `/`,
  directories end in `/`, existing directories without `/` fail, and missing
  paths remain valid. Never infer scope or authorization from prose, paths,
  titles, answers, or artifacts. Plan-delta commands remain fail closed.
- Run every named gate. Use `verify-all` for pending/stale gates and for in-scope
  corrections in `dev` or `check`; do not use review feedback there.
  Instruction-only `echo`/`printf`/`true` commands are not evidence. Named gates
  must be check-only: do not use `--fix`, `--write`, or equivalent auto-fix
  commands as gates; run those fixes in `dev`. A pass needs successful
  execution, complete evidence, an unchanged covered workspace, current proof
  generation, and no unresolved violation.
- Preserve unexpected mutations. Never reset, clean, stash, widen scope, or skip
  proof. Truncation is not failure; JSON mode keeps one document, `--verbose`
  streams details, and there is no `log_ref`.
- Schema 2–4 tasks remain historical read-only; never migrate during reads,
  startup, build, or verification. Preserve task facts, events, evidence,
  submission facts, and knowledge impact.
- `done` needs explicit completion/archive authorization and structured
  resolution of every unverified item. `abandon` needs explicit cancellation.
  Task authorization never grants Git add, commit, push, branch, checkout, reset,
  clean, or external-repository writes.

## Load recovery only when signaled

On a stable `error.code`, typed `next_action`, blocked state, or explicit reviewer
decision, read [recovery router](references/recovery.md) completely. Do not parse
English messages, try fallback commands, or pre-load every recovery branch.

Read one other reference completely only when its subject is active:

- [task lifecycle](references/task-lifecycle.md): plan, authorization, gates,
  submission, closeout.
- [session actors and handoff](references/session-actors-and-handoff.md): actor,
  writer mismatch, takeover, provenance.
- [groups](references/groups.md): exact `group_id` operations.
- [knowledge and context](references/knowledge-and-context.md): knowledge impact,
  Context packs, benchmarks.
- [schema routing](references/migration.md): writer versions and historical data.
- [records](references/records.md): explicit Record operations.
