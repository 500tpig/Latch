# Migration

Read this reference for task-schema routing, legacy task recovery, minimum writer versions, or downgrade behavior.

- Candidate CLI version `0.5.0` is the minimum writer for schema 5. New
  `checkpoint` tasks use schema 5, the standard profile by default, and the
  current canonical session actor as `primary_writer`.
- CLI `0.4.0` remains the minimum writer for schema 4. The S3 schema 4
  implementation task must stay on the absolute immutable `0.4.0` runner from
  its handoff manifest for `approve`, `checkpoint`, `verify`, `verify-all`,
  `submit`, and any separately authorized `done`.
- Candidate CLI `0.5.0` may read schema 2–5 but rejects every schema 2–4 task
  mutation with `writer_version_mismatch`. The immutable CLI `0.4.0` rejects
  schema 5 mutation. Both boundaries fail before task, event, backup, or archive
  writes.
- Do not claim, upgrade, downgrade, or otherwise migrate a schema 2–4 task with
  candidate CLI `0.5.0`. Use only an explicitly selected matching legacy runner
  and authorization. Never infer a batch migration from one task, and never
  migrate during read, startup, checkpoint recovery, build, or verification.
- Use `--authorize-request <reason>` with optional `--scope-summary` and repeated `--scope-path` for ordinary Light request authorization. Use `--authorization-file` for complex authorization, `--retrospective-file` for retrospective input, and `--knowledge-impact-file` for `updated` impact and legacy patch input.
- Keep `events_schema_version: 3`: it identifies the forward-compatible event grammar and is not a writer lock. Task schema selects the v4 or v5 event validator; schema 5 does not change this event schema number.
- Keep `task.json` as the recovery commit point. A recovery upgrade emits `writer_taken_over` and `schema_upgraded` with the same task revision; event append failure remains a warning and may leave history incomplete.
- A matching legacy runner may run `downgrade-v2` only after explicit user confirmation that schema 3/4-only fields and event details will remain only in backup. Schema 5 has no downgrade route.
- Preserve any returned `.latch/archive/v3-backup/` or `.latch/archive/v4-backup/` directory, never delete `.latch`, and report downgrade warnings or partial failure before further task writes.
