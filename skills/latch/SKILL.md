---
name: latch
description: Use for explicitly requested Latch task tracking, continuation, implementation approval, verification, review feedback, archival, or abandonment in a project using the Latch CLI. Trigger when the user says “Latch”, asks to record or continue a Latch task, names a Latch task ID, or explicitly authorizes implementation, completion, archival, or abandonment of an existing Latch task. Do not create a task when Latch was not explicitly requested.
---

# Latch

Use Latch only after the request explicitly mentions Latch.

## Start

1. Run `git status --short`.
2. Run `latch list --json --brief`.
3. If the user names a task, run `latch context <task-id> --json --brief`; otherwise read the current task.
4. Read task artifacts, then `docs/INDEX.md`, then 1–3 directly relevant project documents.
5. Preserve unrelated worktree changes.

## Plan writing

- Wrap each file path, code identifier, configuration key, and command in inline code.
- Keep each plan item to one sentence; do not add bold text or local links solely for presentation.

## C2 decision rules (partial release)

The explicit Latch entry rule remains active until the final contract and instruction surface ship together. After the user explicitly invokes Latch or continues an existing Latch task, classify the request before implementation:

- Grill and keep the task in `plan` when the goal, success criteria, scope, product choice, root cause, or high-risk change is unclear; record only questions that block implementation in `open_questions`.
- Use light request authorization only when the change, scope, success criteria, and low-risk implementation are all concrete, `open_questions` is empty, and no extra scope is inferred.
- Use `source: user_request` for a complete low-risk request, `source: user_delta` for a precise low-risk addition to the current plan, and `source: user_approve` after a displayed standard plan receives explicit approval.
- Use standard plan and explicit approval when implementation requires design choice, migration, authentication, public API changes, destructive data handling, or multiple disputed gates.
- Stop and return to `plan` when implementation reveals missing information or scope expansion; do not stretch an earlier authorization to cover it.

Schema 3 authorization uses `--authorization-file`; retrospective input uses `--retrospective-file`; submit and legacy patch use `--knowledge-impact-file`. A schema 2 task must be explicitly claimed before these commands can modify it.

## C3 group rules (partial release)

- Use `group_id` only as an optional exact-match label when the user identifies a related wave or batch; do not infer a group solely from overlapping paths.
- Keep every member as an independent task with its own writer, authorization, verification, review, and archive decision.
- A blocked or archived sibling never blocks another member, and continuing one task never authorizes group-wide claim or takeover.
- Use `list --group <id>` for open members, add `--include-archive` only when history is needed, and treat context siblings as read-only hints.
- Create or mutate `group_id` only on schema 3 tasks; a legacy schema 2 task must be claimed first.

## C4 knowledge freshness rules (partial release)

- Use `knowledge fingerprint --path <path>` to calculate `sha256-v1`, and use `knowledge check --path <path>` to read freshness without modifying the document.
- Use `knowledge check --task <id>` only for a submitted `knowledge_impact.updated`; it reports each referenced artifact and does not authorize or complete the task.
- Treat `stale`, `baseline_missing`, and `error` as review-needed evidence, and never present them as current source facts.
- Update `last_fingerprint` and provenance only as part of an explicitly authorized knowledge document edit; reading, context generation, submit, and done never update the baseline.
- Freshness is not a submit, done, group, or archive gate in the partial release; existing Light proof rules remain the lifecycle contract.

## C5 context pack rules (partial release)

- Use `context pack --input-file <path>` only when a bounded orientation pack materially reduces repeated reading; ordinary small reads do not need a pack.
- Select task, knowledge, map, excerpt, and expand sources in the request file; Core validates, reads, orders, labels, and truncates them but does not choose sources semantically.
- Reuse the returned orientation id and counters only for the same user intent and task; drop them when implementation starts, evidence is sufficient, the task changes, or the user changes intent.
- Treat the 24000 pack limit, 8000 expand batch limit, and 48000 orientation expand limit as code-point budgets for the pack helper, not as limits on the whole conversation.
- Never present stale, baseline-missing, errored, or retired knowledge as fresh; use the pack freshness label and expand into source files when current evidence is required.
- Use `benchmark context` for reproducible diagnostics from supplied case/run files; it does not execute search tools and does not become a lifecycle gate.

## C6 migration rules (partial release)

- Treat CLI version `0.2.0` as the minimum writer for schema 3 task data and v3-only events.
- Expect new `checkpoint` tasks to use schema 3, standard profile, and the current canonical session actor as `primary_writer`.
- Treat a schema 2 open task as `legacy_unclaimed`; keep it read-only until the user explicitly continues that specific task, then run `claim` with its current revision.
- Never infer a batch claim from one continued task, and never use ordinary writes to upgrade schema 2 data.
- Run `downgrade-v2 --task <id> --expect-revision <n> --confirm-data-loss` only after explicit user confirmation that v3-only fields and event details will remain only in backup.
- Preserve the returned `.latch/archive/v3-backup/` directory, do not delete `.latch`, and report any downgrade warning or partial failure before further task writes.

## Create and approve

Create a task only with explicit authorization and a complete plan file:

```bash
latch checkpoint "Task title" --plan-file plan.json
```

Show the plan before implementation. Run `approve` only after explicit implementation authorization:

```bash
latch approve <task-id> --expect-revision <n> --reason "User approved the current plan"
```

Do not treat vague agreement as approval. Reject approval while `open_questions` is non-empty.

## Update and feedback

Use `save --plan-file` when goal, scope, acceptance, contracts, user flow, or important boundaries change. This returns the task to plan and requires new approval.

Use review correction only for an executable implementation change that leaves the approved plan intact:

```bash
latch approve <task-id> --expect-revision <n> --feedback "Correction summary"
```

If feedback is evaluative or ambiguous, diagnose first and ask one concrete question without changing task state.

## Verify and submit

Run named gates from the approved plan:

```bash
latch verify <task-id> --expect-revision <n> --name <gate-name>
```

Use diagnostic argv only after `--`; it does not satisfy submit gates. Submit only after all current gates pass, or use `--no-verify` for an approved plan without gates and provide a reason.

## Finish

Run `done` only after explicit user authorization to complete or archive the task. Run `abandon` only after explicit user authorization to cancel it. Before either command, inspect all open tasks and modify only the named task.

Never perform Git add, commit, push, reset, checkout, or clean unless separately requested.
