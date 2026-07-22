# Knowledge and context

Read this reference for knowledge freshness, `knowledge_impact`, Context packs, orientation budgets, or context benchmarks.

## Knowledge freshness

- Use `knowledge fingerprint --path <path>` to calculate `sha256-v1`, and use `knowledge check --path <path>` to read freshness without modifying the document.
- Use `knowledge check --task <id>` only for a submitted `knowledge_impact.updated`; it reports referenced artifacts and does not authorize or complete the task.
- Treat `stale`, `baseline_missing`, and `error` as review-needed evidence, never as current source facts.
- Update `last_fingerprint` and provenance only as part of an explicitly authorized knowledge document edit; reading, context generation, submit, and done never update the baseline.
- Keep freshness outside submit, done, group, and archive gates; preserve existing Light proof rules.
- Prepare schema 3 submission knowledge impact through `--knowledge-impact-file`. Use `none` only with a concrete reason, and use `updated` only for actual referenced knowledge artifacts.
- In review, reuse `patch-submission-knowledge-impact` to backfill a missing impact or correct an existing one. Corrections require a concrete `--reason` and are only appropriate when implementation, configuration, generated inputs, gate objects, and public behavior are unchanged; otherwise use implementation feedback and create a new work revision.

## Context packs

- Use `context pack --input-file <path>` only when a bounded orientation pack materially reduces repeated reading; do not create a pack for ordinary small reads.
- Select task, knowledge, map, excerpt, and expand sources in the request file; Core validates, reads, orders, labels, and truncates them but does not choose sources semantically.
- Reuse the returned orientation ID and counters only for the same user intent and task. Drop them when implementation starts, evidence becomes sufficient, the task changes, or user intent changes.
- Treat the 24000 pack limit, 8000 expand batch limit, and 48000 orientation expand limit as code-point budgets for the pack helper, not limits on the whole conversation.
- Never present stale, baseline-missing, errored, or retired knowledge as fresh; use the pack freshness label and expand into source files when current evidence is required.
- Use `benchmark context` for reproducible diagnostics from supplied case/run files; it does not execute search tools and never becomes a lifecycle gate.
