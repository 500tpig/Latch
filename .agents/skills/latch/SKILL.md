---
name: latch
description: Use when a coding task becomes long, risky, cross-session, or needs explicit state tracking, verification, and user-confirmed archive. Triggers include authentication, routing, permissions, storage, API contracts, data migration, unclear acceptance criteria, bug reproduction, or user requests such as "走 Latch", "记录任务", "可追溯", "收尾归档".
---

# Latch

Latch 是当前 repo 的单任务状态锁存器。进入 Latch 后，先记录现场，再按阶段推进，最后用真实命令验证；只有用户确认后才归档。

详细手册见 `docs/HANDBOOK.md`。常见触发语和阶段选择见 `docs/SCENARIOS.md`。规格边界见 `docs/SPEC_V0.md`。安装或接入新项目时，先读 `docs/AI_INSTALL.md`。

## 先做什么

1. 代码工作开始前先看 `git status --short`。
2. 如果 `.latch/state.json` 有 active task，先运行：

```bash
latch resume --brief
```

如果 AI 工具的非交互 shell 报 `command not found: latch`，先试：

```bash
zsh -ic 'latch resume --brief'
```

不要把 `/Users/...` 这类本机绝对路径写进项目规则或 skill。确实在开发 Latch 本仓库且全局命令不可用时，才用 `pnpm build && node dist/cli.js ...`。

3. 如果当前任务需要进入 Latch，立刻 checkpoint：

```bash
latch checkpoint "<任务标题>" \
  --goal "<目标>" \
  --scope "<范围>" \
  --acceptance "<验收>" \
  --next "<下一步>"
```

## 什么时候进入 Latch

- Latch 自身反馈（硬触发，优先于「小请求不进入 Latch」）：`latch` 命令不可用、只能靠 shell fallback、AI 接入 Latch、记录规则漏触发，或用户指出「这应该被记录」。一旦命中，先 `latch checkpoint` 再排查，不得当成小修直接动手。
- 认证、登录、权限、路由、状态流、持久化、API 契约、数据迁移。
- 需要复现 bug、跨会话续接、方案讨论后再实现。
- 用户要求规划项目后续、完善项目、讨论路线图或先讨论怎么推进。
- 用户明确要求记录任务、可追溯、收尾归档。

小请求不进入 Latch。没进 Latch 的小修只需要留痕时，用：

```bash
latch log "<summary>" --files a.ts,b.ts
```

## 阶段流程

```text
triage -> brainstorm? -> grill? -> plan -> dev -> check -> finish -> done
blocked 可从任意阶段进入
```

`latch next` 只推进阶段，不替 AI 规划，也不运行验证。

规划类请求默认由 AI 自动 checkpoint 后进入 `brainstorm`，不要求用户手动敲命令。讨论涉及安装方式、项目规则、跨项目同步、发布、存储、API 契约、权限或迁移等难回退选择时，AI 应主动转入 `grill`。

## 验证和收尾

验证必须用：

```bash
latch verify -- <command>
```

推荐跑最小相关验证。全项目有既有失败时，不把全量失败当成小修门槛；在 finish closure 写清没验证什么。

verify 通过后：

```bash
latch next
```

进入 `finish` 后必须补 closure：写清改了什么、验证了什么、没验证什么、下次接什么。只有用户明确确认完成、收尾或归档时，才执行：

```bash
latch done
```

`git commit`、`git push` 和 `latch done` 都不属于默认后续动作。只有用户明确说「提交」「推送」或「归档」后，AI 才可执行这些命令。

`done` 不负责 commit。

## 续接提示

继续任务时，先用：

```bash
latch resume --brief
```

只处理 `Next` 指向的范围，不扩大改动。失败时只看相关报错，修完用同一类 `latch verify` 重新记录结果。
