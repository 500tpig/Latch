# Latch 工作流改进与 S4 candidate

Source-Task: `20260803021354850-冻结-s4-schema-5-event-view-candidate-规划-2eae7e`

Source-Task-Plan-Revision: `2`

Source-Baseline: `35e6ff0f3fedc4753c04d8a599075c1d0621f411`

Plan-Revision: `8`

Document-Status: `candidate-planning`

Date: 2026-08-03

## 地位

本文件记录 Latch 工作流改进的当前基线、已交付切片、已冻结 candidate 和剩余
candidate backlog。本文件不是 current 产品契约，也不构成 S4、S5 或任一后续项的
implementation authorization。

当前状态分为五层：

1. S1 未初始化停止边界已经完成、验收并通过 Git commit `d83fe11` 交付；
2. S2 schema 4 Light plan authoring 已由 commit
   `0a14c714753a106a89a94e6d0af464a15024cc2e` 交付；
3. S3 schema 5 结构化 closeout 已由 candidate delivery commit
   `f08f66999799dda713fe43c50a5b4b08958e15dd` 交付；
4. S4 schema 5 event/view 丰富展示已冻结为正式 candidate，尚未授权实施；
5. S5 current 文档、安装和 adopter rollout 继续保存在 candidate backlog。

current 行为仍以 [使用手册](../HANDBOOK.md)、[设计边界](../DESIGN.md)和 canonical
Skill 为准。S3 delivery commit 尚不等同于 current release；当前 `main` 可能仍停留在
CLI `0.4.0` 与 schema 4 current 契约。

## 当前基线：S1 已交付

S1 解决未初始化目录中的 Latch 流程空转问题。交付内容包括：

- root discovery 返回稳定的 typed `not_initialized` 错误；
- JSON error envelope 使用稳定 error code，不依赖 message 匹配；
- canonical Skill 收到 `not_initialized` 后立即停止 Latch 后续步骤；
- 未初始化探测不打印 template、不创建 plan、不调用 checkpoint，也不自动执行
  `latch init`；
- current 使用说明和相关测试同步更新。

S1 已完成、验收并通过 commit `d83fe11` 交付，是后续规划使用的当前基线。
`docs/plans/latch-v5/01-not-initialized-boundary.json` 只保留为设计与实施范围的追溯
artifact，不再需要新的规划、批准、实施或验收。

## S2 已交付：schema 4 Light authoring

S2 已由 commit `0a14c714753a106a89a94e6d0af464a15024cc2e` 交付，implementation task 为
`20260731083151763-试点简化-light-plan-authoring-bb5eb1`。它只处理 Light plan
authoring 负担，不同时改动 task schema、版本、scope 真源或 review closeout。

S2 的范围是：

- Light template 只展示 `goal`、`workspace_scope`、`scope`、`acceptance`、
  `approach` 和 `verification_plan`；
- 缺失的 assumptions、user flow、out-of-scope 和 open questions 在创建 task 前
  确定性补为空数组；
- 落盘 task 继续使用完整 schema 4 plan shape；
- Standard plan、CLI `0.4.0`、minimum writer、scope 参数、work basis、proof、
  submission 和 closeout 保持不变。

S2 不包含 schema 5、CLI/package `0.5.0`、旧 schema 拒写、单一 scope 真源、结构化
closeout 或 event/view。CLI/package `0.5.0` 来自 S3 candidate delivery commit
`f08f66999799dda713fe43c50a5b4b08958e15dd`，不得再归因于 S2。

## S3 candidate 已交付

S3 schema 5 structured closeout 已由 candidate delivery commit
`f08f66999799dda713fe43c50a5b4b08958e15dd` 交付。该 commit 的实际交付内容包括：

- repo-local package 和 CLI `0.5.0`；
- schema 5 structured closeout、未验证事项 resolution、accepted risk 和 external owner
  规则；
- schema 5 `submitted` 与 `done` event validator；
- status、brief、full Context 和 human Context 的最低投影；
- `tests/fixtures/context-v5-candidate.json`，用于固定最低 lifecycle 和 view。

S3 保持 `events_schema_version: 3`。`submitted` event 保存 `unverified_item_ids` 和
`unverified_count`；`done` event 保存 `resolved_count`、`accepted_risk_count` 和
`followup_count`。S4 不得改变这些 event payload 或 validator。

旧 `docs/plans/latch-v5/backlog/03-schema5-structured-closeout.json` 只保留
superseded 指针，不再是可执行 Standard plan。

## S4 已冻结 candidate

| 切片 | 计划文件 | 状态 |
|---|---|---|
| S4 schema 5 event/view 丰富展示 | `docs/plans/latch-v5/04-schema5-event-view-candidate.json` | candidate plan 已冻结；尚未授权实施 |

S4 的目标是在 S3 最低 Context 之上增加 richer timeline 和 reader-facing view：

- 基于 S3 已交付的 `task.json` current state 与 event 计数派生展示；
- 增加 bounded item、resolution 摘要、确定性标题、影响和 next action；
- 新增独立 reader contract fixture `tests/fixtures/context-v5-board-reader.json`；
- 保持 S3 的 event payload、validator、closeout 规则和
  `tests/fixtures/context-v5-candidate.json` 不变；
- 不实现 Board UI、不修改外部 repo、不更新 package/current 文档、不执行全局安装。

真实六字段 Light authoring 样本尚未得到使用观察。现有证据已被接受为 S4 重新激活的
前置条件：S2 功能、测试和交付 commit 已存在，且 S2 之后存在真实 Light task。六字段
输入缺少真实使用观察是后续观察限制，不阻断 S4 event/view 展示，也不得被编造成已验证
证据。

## 暂停候选

| 候选项 | 计划文件 | 状态 |
|---|---|---|
| schema 5 current 文档、安装和 adopter rollout | `docs/plans/latch-v5/backlog/05-schema5-current-release.json` | candidate backlog |

旧 `docs/plans/latch-v5/backlog/02-schema5-plan-authoring.json` 已改为历史指针：S2
由 `02-light-plan-authoring-pilot.json` 覆盖，CLI/package `0.5.0` 由 S3 candidate
覆盖。旧 `backlog/04-schema5-event-view.json` 已改为 S4 candidate 指针。

这些文件保留原规划中的产品选择、验收和影响面，但不构成 implementation
authorization，也不组成 `S2 → S3 → S4 → S5` 的自动执行顺序。

## 其余 backlog 重新激活条件

S5 或其它后续项重新进入规划前至少需要：

1. 重新读取最新 task artifact、current 实现和相关测试；
2. 核对 S3、S4 的 review acceptance 和 Git delivery；
3. 用户重新确认问题优先级、发布边界和外部 adopter 范围；
4. 新的完整 Standard plan 已写入 task store，聊天返回决策重点和 task ID，并获得
   精确 Revision 的明确批准。

重新激活不复用本目录中旧 plan 的 implementation authorization，也不自动恢复原
`S2 → S3 → S4 → S5` 顺序。

## 对话与 task 分工

### 主规划对话

主规划对话负责：

- 维护本 Brief、已冻结 candidate、backlog 状态和文档索引；
- 读取对应 implementation task 的 status、brief 和 submission；
- 保存真实观察后的规划决策；
- 在范围或产品选择变化时生成新的完整 Standard plan 并写入 task store。

主规划对话不负责：

- 重新规划或实施 S1、S2 或 S3；
- 预建 S4 implementation task；
- 创建 worktree、runner 或 candidate Latch；
- 代替实现对话运行 gate；
- 读取实现聊天全文或 Record 正文；
- 执行 Git。

### S4 实现对话

S4 实现对话：

1. 读取 `04-schema5-event-view-candidate.json`；
2. 核对 S3 delivery commit `f08f66999799dda713fe43c50a5b4b08958e15dd`、实时
   workspace 状态、当前实现和相关测试；
3. 从 plan 创建自己的 Standard task；
4. 返回 plan 的决策重点和 task ID，由 Latch-Board 或 `latch context` 提供完整 plan，
   并等待明确批准；
5. 只实施 S4；
6. 运行全部 named gate；
7. submit 到 review；
8. 返回 task ID、revision 和未验证事项后停止。

实现对话不读取旧聊天或 Record，不实施 S5，不执行 done 或 Git。

## 验收

- S1 在本 Brief、plans README 和索引中均被记录为 commit `d83fe11` 已交付基线；
- S2 在本 Brief、plans README、backlog README 和索引中均被记录为 commit
  `0a14c714753a106a89a94e6d0af464a15024cc2e` 已交付；
- 文档明确 S2 只简化 schema 4 Light authoring，不把 CLI/package `0.5.0` 归因于 S2；
- S3 在本 Brief、plans README、backlog README 和索引中均被记录为 candidate delivery
  commit `f08f66999799dda713fe43c50a5b4b08958e15dd`；
- 文档明确 CLI/package `0.5.0` 来自 S3 candidate delivery commit，而不是 S2；
- S4 的正式 candidate plan 已保存为
  `docs/plans/latch-v5/04-schema5-event-view-candidate.json`；
- 旧 `backlog/04-schema5-event-view.json` 仅保留 superseded 指针；
- S4 边界明确不修改 event payload、event validator、closeout 规则、S3 最低 fixture、
  Board UI、外部 repo、全局安装或 Git；
- 真实六字段 Light authoring 样本缺失被记录为后续观察限制，不阻断 S4，也不被写成已验证
  证据；
- proposed/candidate 规划不修改 current 产品契约，也不提前宣称 S4、S5 或 adopter rollout
  已交付；
- 对话交接只依赖 repo artifact、精确 task 状态和实时 workspace；
- `node --test tests/docs-skill.test.mjs`、`pnpm check` 与 `git diff --check` 通过。

## 风险

- S4 实施若发现需要修改 event payload、validator 或 closeout 规则，说明 candidate 边界不足，
  必须返回规划；
- S4 richer view 若开始承担 submission 或 closure 的第二真源职责，必须停止；
- Board/external-reader fixture 只能作为读取契约，不能隐含 Board UI 或外部 repo 授权；
- 六字段 Light authoring 仍缺真实样本，后续若把该证据用于 S5 或 rollout，需要单独观察；
- S3 candidate delivery commit 尚不等同于 current release，current 文档切换必须留给 S5；
- candidate 长期保存时必须继续标明未实施状态和 superseded 关系，避免被误作 current
  契约。
