# 低 token 状态层第一阶段：closure 结构化 + 接入方瘦身 + 触发边界

Source-Task: 202607090742-低-token-状态层第一阶段-closure-结构化-接入方瘦身-触发边界

## 背景

- Latch 现在定位是「可靠但不省」。前序对话把 token 税拆成 5 类：接入方同步规则税、归档后重复理解税、阶段机流程税、讨论误触税、启动查询税。
- 核心缺口：closure（changes/verified/unverified/followup）经 `appendNotes` 写进 `notes.md`（`src/cli.ts:336-340`），`task.json` 只存 `closure: true/false` 布尔位（`cli.ts:351`）。AI 续接 finish/done 任务时 `context --json --brief` 只知道「有 closure」不知道内容，必须读 `notes.md`（冷数据）。
- appearance-sec 实证：归档任务 `202607070942` 的 `notes.md` 留了三段 Finish closure（多次 finish 补微调），AI 续接要自己合并；`AGENTS.md` 的 Latch 段（77-103 行）抄了 26 行通用规则，上游一改接入方就同步，`log.jsonl` 11/12 是这种同步税。
- 前序对话讨论了整体方案和排期，最终确认第一阶段只做三件确定收益的事；archive search 和阶段机分档留第二阶段，触发条件定死避免永久拖延。

## 目标

- AI 续接 finish/done 任务时，`context --json --brief` 直接输出 closure 四字段，不读 `notes.md`。
- 接入方 `AGENTS.md` 不再维护 Latch 通用规则副本，只留项目边界和入口。
- 纯讨论（分析、方案评估、只读解释）不进 Latch，即使讨论对象是 Latch 本身。

## 不做什么

- 不做 archive search：第二阶段触发条件——appearance-sec 归档满 10 个，或出现 2 次「AI 改文件时不知历史 closure」的真实场景，满足任一才开 grill。
- 不做阶段机分档：第二阶段触发条件——第一阶段上线后跑满 5 个中等功能任务，统计其中几个走了完整阶段机、几个本不需要，用数据决定要不要分档。
- 不结构化讨论摘记：影响 scope/acceptance/next 的取舍回写到对应字段，摘记本身留 `notes.md` 作人读历史。
- 不做归档 + knowledge 合一：归档是历史证据，knowledge 是复用规则，两个语义不硬并。
- 不给 appearance-sec 建 `docs/briefs/`：用模块 `ARCHITECTURE.md` 当真源已够。
- 不改 `notes.md` 的 closure scaffold 格式：保留为人读副本，真源是 `task.json` 的结构化字段。

## 方案

### 1. closure 结构化进 task.json

`src/core/types.ts` 的 `Task` 加字段：

```ts
closure?: {
  changes: string
  verified: string
  unverified: string
  followup: string
  updated_at: string
}
```

- 字段 optional，老 `task.json` 不带也不报错。
- 最后一次 finish 覆盖整个 closure 对象（`updated_at` 刷新），解决多段 closure 合并问题。
- 四字段允许空字符串（用户只填部分格子时）。

### 2. finish 命令写入

`src/cli.ts` 的 finish case（323-356 行）：
- `finishClosureFields()` 不变，仍读四个 flag。
- `if (hasClosure)` 块里，在 `appendNotes` 之外，增加 `task.closure = { ...closure, updated_at: now() }`，`changed` 加 `'closure'`。
- `notes.md` 的 scaffold 保留 `appendNotes` 写入，作人读副本；真源是 `task.json`。
- `finish_saved` event 的 `closure` 字段保持 bool，避免 event 膨胀；closure 内容在 `task.json` 拿。

### 3. context --json --brief 带出 closure

`src/core/task-view.ts`：
- `taskBriefContext`（120 行）加 `closure: task.closure ?? null`。
- `taskContext`（full JSON，81 行）也加 `closure: task.closure ?? null`。
- 人读 `printResume`/`printContext`：closure 存在时打印四格摘要，让人也能从命令行看到。

### 4. 老任务兼容

- closure 是 optional，老 `task.json` 无该字段时输出 `null`，不报错。
- 不做迁移脚本：老 closure 在 `notes.md` 里，需要时 AI 兜底读 notes（符合现有「notes 兜底读」口径）。

### 5. AGENTS.md 触发边界收紧

Latch 本项目 `AGENTS.md` 的「小请求不走 Latch」段，明确加：
- 分析建议、方案评估、只读讨论不进 Latch，即使讨论对象是 Latch 本身。
- 只有结论会改规则、CLI、模板、验收，或用户要求留痕，才进 Latch。

### 6. appearance-sec 接入方瘦身

appearance-sec `AGENTS.md` 的 Latch 段（77-103 行）：
- 砍掉通用规则（触发列表、verify 限制、finish closure 写法、讨论摘记规则、记录写法细则）。
- 只保留：Latch 是什么一句、小请求不走 Latch 一句、项目专属触发边界、`latch list/context` 入口、`zsh -ic` fallback 一句、`LATCH_ACTOR` 要求。
- 通用规则靠 `.agents/skills/latch/SKILL.md` 跳转上游 `docs/`。
- 同步触发边界收紧（分析/方案评估不进 Latch）。

## 验收

- `latch finish --changes "..." --verified "..." --unverified "..." --followup "..."` 后 `task.json` 含 closure 结构化字段（四格 + `updated_at`）。
- `latch context --json --brief` 输出 closure 四字段。
- 老任务（无 closure 字段）`context --json --brief` 输出 `closure: null`，不报错。
- `pnpm test` 全绿，补测试断言 closure 字段存在且含四格。
- Latch `AGENTS.md` 含「分析/方案评估/只读讨论不进 Latch」。
- appearance-sec `AGENTS.md` Latch 段从约 26 行瘦到只剩项目边界和入口（目标 ≤12 行）。
- brief 写完并 `latch save --artifact brief:docs/briefs/2026-07-09-latch-low-token-phase1.md`。

## 风险

- **双写真源**：closure 同时写 `task.json` 和 `notes.md` scaffold。真源是 `task.json`，notes 是人读副本。要在 `HANDBOOK` 的 finish 段和 `ARTIFACTS` 的字段说明里写清，避免接手的人改了 notes 没改 `task.json`。
- **notes scaffold 与结构化字段不同步**：如果人手编 notes 的 closure 段没同步 `task.json`，AI 读 `task.json` 拿到的是旧值。缓解：`task.json` 是真源，人读 notes 只是副本，文档写清；不强制 CLI 同步 notes（保持 notes 是自由文本）。
- **多段 closure 历史**：最后一次 finish 覆盖，历史 closure 段留在 `notes.md` 作过程记录。AI 只看 `task.json` 的最新 closure，需要历史过程才读 notes。这符合「notes 是兜底读」口径。
- **未覆盖**：归档任务的 closure 检索（archive search）不做，留第二阶段。

## 第二阶段触发条件（写死，避免永久拖延）

- archive search：appearance-sec 归档满 10 个，或出现 2 次「AI 改文件时不知历史 closure」真实场景，满足任一开 grill。
- 阶段机分档：第一阶段上线后跑满 5 个中等功能任务，统计阶段机使用率后单独 grill。
