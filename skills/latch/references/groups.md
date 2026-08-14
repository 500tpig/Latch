# Groups

Read this reference before reading or changing `group_id`, listing group members, or reasoning about sibling task independence.

- Use `group_id` only as an optional exact-match label when the user identifies a related wave or batch; do not infer a group from overlapping paths.
- Keep every member as an independent task with its own writer, authorization, verification, review, and archive decision.
- Never let a blocked or archived sibling block another member, and never treat continuing one task as group-wide claim or takeover authority.
- Use `list --group <id>` for open members, add `--include-archive` only when history is required, and treat context sibling summaries as read-only hints.
- For cross-session planning recovery, require the exact user-supplied group ID; do not infer the current wave by scanning nearby archives or overlapping paths.
- Do not create a planning or anchor task solely to preserve chat continuity; use a group only for a real related wave identified by the user.
- Start with `list --group <id> --include-archive --json --brief`, then read `context <task-id> --json --status` only for relevant open members. Do not expand every member into a full context.
- Group membership does not encode task order. Report explicit task state and `closure.followup`; do not generate an automatic group-level next task.
- Create or mutate `group_id` only on writable schema 5 tasks. Schema 2–4 tasks remain historical read-only; do not claim, upgrade, or downgrade them to change group membership.
