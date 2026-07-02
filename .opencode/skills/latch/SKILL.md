---
name: latch
description: Use when a coding task becomes long, risky, cross-session, or needs explicit state tracking, verification, and user-confirmed archive. Triggers include authentication, routing, permissions, storage, API contracts, data migration, unclear acceptance criteria, bug reproduction, or user requests such as "走 Latch", "记录任务", "可追溯", "收尾归档".
---

# Latch

Latch 是当前 repo 的任务状态锁存器。进入后先记录现场，再按阶段推进，最后用真实命令验证；只有用户确认后才归档。完整流程、命令清单和阶段门禁见 `docs/HANDBOOK.md`，本文只给入口。

## 真源

- 流程和命令清单：`docs/HANDBOOK.md`
- 文档分层（何时只用 Latch / 加 brief / 加 PRD）：`docs/ARTIFACTS.md`
- 何时进入 Latch（触发正文）：`AGENTS.md`
- 安装或接入新项目：`docs/AI_INSTALL.md`
- 触发语和阶段示例：`docs/SCENARIOS.md`；设计取舍：`docs/DESIGN.md`

## 先做什么

1. `git status --short`。
2. AI 续接默认入口：`latch context --json`（无参读当前 actor 的 current task）。需要看用户点名 task 时用 `latch context <task-id> --json`；多 task 时用 `latch list --json`。
3. 非 interactive shell 报 `command not found: latch` 时，先试 `zsh -ic 'latch context --json'`。不要把本机绝对路径写进项目规则或 skill。

## 硬触发（Latch 自身反馈）

`latch` 命令不可用、只能靠 shell fallback、AI 接入 Latch、记录规则漏触发，或用户指出「这应该被记录」——一旦命中，先 `latch checkpoint` 再排查，不得当成小修直接动手。其余触发（风险域、跨会话续接、规划类、用户显式要求等）见 `AGENTS.md`。

## 阶段一句话

`triage -> brainstorm? -> grill? -> plan -> dev -> check -> finish -> done`，`blocked` 可从任意阶段进入。`latch next` 只推进阶段，不替 AI 规划，也不运行验证。验证必须用 `latch verify -- <command>`。归档用 `latch done`，且只有用户明确确认后才执行；`done` 不负责 commit。
