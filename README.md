# Latch

Latch is a small AI coding harness for formal coding tasks.

Small requests stay out of Latch. Formal tasks are kept as open tasks in the current project. Each actor has its own current task, and stage commands operate on that task unless `--task <id>` is provided; `<id>` can be a full task ID or a unique prefix.

```bash
latch init
latch start "Fix auth expiry redirect"
latch start "Add dashboard context"
latch list
latch use 202607010900-fix-auth-expiry
latch save --next "Add regression test"
latch next
latch verify -- pnpm test
latch finish --changes "..." --verified "pnpm test" --unverified "none" --followup "wait for user confirmation" --knowledge skip --knowledge-reason "one-off task"
latch done
```

Use `latch context [task-id] [--json]` to read a stable task summary for agents or dashboards. Use `latch abandon [--reason "..."]` to archive a task that should not continue.

See [docs/HANDBOOK.md](docs/HANDBOOK.md) for daily usage, [docs/SCENARIOS.md](docs/SCENARIOS.md) for trigger examples, [docs/DESIGN.md](docs/DESIGN.md) for design boundaries and non-goals, and [docs/ARTIFACTS.md](docs/ARTIFACTS.md) for when to write briefs or PRDs outside `.latch/`.

## Small fixes: `latch log`

For tiny changes that don't need cross-session handoff, log a single line instead of entering the full stage flow:

```bash
latch log "Switch alarm_record GraphQL time param from string to seconds Int" \
  --files src/api/network-link.ts
```

`log` only appends to `.latch/log.jsonl`. It does not create a task or touch the state machine. Open tasks may exist while `log` records an unrelated small fix.
