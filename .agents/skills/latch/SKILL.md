---
name: latch
description: Use when a coding task becomes long, risky, cross-session, or needs explicit state tracking, verification, and user-confirmed archive. Triggers include authentication, routing, permissions, storage, API contracts, data migration, unclear acceptance criteria, bug reproduction, or user requests such as "走 Latch", "记录任务", "可追溯", "收尾归档".
---

# Latch

Latch 是当前 repo 的单任务状态锁存器。进入 Latch 后，先记录现场，再按阶段推进，最后用真实命令验证；只有用户确认后才归档。

详细手册见 `docs/HANDBOOK.md`。规格边界见 `docs/SPEC_V0.md`。安装或接入新项目时，先读 `docs/AI_INSTALL.md`。

## 先做什么

1. 代码工作开始前先看 `git status --short`。
2. 如果 `.latch/state.json` 有 active task，先运行：

```bash
latch resume --brief
```

3. 如果当前任务需要进入 Latch，立刻 checkpoint：

```bash
latch checkpoint "<任务标题>" \
  --goal "<目标>" \
  --scope "<范围>" \
  --acceptance "<验收>" \
  --next "<下一步>"
```

## 什么时候进入 Latch

- 认证、登录、权限、路由、状态流、持久化、API 契约、数据迁移。
- 需要复现 bug、跨会话续接、方案讨论后再实现。
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

进入 `finish` 后补 closure。只有用户明确确认完成、收尾或归档时，才执行：

```bash
latch done
```

`done` 不负责 commit。

## 续接提示

继续任务时，先用：

```bash
latch resume --brief
```

只处理 `Next` 指向的范围，不扩大改动。失败时只看相关报错，修完用同一类 `latch verify` 重新记录结果。
