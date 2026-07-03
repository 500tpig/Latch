---
name: latch
description: Use when a coding task becomes long, risky, cross-session, or needs explicit state tracking, verification, and user-confirmed archive. Triggers include authentication, routing, permissions, storage, API contracts, data migration, unclear acceptance criteria, bug reproduction, or user requests such as "走 Latch", "记录任务", "可追溯", "收尾归档".
---

# Latch

Latch 是当前 repo 的任务状态锁存器。进入后先记录现场，再按阶段推进，最后用真实命令验证；只有用户确认后才归档。完整流程、命令清单和阶段门禁见 `docs/HANDBOOK.md`，本文只给入口。

## 真源

- 流程和命令清单：`docs/HANDBOOK.md`
- 文档分层（何时只留 Latch 记录 / 加 brief / 加 PRD）：`docs/ARTIFACTS.md`
- 何时进入 Latch（触发正文）：`AGENTS.md`
- 安装或接入新项目：`docs/AI_INSTALL.md`
- 触发语和阶段示例：`docs/SCENARIOS.md`；设计取舍：`docs/DESIGN.md`

## 先做什么

1. `git status --short`。
2. 准备进入 Latch 或收尾时，先 `latch list --json --brief` 看 open task，避免同题重复记录或漏掉别的 `finish` task；如果这条命令报 `command not found`，先按第 4 步恢复命令可用。
3. AI 续接默认入口：`latch context --json --brief`（无参读当前 actor 的 current task）。需要看用户点名 task 时用 `latch context <task-id> --json --brief`；多 task 时用 `latch list --json --brief`。需要完整字段时再用不带 `--brief` 的 JSON。
4. 非 interactive shell 报 `command not found: latch` 时，先试 `zsh -ic 'latch --help'`。不要把本机绝对路径写进项目规则或 skill。

## 硬触发（Latch 流程反馈）

AI 接入 Latch、记录规则漏触发，或用户指出「这应该被记录」——一旦命中，先用 `latch list --json --brief` 查同题 open task；能续接就续接，确实没有才 `latch checkpoint`。不得当成小修直接动手。其余触发（风险域、跨会话续接、规划类、用户显式要求等）见 `AGENTS.md`。

## 阶段一句话

`triage -> brainstorm? -> grill? -> plan -> dev -> check -> finish -> done`，`blocked` 可从任意阶段进入。`latch next` 只推进阶段，不替 AI 规划，也不运行验证。验证必须用 `latch verify -- <command>`；验证通过后优先用 `latch finish --changes "..." --verified "..." --unverified "..." --followup "..."` 补 closure 并进入 `finish`，knowledge 默认 skip，需要沉淀规则时显式 `--knowledge generate`。归档前先 `latch list --json --brief` 看全局 open task；`latch done` 只有用户明确确认后才执行，且不负责 commit。
