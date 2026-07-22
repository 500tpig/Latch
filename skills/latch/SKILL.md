---
name: latch
description: Use for Latch task tracking, implementation, verification, review feedback, archival, and abandonment in a project using the Latch CLI. Apply the A/B/C trigger rules to repository-write or observable-behavior requests; explicit Latch requests use the same rules.
---

# Latch

Apply these rules to repository-write or observable-behavior requests. Do not create a task for pure Q&A, read-only exploration, no-write intent, or an explicit request not to use Latch.

## Start

1. Run `git status --short`.
2. Run `latch list --json --brief`.
3. If the user names a task, run `latch context <task-id> --json --status`; otherwise, run it for the returned `current_task_id` only when that field exists. If neither exists, do not call `latch context --json --status` without a task ID.
4. Expand with `--brief --history timeline` when goal, scope, acceptance, pending plan items, gates, submission evidence, or readable history is needed; read raw events only for debugging, auditing, or compatibility checks. Use `--since-revision` only with a trusted baseline for that exact task revision.
5. Read task artifacts first. Read `docs/INDEX.md` and directly relevant project documents only when the task affects product contracts, architecture, installation, documentation behavior, or the available evidence is insufficient.
6. Preserve unrelated worktree changes.

## Read references on demand

Read the complete linked file only when its condition applies:

- Read [session actors and handoff](references/session-actors-and-handoff.md) for actor adapters, missing canonical actors, writer takeover, forks or new conversations, handoff prompts, and provenance changes.
- Read [groups](references/groups.md) before reading or changing `group_id`, listing group members, or reasoning about sibling task independence.
- Read [knowledge and context](references/knowledge-and-context.md) for freshness checks, `knowledge_impact`, Context packs, orientation budgets, or context benchmarks.
- Read [migration](references/migration.md) for schema 2 tasks, `claim`, legacy patching, minimum writer versions, or `downgrade-v2`.

## Trigger rules

Classify before implementation:

- A: Grill and remain in `plan` when the goal, success criteria, scope, product choice, root cause, or high-risk change is unclear; record only blocking questions in `open_questions`.
- B: Use light request authorization only when the change, scope, success criteria, and low-risk implementation are concrete, `open_questions` is empty, and no extra scope is inferred.
- C: Use a standard task and explicit approval when implementation requires design choice, migration, authentication, public API changes, destructive data handling, or multiple disputed gates.
- Use `source: user_request` for a complete low-risk request, `source: user_delta` for a precise low-risk addition to the current plan, and `source: user_approve` after the displayed standard plan receives explicit approval.
- Use `checkpoint --retrospective-file` only for an honest after-the-fact record when no matching open task exists.
- Stop and return to `plan` when implementation reveals missing information or scope expansion; never stretch an earlier authorization.

Require an explicit user write request before creating or continuing a task. Do not infer group-wide, batch, Git, archive, or cancellation authority from task-level authorization.

## Plan and records

- Create a task only with a complete plan file. Wrap file paths, identifiers, configuration keys, and commands in inline code, and keep each plan item to one sentence.
- Show every plan before implementation. Run `approve` only after explicit implementation authorization, and reject approval while `open_questions` is non-empty.
- Record task facts rather than chat logs. During grill, persist only blocking questions and short durable decisions.
- Classify `review_feedback`, decisions, submissions, and closure text before writing concise user-readable Chinese summaries of what happened, why it matters, what changed, and the next action.
- Keep internal schema terms in raw events or technical details rather than default user-facing summaries.

## Ownership and revision

- Treat a missing canonical actor or a writer mismatch as fail closed: keep the caller read-only and do not mutate until the required explicit claim or takeover authorization is present.
- Treat takeover as ownership transfer only, never as implementation approval. Preserve the phase and wait for separate approval unless the same user message explicitly authorizes both.
- Pass `--expect-revision` to every task mutation.
- In one uninterrupted mutation flow, use the successful JSON result's `revision` for the next `--expect-revision`; do not reread context only to obtain that revision.
- Refresh status after a revision conflict, a new user input boundary, a warning that requires judgment, or a change in task meaning. Never auto-retry a conflicted mutation.
- Keep normal sequential handoff provenance `clean`; read the session reference before any provenance change.

## Create and approve

Create a standard task with:

```bash
latch checkpoint "Task title" --plan-file plan.json
```

Create a complete low-risk task atomically with `--authorize-request <reason>` and optional `--scope-summary` / repeated `--scope-path`; this writes `source: user_request` and creates a light task. Use `--authorization-file` for complex scope structure, and `--retrospective-file` only for the retrospective case defined above.

Approve only after displaying the current plan and receiving explicit authorization:

```bash
latch approve <task-id> --expect-revision <n> --reason "User approved the current plan" --json
```

## Update and feedback

- Use `save --plan-file` when goal, scope, acceptance, contracts, user flow, or important boundaries change. This returns the task to `plan` and requires new approval.
- Use `approve --feedback` only for an executable implementation correction that leaves the approved plan intact; it starts a new work revision and invalidates prior proof.
- Use `approve --non-implementation-feedback` only when implementation, configuration, generated inputs, gates, and public behavior are unchanged; it preserves the existing proof.
- Diagnose evaluative or ambiguous feedback before mutating. If impact is uncertain, treat it as an implementation correction.

## Verify and submit

- Run every named gate from the approved plan with `latch verify <task-id> --expect-revision <n> --name <gate-name> --json`.
- Use diagnostic argv only after `--`; diagnostic results never satisfy submit gates.
- Submit only after all current named gates pass, or use `--no-verify` with a reason for an approved plan without gates; prefer `--knowledge-impact-none <reason>` for a concrete no-impact record and retain `--knowledge-impact-file` for `updated` impacts.
- Read the knowledge reference before preparing `knowledge_impact`. Report non-`tracked` artifact delivery and untracked-worktree warnings without inventing artifact ownership; treat them as delivery risks, not automatic lifecycle failures.
- Submit the current work revision to `review` and wait for user acceptance; do not run `done` automatically.

## Finish

- Run `done` only after explicit user authorization to complete or archive the named task.
- Run `abandon` only after explicit user authorization to cancel the named task.
- Inspect open tasks before either command and modify only the named task.
- Never perform Git add, commit, push, branch, reset, checkout, or clean unless separately requested.
