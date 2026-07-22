# Migration

Read this reference for schema 2 tasks, `claim`, legacy patching, minimum writer versions, or `downgrade-v2`.

- Treat CLI version `0.2.0` as the minimum writer for schema 3 task data and v3-only events.
- Expect new `checkpoint` tasks to use schema 3, the standard profile by default, and the current canonical session actor as `primary_writer`.
- Treat an open schema 2 task as `legacy_unclaimed` and keep it read-only until the user explicitly continues that specific task; then run `latch claim <task-id> --expect-revision <n> --reason <text> --json`.
- Never infer a batch claim from one continued task, and never use ordinary writes to upgrade schema 2 data.
- Use `--authorize-request <reason>` with optional `--scope-summary` and repeated `--scope-path` for ordinary Light request authorization. Use `--authorization-file` for complex authorization, `--retrospective-file` for retrospective input, and `--knowledge-impact-file` for `updated` impact and legacy patch input.
- Run `latch downgrade-v2 --task <id> --expect-revision <n> --confirm-data-loss --json` only after explicit user confirmation that v3-only fields and event details will remain only in backup.
- Preserve the returned `.latch/archive/v3-backup/` directory, never delete `.latch`, and report downgrade warnings or partial failure before further task writes.
