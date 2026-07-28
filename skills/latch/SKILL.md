---
name: latch
description: Track Latch tasks for repository writes and behavior changes, and handle explicit project-local Record save, recall, and conversion requests.
---

# Latch

Use for repository writes and behavior changes; pure Q&A, read-only, no-write, or explicit no-Latch requests do not create tasks.

## Start with bounded output

1. Run `git status --short`, then `latch list --json --brief`.
2. If the user names a task, read `latch context <task-id> --json --status`. Otherwise read status only for a returned `current_task_id`; if neither exists, do not call context without a task ID.
3. Read task artifacts first. Read `docs/INDEX.md` and directly relevant project documents only when the task affects product contracts, architecture, installation, documentation behavior, or existing evidence is insufficient.
4. Preserve unrelated worktree changes.

Always execute `git status --short`; above 50 entries return only the total, status counts, and at most eight representative paths unless the full list is explicitly requested. Avoid a full `git diff` unless code review or exact patch evidence requires it. Run high-output status, context, diff, and stat separately; never join them with `;` into one tool result.

Recover routine task state from exact task or group artifacts; do not read other Codex conversations. Do not read or write Records during session startup, task recovery, or ordinary discussion without explicit Record intent.

## Classify before writing

- A: Grill and remain in `plan` when the goal, success criteria, scope, product choice, root cause, or a high-risk change is too unclear to write a complete plan; keep only blocking questions in `open_questions`.
- B: Use a Light task only when the requested change and success criteria are concrete, scope is fixed, implementation is low risk, `open_questions` is empty, and no extra scope is inferred.
- C: Use a Standard task when a complete plan can be written but implementation needs plan approval or includes multiple independent acceptance surfaces, a product choice, a public contract change, migration, authentication, destructive data handling, or another high-risk surface.

Multiple mechanical lint, typecheck, build, documentation-index, or similar gates do not trigger C when they prove the same bounded acceptance surface. Gate count alone never decides the profile.

Whenever implementation reveals missing information, a changed root cause, a new product choice, or scope expansion, stop implementation and update the plan before continuing. Re-run A/B/C: a Light task follows the branches below, while a Standard task must show the updated complete plan and wait for explicit reapproval.

If a Light task gains a plan change, product choice, or scope expansion, stop and re-run A/B/C before continuing:

- A: remain in `plan`, record the blockers, and grill without implementing;
- B: keep the Light profile only after updating the plan and obtaining a new request or precise delta authorization;
- C: upgrade to Standard, show the updated complete plan, and wait for explicit approval.

Core applies requested structure and revision changes; it never classifies or upgrades a task from gate count, command names, or command semantics.

Require an explicit user write request before creating or continuing a task. Never infer group-wide, batch, Git, archive, cancellation, claim, or takeover authority from task-level authorization.

## Three executable paths

### Ordinary Light task

1. Prepare a complete plan file with no open questions.
2. Create and authorize it atomically from the concrete request:

```bash
latch checkpoint "Task title" --plan-file plan.json --profile light --authorize-request "User requested this scoped change" --scope-summary "Bounded scope" --scope-path path/to/file --json
```

3. Implement the scope, run every named gate, submit to `review`, and wait. Never run `done` automatically.

### Standard plan

1. Prepare and show the complete plan. Create the task with `latch checkpoint "Task title" --plan-file plan.json --json`.
2. Run `approve` only after explicit implementation authorization and only when `open_questions` is empty:

```bash
latch approve <task-id> --expect-revision <n> --reason "User approved the current plan" --json
```

3. Implement the approved scope, run every named gate, submit to `review`, and wait. Task creation and takeover do not approve a plan.

### Review closeout fast path

Use this path only when status shows `phase: review`, every gate is `pass`, both `stale` and `pending` are zero, the user explicitly requests takeover, completion/archive, or Git delivery, and the user does not request renewed code review or history explanation.

1. Run `git status --short` and `latch list --json --brief` with the output limits above.
2. Read only `latch context <task-id> --json --status`.
3. If no canonical actor exists, remain read-only. If writer mismatches, fail closed until the user explicitly authorizes takeover of the named revision, then run:

```bash
latch takeover <task-id> --expect-revision <n> --reason "User authorized takeover" --json
```

Takeover only transfers writer ownership; it does not reapprove a plan or authorize `done`. Use its returned `revision` for the next mutation.

4. Before `done`, read the bounded `--brief` view and reconcile
   `submission.unverified` under the lifecycle Finish rules; archive intent alone
   is not risk acceptance.

5. Run `done` only when the user explicitly authorizes completion/archive of the named task:

```bash
latch done <task-id> --expect-revision <n> --followup "Concrete next action, or no follow-up and why" --json
```

Do not load `--brief --history timeline` unless gates are missing, stale, pending, or failed; writer data is unclear; the brief lacks a required fact; or the user requests history. Do not rerun an already passed, non-stale full build solely to close review.

Git delivery remains separate from Latch and requires separate authorization.

## Non-negotiable contracts

- Treat a missing canonical actor or writer mismatch as fail closed; remain read-only until claim/takeover. Grok and Codex are equal hosts; never invent or export `LATCH_ACTOR`.
- Pass `--expect-revision` to every task mutation. In one uninterrupted mutation flow, reuse the successful JSON response's `revision`; do not reread context only to obtain it. Refresh status after a revision conflict, new user input boundary, judgment-requiring warning, or task meaning change; never auto-retry conflicts.
- Treat takeover as ownership transfer only, never as implementation approval.
- Submit only after all current named gates pass, or use the documented `--no-verify` exception for an approved plan without gates. Submit enters `review`; never auto-complete it.
- Do not use `echo`, `printf`, `true`, or any instruction-only command as a gate. Put manual steps in diagnostics or `submission.unverified`; record explicit acceptance facts after completion.
- Prefer `verify-all` for pending gates; use `artifact add|remove` for artifact-only changes and `submit --verbose-warnings` for the full untracked path list.
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
- [records](references/records.md): explicit Record operations or task conversion.
