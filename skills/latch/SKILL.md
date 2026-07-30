---
name: latch
description: Track Latch tasks for repository writes and behavior changes, and handle explicit project-local Record save, recall, and conversion requests.
---

# Latch

Use for repository writes and observable behavior changes. Pure Q&A, read-only work,
no-write requests, and explicit no-Latch requests do not create tasks.

## Start with bounded state

1. Run `git status --short`, then `latch list --json --brief`.
2. For a named task, run `latch context <task-id> --json --status`; otherwise read
   status only for a returned `current_task_id`. If neither exists, do not call
   context without a task ID.
3. Read task artifacts first. Read `docs/INDEX.md` and 1–3 directly relevant docs
   only when the task affects product contracts, architecture, installation,
   documentation behavior, or current evidence is insufficient.

Above 50 worktree entries, report totals, status counts, and at most eight paths
unless the full list is requested. Avoid a full `git diff` unless review or exact
patch evidence requires it, and never join high-output commands with `;`.

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
authorization, and C shows the updated complete plan and waits for reapproval.
Core applies structure and revision changes; it never classifies from gate count.

Creating or continuing a task requires an explicit write request. Task authority
never implies group, batch, Git, archive, cancellation, claim, or takeover authority.

## Execute

### Ordinary Light task

Print the canonical scaffold, complete it with no open questions, then create and
authorize the task atomically:

```bash
latch checkpoint --print-plan-template light
latch checkpoint "Task title" --plan-file plan.json --profile light --authorize-request "User requested this scoped change" --scope-summary "Bounded scope" --scope-path path/to/file --json
```

The template proves schema validity only; it does not establish semantic
completeness, choose A/B/C, or authorize work. Implement the scope, run every
named gate, submit to `review`, and wait. Never auto-complete.

### Standard plan

Prepare and show the complete plan, then create it:

```bash
latch checkpoint "Task title" --plan-file plan.json --json
```

Only after explicit implementation authorization and empty `open_questions`, run:

```bash
latch approve <task-id> --expect-revision <n> --reason "User approved the current plan" --json
```

Implement the approved scope, run every named gate, submit to `review`, and wait.
Creation, claim, or takeover does not approve a plan.

### Review closeout fast path

Use only when status shows `phase: review`, every gate is `pass`, `stale` and
`pending` are zero, and the user explicitly requests completion, archive,
takeover, or Git delivery without renewed review.

1. Read `latch context <task-id> --json --status`. Writer mismatch is fail closed;
   follow [session actors and handoff](references/session-actors-and-handoff.md)
   and run takeover only with explicit authorization:

```bash
latch takeover <task-id> --expect-revision <n> --reason "User authorized takeover" --json
```

2. Read the bounded brief and reconcile `submission.unverified` under
   [task lifecycle](references/task-lifecycle.md). Archive intent alone is not risk
   acceptance. Run `done` only with explicit completion or archive authorization:

```bash
latch done <task-id> --expect-revision <n> --followup "Concrete next action, or no follow-up and why" --json
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
- Use `artifact add|remove` for artifact-only changes and
  `submit --verbose-warnings` when the full untracked list is needed.
- Preserve task facts, gate semantics, submission evidence, and knowledge impact.
- Run `done` only after explicit completion/archive authorization and `abandon`
  only after explicit cancellation authorization; never auto-complete review.
- Never perform Git add, commit, push, branch, reset, checkout, or clean without
  separate explicit authorization.

## Read one-level references on demand

Read a selected reference completely:

- [task lifecycle](references/task-lifecycle.md): plan, feedback, gates, submit,
  `knowledge_impact`, unverified evidence, closeout, or abandon.
- [session actors and handoff](references/session-actors-and-handoff.md): actor,
  writer mismatch, takeover, handoff, or provenance.
- [groups](references/groups.md): `group_id`, planning waves, or siblings.
- [knowledge and context](references/knowledge-and-context.md): freshness,
  knowledge impact, Context packs, orientation, or benchmarks.
- [migration](references/migration.md): schema 2, claim, legacy patching, minimum
  writer versions, or `downgrade-v2`.
- [records](references/records.md): explicit Record operations or task conversion.
