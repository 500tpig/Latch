# Schema routing

Read this reference for task-schema routing, minimum writer versions, and historical task boundaries.

- CLI `0.5.0` is the current runner and the minimum writer for schema 5. New
  `checkpoint` tasks use schema 5, default to the Standard profile, and bind the
  current canonical session actor as `primary_writer`.
- CLI `0.5.0` may read schema 2–5. It rejects every schema 2–4 task mutation with
  `writer_version_mismatch` before task, event, evidence, backup, or archive
  writes.
- Schema 2–4 are historical read-only formats. The current workflow does not
  expose claim, upgrade, downgrade, dual-write, or string-to-resolution migration
  routes for them.
- Do not infer task migration from startup, recovery, build, verification, or a
  request concerning another task. Do not rewrite or delete historical archives.
- `--authorize-request <reason>` creates an ordinary Light request from the plan's
  `workspace_scope.paths`; the current command surface has no separate scope
  summary or scope path inputs. Use `--authorization-file` for complex
  authorization and `--retrospective-file` for retrospective input.
- Schema 5 submit uses repeated `--unverified-item <summary>` values. Structured
  closeout uses `--closeout-file`; free-text closeout is not a current route.
- Keep `events_schema_version: 3`. It identifies the forward-compatible event
  grammar and is not a writer lock. Task schema selects the historical or schema 5
  event validator.
- Keep `task.json` as the recovery commit point. Event append failure remains a
  warning and may leave history incomplete, but does not roll back the committed
  task state.
- Preserve `.latch`, task evidence, and archive data. Any future migration or
  destructive cleanup requires a separate product contract and explicit user
  authorization.
