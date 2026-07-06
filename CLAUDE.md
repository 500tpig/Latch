# CLAUDE.md

@AGENTS.md

This file is the Claude Code entrypoint for this repository. `AGENTS.md` is the
source of truth for Latch triggers, workflow rules, and project-specific
guardrails. Keep this file thin so Claude Code loads the rules without a second
drifting handbook.

## Project

Latch is a TypeScript CLI harness for AI coding tasks. It records formal tasks,
stage progress, real verification, and user-confirmed archival.

Key paths:

- `src/cli.ts`: CLI entrypoint and command routing
- `src/core/`: task store, progress gates, ownership, events, views, knowledge
- `tests/`: Node.js built-in test runner files
- `docs/`: handbook, scenarios, design notes, briefs, PRD templates
- `.latch/`: runtime state, task records, archive, knowledge cards, log

## Commands

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm check
pnpm latch <args>
```

Single test after build:

```bash
node --test tests/<filename>.test.mjs
```

## Latch Entry

For any request that might enter Latch or finish an existing task:

```bash
git status --short
latch list --json --brief
```

Use `latch context --json --brief` for the current actor's task, and
`latch context <task-id> --json --brief` when the user names a task. Do not
create a new task before checking whether an open task is the same topic.

Claude Code should set a stable `LATCH_ACTOR` when multiple Claude sessions may
work in the same repo. Without `LATCH_ACTOR` or a thread id, Latch falls back to
`default`, which can make different sessions share one current task.

If `latch` is missing in Claude Code's non-interactive shell:

```bash
zsh -ic 'latch --help'
```

Do not write local absolute paths into project docs or rules.

## Planning Mode

Planning requests are not tiny chat when they affect this repo's direction.
Requests like "review recent commits and docs", "plan what to do next",
"improve this project", or "think through the roadmap" must enter or resume a
Latch task.

Think broadly in planning, then recommend the smallest next action that has
enough evidence. Small implementation does not mean narrow thinking.

Ponytail or any "minimal change" mode constrains implementation size, not the
planning search space. In planning, explore the real problem surface first:
options, risks, rollback cost, and longer-term consequences. After that, choose
the smallest useful next step.

If the user asks whether Latch should have been used, whether a task should have
been recorded, or why token use was high, treat it as Latch process feedback:
check open tasks first, continue the same task when it is the same topic, and do
not create a duplicate task.

## Evidence Discipline

For broad reviews, gather evidence in layers:

1. Start with summaries: `git log --oneline --stat`, `git show --name-only`,
   `rg --files`, document headings, and existing briefs.
2. Read only the 1-3 files or sections that decide the question.
3. Use full patches, full manuals, or wide `rg` output only when summaries are
   insufficient.

Avoid reading multiple full patches or long docs just because the user asked
for a comprehensive answer. Comprehensive means the conclusion covers the right
surface; it does not mean loading every source verbatim.

## Implementation Mode

When editing code or docs, keep diffs small and aligned with the existing
project. Do not add CLI commands, project scanners, generated rules, or new data
formats unless the evidence answers the four checks in `AGENTS.md`:

- what the evidence is
- whether this expands Latch's responsibility
- rollback cost if wrong
- whether a smaller doc/template change is enough

For pure docs or commit-only tasks without useful verification, fill task
fields and use `latch next --to finish`; write the closure with `latch finish`.

## Architecture Notes

- `task.json` is structured state for CLI and AI.
- `notes.md` is process record for humans first; AI reads it only when brief
  context is not enough.
- `events.jsonl` is append-only trace.
- Formal docs live in `docs/briefs/` or `docs/prd/`, not inside `.latch/`.
- `latch done` archives tasks only after user confirmation; it does not commit
  or push.
