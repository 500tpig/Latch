# Groups

Read this reference before reading or changing `group_id`, listing group members, or reasoning about sibling task independence.

- Use `group_id` only as an optional exact-match label when the user identifies a related wave or batch; do not infer a group from overlapping paths.
- Keep every member as an independent task with its own writer, authorization, verification, review, and archive decision.
- Never let a blocked or archived sibling block another member, and never treat continuing one task as group-wide claim or takeover authority.
- Use `list --group <id>` for open members, add `--include-archive` only when history is required, and treat context sibling summaries as read-only hints.
- Create or mutate `group_id` only on schema 3 tasks; claim a legacy schema 2 task before changing it.
