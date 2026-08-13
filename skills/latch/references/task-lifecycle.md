# Task lifecycle

Read this reference for plan structure, checkpoint and approve details, feedback classification, gate execution, submit evidence, `knowledge_impact`, followup, or abandon.

## Plan and authorization

- Create a task only from a complete plan file. Keep paths, identifiers, keys, and commands in inline code, and keep each plan item to one sentence.
- New and updated plans require normalized repo-relative POSIX `workspace_scope.paths`; exact files omit `/`, while directory prefixes include it. Checkpoint and plan-file save reject an existing directory missing `/` before task mutation, while missing paths remain valid. A later descendant violation may suggest the corrected prefix but never changes the plan. Never infer scope from prose, authorization, or artifacts.
- New tasks use schema 5 with minimum writer `0.5.0`. CLI `0.5.0` reads schema 2–5 but rejects schema 2–4 mutations. Historical tasks remain read-only; never migrate during context, build, or verification.
- Shape validation preserves history; writable plans require `workspace_scope`. Scaffolds are shape-only. Run profile authorizable validation before `work_basis` writes. Chat normally shows short decision highlights and the created task id; only the adjacent exception omits the id. Full plan stays in task store or `context`. Do not paste full plan JSON or dump fields by default.
- Use `source: user_request` for a complete low-risk request, `source: user_delta` for a precise low-risk addition to the current plan, and `source: user_approve` after explicit approval of the current Standard plan.
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
- Put a manual step in a non-gating diagnostic when the plan needs to preserve it as an instruction, or in a repeated schema 5 `submit --unverified-item <summary>` item while acceptance remains outstanding; diagnostic success never verifies the manual action.
- Run every named gate from the approved plan with the task's selected runner: `verify <task-id> --expect-revision <n> --name <gate-name> --json`.
- A gate passes only when its command succeeds, workspace evidence is complete, covered workspace is unchanged, and its proof binds the current work revision and generation with no unresolved violation.
- Preserve gate mutations for user inspection. Do not reset, clean, stash, or auto-approve a wider scope; scope changes return to plan and require explicit approval.
- For an in-scope correction made during `dev` or `check` after proof exists, do not use review-only `approve --feedback`; run `verify-all`. Its preflight records the live baseline as a new proof generation before running every named gate made stale by the generation change.
- `verify-all` stops on command failure, evidence error, workspace mutation, scope violation, or gate-to-gate baseline mismatch. Reuse each successful JSON revision and rerun all stale named gates on the current generation.
- Use diagnostic argv only after `--`; diagnostic results never satisfy submit gates.
- Submit only after all current named gates pass. For an approved plan without gates, use `--no-verify` with a concrete reason.
- Submit performs a live workspace and evidence-integrity preflight. A mismatch advances proof generation, rejects submit, and does not run gates automatically; `context` reports live status read-only.
- Prefer `--knowledge-impact-none <reason>` for a concrete no-impact record; use `--knowledge-impact-file <path>` for `updated` or other structured impacts. Read [knowledge and context](knowledge-and-context.md) before preparing or correcting `knowledge_impact`.
- Report non-`tracked` artifact delivery and untracked-worktree warnings as delivery risks; do not invent artifact ownership or turn them into automatic lifecycle failures.
- Submit current work to `review` and wait. For `reopen_review`, use explicitly
  authorized `reopen-review`, then `verify-all` and a new submission. Never auto-`done`.

## Finish

- Inspect open tasks and mutate only the named task.
- Before `done`, read the bounded brief and compare every current
  `submission.unverified_items` entry with the user's latest explicit review
  acceptance. Archive intent alone is not risk acceptance.
- For schema 5, pass `--closeout-file <path>` containing exactly one resolution
  for every item ID. Unknown, duplicate, or missing item IDs fail before task,
  event, or archive writes. A task with zero items may omit `--closeout-file`.
- Each schema 5 resolution has one of these exact shapes:

```json
{
  "resolutions": [
    { "item_id": "U1", "outcome": "resolved", "resolution": "Observed result" },
    { "item_id": "U2", "outcome": "accepted_risk", "user_acceptance": { "statement": "Explicit user acceptance" } },
    { "item_id": "U3", "outcome": "followup", "followup": { "action": "Concrete next action", "owner": { "kind": "external", "account_uri": "https://example.com/teams/runtime" } } }
  ]
}
```

- Core records `accepted_by: "user"` and `recorded_at` for `accepted_risk`.
  `followup.owner.account_uri` must be an absolute `mailto:` address or an
  absolute credential-free `https:` URL with a non-root path identifying a
  concrete account or team page. Role text, relative URLs, unknown protocols,
  and URLs containing credentials are invalid.
- If required acceptance, an observed result, a stable owner, or the next action
  is missing, remain in review and ask for it. Do not create follow-up tasks,
  issues, Records, or reminders automatically.
- Do not rerun an already passed, non-stale full build solely for closeout.
- Run `done` only after explicit completion/archive authorization.
- Run `abandon` only after explicit cancellation authorization.
- Never treat task-level authorization as Git authorization.
