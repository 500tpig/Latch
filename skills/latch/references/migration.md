# Migration

Read this reference for schema 2/3 tasks, `claim`, `upgrade-v4`, legacy patching, minimum writer versions, or `downgrade-v2`.

- Treat CLI version `0.4.0` as the minimum writer for schema 4. Schema 4 task roots require `min_writer_version: "0.4.0"`; CLI 0.2.0 and 0.3.0 reject the unsupported task schema before mutation.
- Expect new `checkpoint` tasks to use schema 4, the standard profile by default, and the current canonical session actor as `primary_writer`.
- Treat schema 3 as read-only. Continue a named open schema 3 task only after explicit authorization, then prefer `latch upgrade-v4 --task <task-id> --expect-revision <n> --json` as its current primary writer. If that writer is permanently unavailable, require explicit recovery authorization for the named task and revision before a new canonical session runs the same command with `--recover-writer --reason <text>`. Recovery also transfers `primary_writer`, records `writer_taken_over`, and preserves plan/work revisions, approval, proof generation, verification, evidence refs, and provenance.
- Treat an open schema 2 task as `legacy_unclaimed` and keep it read-only until the user explicitly continues that specific task; then run `latch claim <task-id> --expect-revision <n> --reason <text> --json`. Claim explicitly upgrades 2→4 and never infers `workspace_scope`.
- Never infer a batch claim or upgrade from one continued task, and never upgrade during read, startup, checkpoint recovery, build, or verification.
- Use `--authorize-request <reason>` with optional `--scope-summary` and repeated `--scope-path` for ordinary Light request authorization. Use `--authorization-file` for complex authorization, `--retrospective-file` for retrospective input, and `--knowledge-impact-file` for `updated` impact and legacy patch input.
- Keep `events_schema_version: 3`: it identifies the forward-compatible event grammar and is not a writer lock. `schema_upgraded` records 3→4; task schema 4 is the hard writer boundary.
- Keep `task.json` as the recovery commit point. A recovery upgrade emits `writer_taken_over` and `schema_upgraded` with the same task revision; event append failure remains a warning and may leave history incomplete.
- Run `latch downgrade-v2 --task <id> --expect-revision <n> --confirm-data-loss --json` only after explicit user confirmation that schema 3/4-only fields and event details will remain only in backup. The schema 2 main projection strips `min_writer_version`, `workspace_scope`, `workspace_proof`, proof generation, violations, evidence refs, and proof-only events.
- Preserve the returned `.latch/archive/v3-backup/` or `.latch/archive/v4-backup/` directory, never delete `.latch`, and report downgrade warnings or partial failure before further task writes.
