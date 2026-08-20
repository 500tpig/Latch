# Latch 观察期

本页定义 Latch 在真实使用中的只读观察规则。观察使用**其它项目正常开发产生的归档
task**，不为统计专门制造任务，也不维护第二份实时台账。

当前并列两段：

- **v2 观察期**：最终 current 契约发布后的 S8 规则；评估结论见
  [观察期评估](briefs/2026-07-27-latch-v2-observation-evaluation.md)。
- **Schema 5 观察期**：schema 5 成为 current writer 后的新窗口；**尚未**形成固定 10
  张样本评估结论。

两段互不覆盖。进度检查与评估只读用户明确指定 repo 的 archive，不读取聊天、其它
AI 会话或未授权 repo。

---

# Latch v2 观察期

本段定义最终 current 契约发布后的 S8 观察规则。观察期使用其他项目正常开发产生的归档
task，不为统计专门制造任务，也不维护第二份实时台账。

## 起点

发布来源 task：

```text
20260716023329226-发布-c7-c8-最终契约全面-current-209f47
```

该 task 的 `closure.accepted_at` `2026-07-16T06:51:47.388Z` 是观察起点。只有在该时间之后
完成的 task 才能成为候选样本。观察期结束前继续保留 v1 备份。

## 正常使用

- 在其他项目按真实需求开发，不改变原有工作安排；
- 普通写入不单独建 task；命中 enable 条件后再按 A/B/C 判定：范围明确且低风险时走 Light，信息不足时停在 grill，高风险或需要方案确认时走 Standard；
- 纯问答、只读探索不建 task；明确要求「不用 Latch」时，仅在无已知 continuation 或 closeout 责任时按请求执行；
- task 按 `plan`、`dev`、`check`、`review` 和 `done` 的正常流程执行；
- 每张 task 的 `.latch/archive` 是原始记录，完成后不回到 Latch repo 手工登记。

## 样本规则

以下工作可以纳入：

- 功能开发；
- bug 修复；
- 有明确目标和验收条件的重构；
- 运维、迁移或配置工作；
- 有实际交付物的技术文档工作。

以下 task 不纳入：

- Latch 安装和接入迁移；
- smoke 或一次性命令试验；
- 单纯记录状态；
- 对同一改动的重复核验；
- outcome 为 `abandoned` 的 task；
- 在观察起点之前完成的 task。

## 证据来源

进度检查和最终评估只读取明确指定 repo 中的：

```text
.latch/archive/**/task.json
.latch/archive/**/events.jsonl
```

不读取 Codex 会话、聊天归档或跨会话材料。Latch-Board 可以用于发现已配置的
数据源，最终判断仍以各 repo 的归档文件为准。

`revision conflict` 通常发生在写命令失败时，未必写入 task 事件。因此只在
`task.json`、`events.jsonl`、submission 或 closure 明确记录时计数；没有记录时
标为「未知」，不能按 0 次处理。

## 检查进度

观察期不会在后台自动监控。可以在任何时间发起进度检查，不必等到估计已有
10 张 task。推荐请求格式：

```text
检查 Latch v2 观察期进度。

候选 repo：
<repo-a>
<repo-b>
<repo-c>
```

如果候选项目已经全部配置到 Latch-Board，也可以明确使用其数据源列表：

```text
检查 Latch-Board 已配置数据源中的观察期进度。
```

检查时先读取本页记录的 C7+C8 发布起点，再读取指定 repo 的归档。
结果应列出合格数量、排除项及原因。进度检查只读数据，不创建评估 task。

## 选取样本

最终评估按以下顺序选取样本：

1. 由用户明确给出候选 repo，或明确授权使用 Latch-Board 的数据源列表；
2. 读取观察起点之后 outcome 为 `done` 的归档 task；
3. 按样本规则排除不合格 task；
4. 按 `closure.accepted_at` 从早到晚排序；
5. 取最早的 10 张作为固定样本。

候选数量不足 10 张时只报告当前进度，不提前形成结论。

## 观察字段

| 字段 | 主要证据 | 判断内容 |
|---|---|---|
| Plan 变化 | `plan_revision`、`plan_updated` | 实施前后是否频繁返回 plan |
| Review 返工 | `review_feedback`、`work_revision` | review correction 的次数和原因 |
| Gate 问题 | `verification_run` | 失败 gate、重复验证和最终状态 |
| Blocked | `blocked`、`unblocked` | 等待对象、持续时间和是否影响 phase 理解 |
| Revision conflict | 明确记录的错误说明 | 是否出现；没有证据时记为「未知」 |
| 未验证范围 | submission、closure | 是否反复遗漏相同验证 |
| 最终结果 | outcome、follow-up | task 是否完成，以及是否产生后续工作 |

## 结束条件

完成 10 张固定样本后，新建「评估 Latch v2 观察期结果」task。该 task 只做
统计和判断，不直接修改 CLI、Board 或提示词。评估完成并获得单独授权后，
再决定是否删除 v1 备份或创建具体改进 task。

---

# Schema 5 观察期

本段定义 schema 5 作为 **current writer**（`min_writer_version: "0.5.0"`）之后的真实使用
观察协议。方法继承 v2：真实业务归档、不为统计造 task、无后台监控、无第二份实时台账。

协议 Source-Task：

```text
20260804082952710-定义-schema-5-真实使用观察协议-87f04f
```

Agent 使用体验、聊天随笔或 Board UI 观感**不计入** 10 张定量样本；此类材料如需保留，
应另做 Record 或 brief，并单独授权。

## 起点

可操作观察窗口起点（main 上 schema 5 candidate 合并完成）：

```text
锚 task：20260804032944615-s1-合并-schema-5-candidate-到-main-6f822f
closure.accepted_at：2026-08-04T03:42:02.974Z
```

只有 `closure.accepted_at` **严格晚于**该时间戳的归档 task 才能成为候选。

产品发布身份仍可引用 INDEX 中的 Current-Release-Task
`20260803033739558-s5-schema-5-current-release-836ec7`；本观察窗口以本仓可核验的
合并归档时间为准。若日后在授权 archive 中取得更合适的发布 `accepted_at`，须通过
**单独文档修订授权** 更新起点，不得在进度检查中静默改写。

## 正常使用

与 v2 相同：

- 在授权项目中按真实需求开发，不改变原有工作安排；
- 命中 enable 条件后再按 A/B/C 判定 Light / grill / Standard；纯问答、只读不建 task；明确「不用 Latch」仅在无已知 continuation 或 closeout 责任时按请求执行；
- 生命周期仍为 `plan` → `dev` → `check` → `review` → 归档；
- 原始记录留在各 repo 的 `.latch/archive`，不回到 Latch repo 手工登记台账。

新 task 应为 schema 5（`task.schema_version: 5`，`min_writer_version: "0.5.0"`）。
schema 2–4 仅 historical read-only，**不计入** schema 5 主样本（需要时可另列对照表）。

## 样本规则

### 可纳入

- 功能开发、bug 修复、有明确验收的重构；
- 运维、迁移或配置工作；
- 有实际交付物的技术文档工作；
- 在用户**明确列入**候选列表的 repo 中产生的上述工作（含 Latch 本仓工程，仍须通过排除规则）。

### 不纳入

- Latch 安装、全局 CLI/Skill 链接、接入迁移；
- adopter **rollout**、reader 契约试做、仅为验证安装的 task；
- smoke 或一次性命令试验；
- 单纯记录状态、无交付意图的备忘；
- 对同一改动的重复核验；
- outcome 为 `abandoned` 的 task；
- 观察起点当时或之前完成的 task；
- `task.schema_version` 不是 5 的 task；
- 本观察协议起草/修订 task 自身，以及任何**为凑样本而创建**的 task。

## 证据来源

进度检查和最终评估**只**读取用户当次明确指定的 repo（或用户明确授权的
Latch-Board 数据源列表所对应的根路径）中的：

```text
.latch/archive/**/task.json
.latch/archive/**/events.jsonl
```

可选补充（仅当用户当次授权，且用于字段「未采集」之外的补全）：

```text
latch context <task-id> --json
```

用于读取 `schema5_view.reviewer_next_action` 等投影。不得把 Context 投影写成
archive 中不存在的 lifecycle 事实。

禁止：

- 读取聊天、Codex/Grok 会话或其它对话归档作为定量证据；
- 扫描未在当次请求中授权的 repo；
- 建立后台监控、定时巡检、跨 repo knowledge store 或第二份实时台账；
- 为统计制造 task。

无事件落盘的失败（例如部分 revision conflict）在
`task.json` / `events.jsonl` / submission / closure 均无记录时记为 **「未知」**，
不得记为 0 次。

## 检查进度

不会自动监控。用户可随时发起只读进度检查，不必等到 10 张。推荐格式：

```text
检查 Latch schema 5 观察期进度。

候选 repo：
<repo-a>
<repo-b>
```

或：

```text
检查 Latch-Board 已配置数据源中的 schema 5 观察期进度。
```

（仅当用户明确授权使用 Board 数据源列表时。）

检查步骤：

1. 读取本页 Schema 5 起点时间戳；
2. 只读各授权 repo 的 archive；
3. 过滤 `outcome: done` 且 `schema_version: 5` 且 `accepted_at` 晚于起点；
4. 按样本规则排除并注明原因；
5. 报告合格数量、排除项；**不足 10 张时只报进度，不形成评估结论**。

进度检查**不创建**评估 task，不修改任何 `.latch` 或产品代码。

## 选取样本

最终评估按以下顺序固定样本：

1. 用户明确给出候选 repo，或明确授权 Board 数据源列表；
2. 读取起点之后 `outcome: done` 且 `schema_version: 5` 的归档；
3. 按样本规则排除不合格项；
4. 按 `closure.accepted_at` 从早到晚排序；
5. 取**最早的 10 张**作为固定主样本。

候选不足 10 张：只报告进度，不提前写评估结论，不放宽排除规则凑数。

## 观察字段

| 字段 | 主要证据 | 判断内容 |
|---|---|---|
| Profile 分布 | `profile`（`light` / `standard`） | Light 与 Standard 使用比例与是否误用 |
| Plan 返工 | `plan_revision`、`plan_updated` 等事件 | 实施前后是否频繁回到 plan |
| Review 与工作版本 | `review_feedback`、`work_revision` | review correction 次数、是否推动新 work revision |
| Takeover / writer | `takeover` 事件、writer 相关字段或明确错误记录 | takeover 是否发生；writer mismatch 是否出现及如何解决 |
| Gate 与证明 | `verification`、`verification_run`、proof generation 相关事件或字段 | fail、stale、重复验证、proof generation 推进 |
| Workspace violation | 明确记录的 workspace / mutation / baseline 违规 | 是否触发、是否阻断、如何解除 |
| 未验证项 | `submission.unverified_items`、`closure.unverified_items` | 数量、是否反复同类遗漏 |
| Closeout 决议 | `closure.resolutions` 的 `resolved` / `accepted_risk` / `followup` | 三种 outcome 分布与 follow-up 质量 |
| Reviewer next action | 只读 `context` 的 `schema5_view.reviewer_next_action`（若当次授权） | Board/adopter 是否用得上；无 Context 则标「未采集」 |
| 最终结果 | `outcome`、follow-up 决议 | 是否 `done`，是否留下 follow-up |

字符串 closeout 仅出现在 historical schema 3/4 对照中，不作为 schema 5 主样本字段。

## 结束条件

合格固定样本满 10 张后，**新建**「评估 Latch schema 5 观察期结果」task。该 task 只做
统计与判断，不直接修改 CLI、Core、Board、Skill 或提示词。任何产品改动须在评估后
**单独授权** 新 task。

v2 观察评估结论保持有效，不因 schema 5 观察开始而作废。
