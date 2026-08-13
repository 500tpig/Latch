---
name: latch
description: Track Latch tasks for repository writes and behavior changes, and handle explicit project-local Record save, recall, and conversion requests.
---

# Latch

Use for repo writes or behavior changes. Pure Q&A, read-only, no-write, and explicit
no-Latch do not create tasks.

## Select the task runner first

- Runner: CLI `0.5.0`; use `node dist/cli.js` here and verified `latch@0.5.0` in adopters.
- New tasks: schema 5, minimum writer `0.5.0`.
- Read `task_schema_version` before mutation. Schema 2–4 tasks are read-only; never
  claim, upgrade, downgrade, take over, or mutate them.
- Stop when the task schema or runner cannot be determined.

## Start with bounded state

1. Run `git status --short`, then use the current runner for `list --json --brief`. On
   `not_initialized`: stop; no template/plan/`checkpoint`/`init`. Explicit
   one-off/no-Latch proceeds; else report/await init choice.
2. task ID/`current_task_id`: run
   the current runner for `context <task-id> --json --status`. If neither exists,
   do not call context.
3. Read artifacts first; use 1–3 `docs/INDEX.md` docs only when
   task affects product contracts, architecture/install/docs, or evidence is insufficient.

Above 50 worktree entries, report totals, status counts, and at most eight paths
unless the full list is requested. Avoid a full `git diff` unless review or exact
patch evidence requires it; never join high-output commands with `;`.

Do not read other Codex conversations for routine recovery. Do not read or write
Records during startup, task recovery, or ordinary discussion without explicit
Record intent.

## Classify before writing

- A: unclear goal, acceptance, scope, root cause, or high-risk method stays in
  `plan` for grill; do not implement.
- B: fixed, low-risk scope with empty `open_questions` uses Light and the concrete
  request as `source: user_request`.
- C: plan confirmation, independent acceptance surfaces, a product choice, public
  contract, migration, authentication, destructive data handling, or comparable
  risk uses Standard and waits for explicit approval.

Mechanical lint, typecheck, build, or documentation-index gates do not alone
trigger C; gate count never selects a profile. If implementation reveals missing
information, a changed root cause, new product choice, plan change, or scope
expansion, stop and re-run A/B/C. A stays in grill, B needs a precise delta
authorization. C shows short decision highlights and normally the created task id
for full-plan review, then waits for reapproval; only the adjacent authorization
exception below may bind a pre-checkpoint reply. Core applies structure and
revision changes; it never classifies from gate count.

A decided-design status sync is a narrow B exception only when the design body is
frozen, `open_questions` is empty, the user explicitly approved that design, the
workspace change is limited to artifact status and index metadata, and no product
choice, public behavior, or scope is added. Continue the open source task when the
same writer can write and its approved scope covers the sync. Use an atomically
authorized Light task only when the source task is closed, read-only, or absent.
An open source task with writer or scope mismatch requires handoff or plan work;
never create an overlapping shortcut task. If any condition fails, re-run A/B/C.

A design task may submit a `proposed` artifact for review, but its plan must cover
the post-approval status and index sync. After the user approves the design,
finish that sync in the same task and reverify; never create a Standard task whose
only purpose is `proposed` to `approved`.

Task creation or continuation requires an explicit write request and grants no
group, batch, Git, archive, cancellation, claim, or takeover authority.

## Execute

### Ordinary Light task

Use the Light scaffold, then create and authorize atomically:

```bash
latch checkpoint --print-plan-template light
latch checkpoint "Task title" --plan-file plan.json --profile light --authorize-request "User requested this scoped change" --json
```

The scaffold is shape-only; the current runner performs authorizable validation
and binds machine scope from `plan.workspace_scope.paths`. Implement, run every
named gate, submit to `review`, and wait; never auto-complete.

### Standard plan

Complete all 12 Standard fields. Chat shows only the goal, material scope or
risks, blocking `open_questions`, and task id; full plan truth stays in the task
store for Latch-Board or `context <task-id>`. Do not paste the plan JSON by
default.

Then create:

```bash
latch checkpoint --print-plan-template standard
latch checkpoint "Task title" --plan-file plan.json --json
```

After explicit implementation authorization and authorizable validation succeeds:

```bash
latch approve <task-id> --expect-revision <n> --reason "User approved the current plan" --json
```

Authorization may immediately precede checkpoint only for already displayed,
materially unchanged plan highlights and an adjacent explicit implementation
reply. An ordinary write request does not approve; read
[task lifecycle](references/task-lifecycle.md) for other fail-closed cases.

Implement, run every named gate, submit to `review`, and wait. Creation or
ownership changes never approve a plan.

### Review, recovery, and closeout

Read [task lifecycle](references/task-lifecycle.md) completely before
`reopen_review`, feedback, submission reconciliation, or closeout. Writer mismatch
is fail closed; use [session actors and handoff](references/session-actors-and-handoff.md).
Archive intent alone is not risk acceptance, and Git delivery remains separate.

## Invariants

- Structured JSON options allow at most one stdin consumer and fail before task
  mutation on invalid input.
- Missing canonical actor or writer mismatch is fail closed. Grok and Codex are
  equal hosts; never invent or export `LATCH_ACTOR`.
- Pass `--expect-revision` to every task mutation. In one uninterrupted mutation
  flow, use the successful JSON response's `revision` next and follow
  `next_action`; do not reread context only for `revision` or
  `next_action`. Refresh status after a revision conflict, user input boundary,
  judgment-requiring warning, or task meaning change; never auto-retry a revision
  conflict.
- Takeover transfers writer ownership only, never implementation approval.
- Run every gate; prefer `verify-all` for pending gates; instruction-only commands
  `echo`/`printf`/`true` are not evidence. Output is bounded; `--verbose` streams it;
  `--json` keeps one JSON document and streams to stderr; truncation is not failure;
  `--timeout-ms` per gate; no `log_ref`.
- In `dev` or `check`, use `verify-all`, not `approve --feedback`; exact violations
  use `reconcile <task-id> --expect-revision <n> --json` without selectors. Both
  advance proof generation; review uses `reopen-review`.
- `workspace_scope.paths` must be repo-relative POSIX paths. Files omit `/`,
  directories end in `/`, existing directories without `/` fail, and missing
  paths remain valid. Never infer scope or authorization from prose, paths, titles,
  answers, or artifacts. Plan-delta commands are fail closed and follow the
  current Handbook contract.
- New tasks use schema 5 with minimum writer `0.5.0`. Schema 2–4 tasks are
  historical read-only under CLI `0.5.0`. Never migrate during reads, startup,
  build, or verification.
- A gate pass requires successful command outcome, complete evidence, no covered
  mutation, current proof generation, and no unresolved violation. Preserve
  mutations for inspection; never reset, clean, stash, or auto-widen scope.
- Use `artifact add|remove` for artifact-only changes and
  `submit --verbose-warnings` when the full untracked list is needed.
- Preserve task facts, gate semantics, submission evidence, and knowledge impact.
- Run `done` only after explicit completion/archive authorization and `abandon`
  only after explicit cancellation authorization; never auto-complete review.
- Never perform Git add, commit, push, branch, reset, checkout, or clean without
  separate explicit authorization.

## Read one-level references on demand

Read a selected reference completely:

- [task lifecycle](references/task-lifecycle.md): plan, gates, submission, closeout.
- [session actors and handoff](references/session-actors-and-handoff.md): actor,
  takeover, handoff.
- [groups](references/groups.md): `group_id`.
- [knowledge and context](references/knowledge-and-context.md): Context packs.
- [migration](references/migration.md): schema migration.
- [records](references/records.md): Record.
