# Task lifecycle

Read this reference for plan structure, checkpoint and approve details, feedback classification, gate execution, submit evidence, `knowledge_impact`, followup, or abandon.

## Plan and authorization

- Create a task only from a complete plan file. Keep paths, identifiers, keys, and commands in inline code, and keep each plan item to one sentence.
- New/updated plans need normalized repo-relative POSIX `workspace_scope.paths`; never infer it from prose, authorization, or artifacts.
- New tasks use schema 4. Treat schema 3 as read-only and run the explicitly authorized single-task `upgrade-v4` before any lifecycle mutation; never upgrade during context, build, or verification.
- Shape validation keeps history readable; writable validation requires schema 4 `workspace_scope`. Scaffolds are shape-only. Before `work_basis` writes, run authorizable validation by profile. Show every Standard plan before approval.
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
- Never use `echo`, `printf`, `true`, or a command whose only effect is to print instructions as a gate; a zero exit code from such a command does not prove that a manual step occurred.
- Put a manual step in a non-gating diagnostic when the plan needs to preserve it as an instruction, or in `submission.unverified` while acceptance remains outstanding; diagnostic success never verifies the manual action.
- Run every named gate from the approved plan with `latch verify <task-id> --expect-revision <n> --name <gate-name> --json`.
- A gate passes only when its command succeeds, workspace evidence is complete, covered workspace is unchanged, and its proof binds the current work revision and generation with no unresolved violation.
- Preserve gate mutations for user inspection. Do not reset, clean, stash, or auto-approve a wider scope; scope changes return to plan and require explicit approval.
- `verify-all` stops on command failure, evidence error, workspace mutation, scope violation, or gate-to-gate baseline mismatch. Reuse each successful JSON revision and rerun all stale named gates on the current generation.
- Use diagnostic argv only after `--`; diagnostic results never satisfy submit gates.
- Submit only after all current named gates pass. For an approved plan without gates, use `--no-verify` with a concrete reason.
- Submit performs a live workspace and evidence-integrity preflight. A mismatch advances proof generation, rejects submit, and does not run gates automatically; `context` reports live status read-only.
- Prefer `--knowledge-impact-none <reason>` for a concrete no-impact record; use `--knowledge-impact-file <path>` for `updated` or other structured impacts. Read [knowledge and context](knowledge-and-context.md) before preparing or correcting `knowledge_impact`.
- Report non-`tracked` artifact delivery and untracked-worktree warnings as delivery risks; do not invent artifact ownership or turn them into automatic lifecycle failures.
- Submit the current work revision to `review` and wait for user acceptance. Never run `done` automatically.

## Finish

- Inspect open tasks and mutate only the named task.
- Before `done`, read the bounded brief and compare the current
  `submission.unverified` with the user's latest explicit review acceptance.
- An archive request alone is not acceptance of remaining risk. If an unverified
  item remains unresolved, `followup` must name its owner and next action or record
  the user's explicit risk acceptance.
- If manual verification completed after submit, `followup` must record the
  concrete action and observed result as a new acceptance fact, then identify
  which prior unverified item it resolves.
- Use "no follow-up" only when no unresolved unverified item remains, and state the
  concrete reason. If the required acceptance fact, owner, or next action is
  missing, remain in review and ask for it.
- Run `done` only after explicit completion/archive authorization. Write a concrete next task/action in `followup`, or state that there is no follow-up and why.
- Run `abandon` only after explicit cancellation authorization.
- Never treat task-level authorization as Git authorization.
