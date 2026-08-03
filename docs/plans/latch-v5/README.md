# Latch 工作流改进计划与对话交接

Source-Task: `20260803021354850-冻结-s4-schema-5-event-view-candidate-规划-2eae7e`

Source-Task-Plan-Revision: `2`

Source-Brief: `docs/briefs/2026-07-31-latch-v5-workflow-contract.md`

Source-Baseline: `35e6ff0f3fedc4753c04d8a599075c1d0621f411`

Plan-Revision: `8`

Document-Status: `candidate-planning`

## 用途

本目录记录 Latch 工作流改进的当前基线、已交付切片、已冻结 candidate 和剩余
candidate backlog。完整背景、产品边界和候选项关系见 Source Brief。

这些文件不构成 implementation authorization。S4 只在本次规划中冻结为正式 candidate；
后续实现、发布、外部 adopter、全局安装或 Git delivery 都需要独立授权。

## 当前状态

| 类型 | 项目 | 文件 | 状态 |
|---|---|---|---|
| 已完成基线 | S1 未初始化停止边界 | `01-not-initialized-boundary.json` | 已完成、验收并通过 commit `d83fe11` 交付 |
| 已交付试点 | S2 schema 4 Light plan authoring | `02-light-plan-authoring-pilot.json` | 已由 commit `0a14c714753a106a89a94e6d0af464a15024cc2e` 交付 |
| 已交付 candidate | S3 schema 5 结构化 closeout | `03-structured-closeout-candidate.json` | 已由 candidate delivery commit `f08f66999799dda713fe43c50a5b4b08958e15dd` 交付；尚未进入 current release |
| 已冻结 candidate | S4 schema 5 event/view 丰富展示 | `04-schema5-event-view-candidate.json` | candidate plan 已冻结；尚未授权实施 |
| 历史指针 | 旧 S3 closeout candidate | `backlog/03-schema5-structured-closeout.json` | superseded |
| 历史指针 | 旧 S4 event/view backlog | `backlog/04-schema5-event-view.json` | superseded |
| 暂停候选 | schema 5 current 文档、安装和 adopter rollout | `backlog/05-schema5-current-release.json` | candidate backlog |

S1 不再进入规划、批准或实施流程。`01-not-initialized-boundary.json` 仅保留为设计和
实施范围的追溯 artifact。

S2 已交付，但只覆盖 schema 4 Light authoring 简化。S2 不负责 schema 5、CLI/package
`0.5.0`、旧 schema 拒写、单一 scope 真源、结构化 closeout 或 event/view。CLI/package
`0.5.0` 来自 S3 candidate delivery commit
`f08f66999799dda713fe43c50a5b4b08958e15dd`。

S3 已交付为 candidate，包含 schema 5 structured closeout、event validator、最低
Context 和 `tests/fixtures/context-v5-candidate.json`。当前 `main` 仍可能停留在
`0.4.0`，S3 candidate delivery 不等同于 current release。

## S4 candidate 边界

S4 的正式 candidate plan 是
[`04-schema5-event-view-candidate.json`](04-schema5-event-view-candidate.json)。它只
基于 S3 已交付的 schema 5 current state 和 event 计数做 richer view：

- 增加 bounded item、resolution 摘要、确定性 timeline 标题、影响和 next action；
- 新增独立 reader contract fixture `tests/fixtures/context-v5-board-reader.json`；
- 保持 S3 的 event payload、event validator、closeout 规则和最低
  `tests/fixtures/context-v5-candidate.json` 不变；
- 不实现 Board UI、不修改外部 repo、不更新 package/current 文档、不执行全局安装。

真实六字段 Light authoring 样本尚未得到使用观察。该事实已记录为后续观察限制，不阻断
S4 event/view 展示，也不得在后续规划或验收中被写成已验证证据。

## S2 试点边界

S2 只降低 Light plan 的填写成本：

- Light template 只展示 `goal`、`workspace_scope`、`scope`、`acceptance`、
  `approach` 和 `verification_plan`；
- 缺失的 assumptions、user flow、out-of-scope 和 open questions 在创建 task 前
  确定性补为空数组；
- 落盘 task 继续使用完整 schema 4 plan shape；
- Standard plan、CLI `0.4.0`、minimum writer、scope 参数、work basis、proof、
  submission 和 closeout 保持不变。

S2 不包含 schema 5、CLI/package `0.5.0`、旧 schema 拒写、单一 scope 真源、结构化
closeout 或 event/view。旧 `backlog/02-schema5-plan-authoring.json` 已改为历史指针，
不得再作为 S2 或 S4 的实施输入。

## S3 candidate 边界

S3 candidate 从 source baseline
`35e6ff0f3fedc4753c04d8a599075c1d0621f411` 启动，采用隔离 worktree 和仓库外
immutable CLI `0.4.0` runner。S3 自身的 schema 4 task 只由 immutable runner 管理；
schema 5 临时 task 只由 candidate `0.5.0` repo-local CLI 管理。

S3 delivery commit `f08f66999799dda713fe43c50a5b4b08958e15dd` 是 S4 的实现输入：
它新增 schema 5 structured closeout、event validator、最低 Context、package/CLI
`0.5.0` 和 `tests/fixtures/context-v5-candidate.json`。S4 不得改写这组最低契约。

candidate 同时冻结以下契约：

- 最小 lifecycle、Context 投影和 schema 5 event validator；
- `accepted_risk` 的明确用户接受事实；
- 带绝对 `https:` 或 `mailto:` `account_uri` 的 external owner；
- immutable `0.4.0` 拒写 schema 5，candidate `0.5.0` 拒写 S3 schema 4 task；
- 准备阶段绑定 candidate path、SHA-256、delivery commit、Source-Task 和 Plan Revision 3，
  返回完整 handoff manifest 后停止；
- immutable runner 的核心文件 hash 必须匹配可信 source baseline clean build 或预先
  记录的主仓库 CLI `0.4.0` 基准 hash；
- Standard plan 完整内容写入 plan file 和 task store，聊天默认只返回决策重点、task ID
  与 Board/CLI 入口。

S3 使用 `tests/fixtures/context-v5-candidate.json` 固定最小 lifecycle 和 view。丰富
timeline 及独立的 Board/external-reader contract fixture 属于 S4；current 文档、安装
和发布属于 S5。

## S4 推荐交接流程

1. 主规划对话冻结 S4 plan 文件；
2. 用户完成规划 artifact 的 review acceptance 和 Git delivery，并记录 commit；
3. 新实现对话读取 S4 plan、S3 delivery commit 和实时 workspace 状态；
4. 新实现对话使用 S3 candidate 的 repo-local CLI `0.5.0` 创建自己的 Standard task，
   成为 `primary_writer`；
5. 新实现对话返回 Standard plan 的决策重点和 task ID，完整 plan 由 Latch-Board 或
   `latch context` 提供，并等待明确批准；
6. 批准后只实施 S4、执行全部 named gate，并 submit 到 review；
7. 新实现对话返回 task ID、revision 和未验证事项后停止；
8. 主规划对话只读复核 implementation task，并等待用户决定是否验收。

主规划对话不预建 implementation task，不要求实现对话读取旧聊天或 Record。

## 新切片：两步启动

S4 尚未批准实施时，先发送：

```text
仓库：<repo-path>

读取 docs/plans/latch-v5/04-schema5-event-view-candidate.json，并核对 S3 delivery commit f08f66999799dda713fe43c50a5b4b08958e15dd。按 canonical Latch Skill 创建新的 Standard task，返回绑定精确 revision 的决策重点与 task ID；完整计划保存在 task store。不要 approve、不要实施、不要操作 Git，等待确认。
```

task 创建后发送：

```text
批准 <task-id> Revision <revision> 的当前完整计划。按计划只实施 S4、执行全部 named gates，并 submit 到 review 后停止。不要实施 S5、不要创建额外 implementation task、不要操作 Git。
```

## review 回传

实现对话只需返回：

```text
TASK=<task-id>
REV=<revision>
UNVERIFIED=<内容或 none>
```

主规划对话的复核输入：

```text
复核 TASK=<task-id> REV=<revision>
```

主规划对话从 task artifact 读取 changes、gate、submission 和 worktree 状态，不要求
复制实现聊天、完整命令输出或 diff。

## 继续同一 open task

默认不使用 takeover。确需更换 writer 时，handoff 必须包含精确 task ID、revision、
plan revision、旧 writer、未完成事项和 worktree 状态，并明确说明旧会话已停止写入。

takeover 只转移 writer，不构成 plan approval 或 implementation authorization。

## 停止条件

实现对话遇到以下情况时返回主规划对话：

- plan 文件与指定规划基线不一致；
- 未在 S3 delivery commit 的正确基线上实施，或无法核对 `0.5.0` repo-local CLI；
- workspace scope 需要扩大；
- 需要改变 event payload、event validator、closeout 规则、S3 最低 fixture 或 Board UI；
- 需要改变 package version、current 文档、canonical Skill、安装或外部 adopter；
- 出现新的产品选择；
- named gate 修改 workspace；
- 需要 Git、Record、外部 repo 或破坏性操作；
- task writer 与当前会话不一致，且没有精确 takeover 授权。

## Candidate backlog

其余暂停项见 [candidate backlog](backlog/README.md)。旧
`backlog/03-schema5-structured-closeout.json` 和 `backlog/04-schema5-event-view.json`
仅保留 superseded 指针；唯一有效的 S3 candidate 是
[`03-structured-closeout-candidate.json`](03-structured-closeout-candidate.json)，唯一有效的
S4 candidate 是 [`04-schema5-event-view-candidate.json`](04-schema5-event-view-candidate.json)。

S2、S3 或 S4 的 review acceptance 均不会自动创建 implementation task、启动 current
release、修改外部 repo、执行全局安装或执行 Git 操作。
