---
name: latch
description: Use for Latch task tracking, implementation, verification, review feedback, archival, and abandonment in a project using the Latch CLI. Apply the A/B/C trigger rules to repository-write or observable-behavior requests; explicit Latch requests use the same rules.
---

# Latch

Apply these rules to repository writes and observable-behavior changes. Do not create a task for pure Q&A, read-only exploration, no-write intent, or an explicit request not to use Latch.

## Start with bounded output

1. Run `git status --short`, then `latch list --json --brief`.
2. If the user names a task, read `latch context <task-id> --json --status`. Otherwise read status only for a returned `current_task_id`; if neither exists, do not call context without a task ID.
3. Read task artifacts first. Read `docs/INDEX.md` and directly relevant project documents only when the task affects product contracts, architecture, installation, documentation behavior, or existing evidence is insufficient.
4. Preserve unrelated worktree changes.

Always execute `git status --short`, but above 50 entries return only the total, status counts, and at most eight representative paths unless the full list is requested. Avoid a full `git diff` unless code review or exact patch evidence requires it. Run high-output status, context, diff, and stat separately; never join them with `;` into one tool result.

## Classify before writing

- A: Grill and remain in `plan` when goal, success criteria, scope, product choice, root cause, or a high-risk change is unclear; keep only blocking questions in `open_questions`.
- B: Use a Light task only when change, scope, success criteria, and low-risk implementation are concrete, `open_questions` is empty, and no extra scope is inferred.
- C: Use a Standard task when implementation needs a design choice, migration, authentication, public API change, destructive data handling, or disputed/multiple gates.

Require an explicit user write request before creating or continuing a task. Stop and return to `plan` when implementation reveals missing information or scope expansion. Never infer group-wide, batch, Git, archive, cancellation, claim, or takeover authority from task-level authorization.

## Three executable paths

### Ordinary Light task

1. Prepare a complete plan file with no open questions.
2. Create and authorize it atomically from the concrete request:

```bash
latch checkpoint "Task title" --plan-file plan.json --profile light --authorize-request "User requested this scoped change" --scope-summary "Bounded scope" --scope-path path/to/file --json
```

3. Implement only that scope, run every named gate with `verify`, then submit to `review`. Wait for user acceptance; never run `done` automatically.

### Standard plan

1. Prepare and show the complete plan. Create the task with `latch checkpoint "Task title" --plan-file plan.json --json`.
2. Run `approve` only after explicit implementation authorization and only when `open_questions` is empty:

```bash
latch approve <task-id> --expect-revision <n> --reason "User approved the current plan" --json
```

3. Implement the approved scope, run every named gate with `verify`, submit to `review`, and wait. Never treat task creation, takeover, or feedback as plan approval.

### Review closeout fast path

Use this path only when status shows `phase: review`, every gate is `pass`, both `stale` and `pending` are zero, the user explicitly requests takeover, completion/archive, or Git delivery, and the user does not request renewed code review or history explanation.

1. Run `git status --short` and `latch list --json --brief` with the output limits above.
2. Read only `latch context <task-id> --json --status`.
3. If no canonical actor exists, remain read-only. If writer mismatches, fail closed until the user explicitly authorizes takeover of the named revision, then run:

```bash
latch takeover <task-id> --expect-revision <n> --reason "User authorized takeover" --json
```

Takeover only transfers writer ownership; it does not reapprove a plan or authorize `done`. Use its returned `revision` for the next mutation.

4. Run `done` only when the user explicitly authorizes completion/archive of the named task:

```bash
latch done <task-id> --expect-revision <n> --followup "Concrete next action, or no follow-up and why" --json
```

Do not load `--brief --history timeline` on this path unless gates are missing, stale, pending, or failed; writer data is unclear; status cannot establish a required fact; or the user requests historical evidence. Do not rerun an already passed, non-stale full build solely to close review.

Git delivery remains separate: do not derive permission for add, commit, push, branch, reset, checkout, or clean from takeover, task approval, submit, review acceptance, or `done`. Latch never performs Git operations.

## Non-negotiable contracts

- Treat a missing canonical actor or writer mismatch as fail closed; remain read-only until the required explicit claim or takeover authorization exists.
- Pass `--expect-revision` to every task mutation. In one uninterrupted flow, use each successful JSON response's `revision`; do not reread context only to obtain it. Refresh status after a revision conflict, new user input boundary, judgment-requiring warning, or task meaning change, and never auto-retry a conflict.
- Treat takeover as ownership transfer only, never as implementation approval.
- Submit only after all current named gates pass, or use the documented `--no-verify` exception for an approved plan without gates. Submit enters `review`; never auto-complete it.
- Run `done` only after explicit user authorization to complete/archive the named task. Run `abandon` only after explicit user authorization to cancel it.
- Preserve task facts and the semantics of gates, submission, and `knowledge_impact`; never fabricate or reinterpret them to advance phase.
- Never perform Git add, commit, push, branch, reset, checkout, or clean without separate explicit authorization.

## Read one-level references on demand

Read each complete reference only when its condition applies:

- [task lifecycle](references/task-lifecycle.md): plan structure, checkpoint/approve details, feedback classification, gate execution, submit evidence, `knowledge_impact`, followup, or abandon.
- [session actors and handoff](references/session-actors-and-handoff.md): actor adapters, missing canonical actor, writer mismatch, takeover, a new session continuing the same open task, handoff prompts, or provenance changes.
- [groups](references/groups.md): reading/changing `group_id`, listing a planning wave, or reasoning about sibling independence.
- [knowledge and context](references/knowledge-and-context.md): freshness, `knowledge_impact` correction, Context packs, orientation budgets, or benchmarks.
- [migration](references/migration.md): schema 2, claim, legacy patching, minimum writer versions, or `downgrade-v2`.
