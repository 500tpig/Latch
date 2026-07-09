---
name: latch
description: Use when a coding task becomes long, risky, cross-session, or needs explicit state tracking, verification, and user-confirmed archive. Triggers include authentication, routing, permissions, storage, API contracts, data migration, unclear acceptance criteria, bug reproduction, or user requests such as "走 Latch", "记录任务", "可追溯", "收尾归档".
---

# Latch

Latch 是当前 repo 的任务状态锁存器。进入后先记录现场，再按阶段推进，最后用真实命令验证；只有用户确认后才归档。

完整流程见 `docs/HANDBOOK.md`，触发和阶段选择见 `docs/SCENARIOS.md`，安装接入见 `docs/AI_INSTALL.md`，产物规则见 `docs/ARTIFACTS.md`，设计边界见 `docs/DESIGN.md`。

## 先做什么

1. 代码工作开始前先运行 `git status --short`。
2. 准备进入 Latch 或收尾时，先运行 `latch list --json --brief` 看 open task，避免同题重复记录或漏掉别的 `finish` task。
3. 续接当前任务用 `latch context --json --brief`；需要完整字段时再用 `latch context --json`。
4. 非 interactive shell 报 `command not found: latch` 时，先试 `zsh -ic 'latch --help'`。不要把本机绝对路径写进项目规则或 skill。
5. 多 agent 并行时，显式设置稳定的 `LATCH_ACTOR`。推荐格式：`<tool>:<agent>:<session>`，至少包含 `<tool>:<session>`；不要只依赖默认线程 ID，也不要让多个 AI 共用 `default`。

## 什么时候进入 Latch

项目里的完整触发规则以 `AGENTS.md` 为准。硬触发是 Latch 流程反馈：AI 接入 Latch、记录规则漏触发，或用户指出「这应该被记录」。一旦命中，先查 open task；有同题任务就续接，确实没有才 `latch checkpoint`。

小请求不进入 Latch；没有进入 Latch 但需要留痕时，用 `latch log`。

## 阶段和验证

```text
triage -> brainstorm? -> grill? -> plan -> dev -> check -> finish -> done
blocked 可从任意阶段进入
```

`latch next` 只推进阶段，不替 AI 规划，也不运行验证。规划、复盘、路线讨论默认先完整探索问题面，再给最小可执行下一步。

验证必须用：

```bash
latch verify -- <command>
```

`verify` 不经过 shell，`&&`、管道、glob 和 `$VAR` 展开需要拆成多次验证。默认 verify 是收尾门禁；只记录诊断性全量检查时用 `latch verify --diagnostic -- <command>`，不覆盖门禁验证。

验证通过后优先补 closure：

```bash
latch finish --changes "..." --verified "..." --unverified "..." --followup "..."
```

只有用户明确确认完成、收尾或归档时，才执行 `latch done`。`done` 不负责 commit。
