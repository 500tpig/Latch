---
name: latch
description: Track Latch tasks for repository writes and behavior changes, and handle explicit project-local Record save, recall, and conversion requests.
---

# Latch

Use for repository writes and observable behavior changes. Pure Q&A, read-only work,
no-write requests, and explicit no-Latch requests do not create tasks.

## Select the task runner first

- Use Latch CLI `0.5.0` as the current runner. In the Latch source repo, use
  `node dist/cli.js`; in an adopter repo, use a verified `latch@0.5.0` install.
- New tasks use schema 5 with minimum writer `0.5.0`.
- Read `task_schema_version` from `context <task-id> --json --status` before a
  mutation. Schema 2–4 tasks are historical read-only under the current runner;
  do not claim, upgrade, downgrade, take over, or otherwise mutate them.
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
authorization, and C shows short decision highlights plus the task id for
full-plan review, then waits for reapproval. Core applies structure and revision changes;
it never classifies from gate count.

Task creation or continuation requires an explicit write request and grants no
group, batch, Git, archive, cancellation, claim, or takeover authority.

## Execute

### Ordinary Light task

Fill the Light scaffold, then create and authorize atomically:

```bash
latch checkpoint --print-plan-template light
latch checkpoint "Task title" --plan-file plan.json --profile light --authorize-request "User requested this scoped change" --json
```

Light fields: `goal`, `workspace_scope`, `scope`, `acceptance`, `approach`,
`verification_plan`. Omitted `api_assumptions`,
`permission_assumptions`, `data_assumptions`, `user_flow`, `out_of_scope`, and
`open_questions` default to `[]`; storage remains a complete `TaskPlan`. The
scaffold proves schema validity only; it cannot choose A/B/C or authorize work.
Authorization requires meaningful core fields and a gate. Implement, run every
named gate, submit to `review`, wait; never auto-complete.
`--authorize-request` takes its machine scope from `plan.workspace_scope.paths`;
do not provide a second scope input.

### Standard plan

Complete 12 Standard fields into `--plan-file`. Full plan truth stays in the plan
file and task store for Latch-Board task detail or the selected runner's
`context <task-id>`.

Default chat is short decision highlights only, not a plan dump:

- `goal` in one or two sentences
- material scope, risks, or choices that affect approval
- blocking `open_questions`, if any
- task id, and that full plan is in Board/CLI rather than chat

Do not paste the full `plan.json` body, and do not dump all 12 fields by default.
Expand a field only when the user asks or when that field is the decision point.
Keep paths, identifiers, keys, and commands in inline code.

Then create:

```bash
latch checkpoint --print-plan-template standard
latch checkpoint "Task title" --plan-file plan.json --json
```

After explicit implementation authorization and authorizable validation succeeds:

```bash
latch approve <task-id> --expect-revision <n> --reason "User approved the current plan" --json
```

Implement, run every named gate, submit to `review`, and wait. Creation or
ownership changes never approve a plan.

### Review closeout fast path

Use only when status shows `phase: review`, every gate is `pass`, `stale` and
`pending` are zero, and the user explicitly requests completion, archive,
takeover, or Git delivery without renewed review.

1. Read `context <task-id> --json --status` with the current runner. Writer mismatch is fail closed;
   follow [session actors and handoff](references/session-actors-and-handoff.md)
   and run takeover only with explicit authorization:

```bash
latch takeover <task-id> --expect-revision <n> --reason "User authorized takeover" --json
```

2. Read the bounded brief and reconcile the submission under
   [task lifecycle](references/task-lifecycle.md). Archive intent alone is not risk
   acceptance. For schema 5, provide exactly one resolution for each
   `submission.unverified_items` entry:

```bash
latch done <task-id> --expect-revision <n> --closeout-file closeout.json --json
```

Do not rerun an already passed, non-stale full build solely for closeout. Git
delivery remains separate and needs separate authorization.

## Invariants

- Missing canonical actor or writer mismatch is fail closed. Grok and Codex are
  equal hosts; never invent or export `LATCH_ACTOR`.
- Pass `--expect-revision` to every task mutation. In one uninterrupted mutation
  flow, reuse the successful JSON response's `revision`; do not reread context
  only for revision. Refresh status after a revision conflict, user input
  boundary, judgment-requiring warning, or task meaning change; never auto-retry.
- Takeover transfers writer ownership only, never implementation approval.
- Run all current named gates before submit. Prefer `verify-all` for pending gates;
  instruction-only commands such as `echo`, `printf`, and `true` are not evidence.
- After an in-scope correction during `dev` or `check` with existing proof, do not
  use review-only `approve --feedback`; run `verify-all` so its preflight advances
  the proof generation and reruns every stale named gate.
- New and updated plans require repo-relative POSIX `workspace_scope.paths`; never
  infer machine scope from prose, authorization, or artifacts.
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
