# Latch

Latch is a small AI coding harness for formal coding tasks.

Small requests stay out of Latch. Formal tasks are latched into stages until verification passes and the user explicitly finishes them.

```bash
latch init
latch start "Fix auth expiry redirect"
latch save --next "Add regression test"
latch next
latch verify -- pnpm test
latch done
```

Use `latch abandon [--reason "..."]` to archive a task that should not continue.

See [docs/HANDBOOK.md](docs/HANDBOOK.md) for daily usage and [docs/SPEC_V0.md](docs/SPEC_V0.md) for the v0 behavior.

## Small fixes: `latch log`

For tiny changes that don't need cross-session handoff, log a single line instead of entering the full stage flow:

```bash
latch log "Switch alarm_record GraphQL time param from string to seconds Int" \
  --files src/api/network-link.ts
```

`log` only appends to `.latch/log.jsonl`. It does not create a task or touch the state machine. If an active task exists, `log` is rejected — advance (`next`), finish (`done`), or abandon the task first, so the same work isn't tracked in two places.
