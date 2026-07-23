# Task lifecycle

Read this reference for plan structure, checkpoint and approve details, feedback classification, gate execution, submit evidence, `knowledge_impact`, followup, or abandon.

## Plan and authorization

- Create a task only from a complete plan file. Keep paths, identifiers, keys, and commands in inline code, and keep each plan item to one sentence.
- Show every Standard plan before implementation. Run `approve` only after explicit implementation authorization; reject approval while `open_questions` is non-empty.
- Use `source: user_request` for a complete low-risk request, `source: user_delta` for a precise low-risk addition to the current plan, and `source: user_approve` after explicit approval of a displayed Standard plan.
- Use `checkpoint --retrospective-file` only for an honest after-the-fact record when no matching open task exists.
- Use `save --plan-file` when goal, scope, acceptance, contracts, user flow, or important boundaries change. This returns the task to `plan` and requires new approval.
- Record durable task facts rather than chat logs. Keep review feedback, decisions, submissions, and closure summaries concise and user-readable.

## Feedback

- Use `approve --feedback` only for an executable implementation correction that leaves the approved plan intact; it starts a new work revision and invalidates prior proof.
- Use `approve --non-implementation-feedback` only when implementation, configuration, generated inputs, gates, and public behavior are unchanged; it preserves existing proof.
- Diagnose evaluative or ambiguous feedback before mutating. If impact is uncertain, treat it as an implementation correction.

## Verify and submit

- When authoring `verification_plan`, avoid redundant named gates: every gate must add distinct proof. If a final comprehensive gate already runs typecheck, build, or the full test suite, keep subsumed steps as development diagnostics unless they verify a distinct acceptance requirement. Once approved, never skip a named gate because its proof overlaps another gate.
- Run every named gate from the approved plan with `latch verify <task-id> --expect-revision <n> --name <gate-name> --json`.
- Use diagnostic argv only after `--`; diagnostic results never satisfy submit gates.
- Submit only after all current named gates pass. For an approved plan without gates, use `--no-verify` with a concrete reason.
- Prefer `--knowledge-impact-none <reason>` for a concrete no-impact record; use `--knowledge-impact-file <path>` for `updated` or other structured impacts. Read [knowledge and context](knowledge-and-context.md) before preparing or correcting `knowledge_impact`.
- Report non-`tracked` artifact delivery and untracked-worktree warnings as delivery risks; do not invent artifact ownership or turn them into automatic lifecycle failures.
- Submit the current work revision to `review` and wait for user acceptance. Never run `done` automatically.

## Finish

- Inspect open tasks and mutate only the named task.
- Run `done` only after explicit completion/archive authorization. Write a concrete next task/action in `followup`, or state that there is no follow-up and why.
- Run `abandon` only after explicit cancellation authorization.
- Never treat task-level authorization as Git authorization.
