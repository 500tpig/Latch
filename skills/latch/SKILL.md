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
