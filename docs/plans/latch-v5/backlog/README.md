# Latch 工作流 candidate backlog

Source-Task: `20260803021354850-冻结-s4-schema-5-event-view-candidate-规划-2eae7e`

Source-Task-Plan-Revision: `2`

Document-Status: `candidate-backlog`

## 地位

本目录保存暂停的候选设计和已被取代的历史入口。文件保留此前规划中的产品选择、
边界、验收和影响面，但不属于当前主动实施顺序，也不构成 implementation
authorization。

不得直接依据本目录中的 plan JSON 创建 implementation task。已冻结的正式 candidate
保存在上级目录；本目录中的 superseded 文件只作为历史跳转和归因记录。

## 候选项

| 候选项 | 文件 | 当前状态 |
|---|---|---|
| schema 5、CLI `0.5.0`、旧 schema 拒写和单一 scope 真源 | [`02-schema5-plan-authoring.json`](02-schema5-plan-authoring.json) | superseded；S2 已由 [`../02-light-plan-authoring-pilot.json`](../02-light-plan-authoring-pilot.json) 覆盖，CLI/package `0.5.0` 来自 S3 candidate |
| 结构化未验证事项与 closeout resolution | [`03-schema5-structured-closeout.json`](03-schema5-structured-closeout.json) | superseded；唯一入口为 [`../03-structured-closeout-candidate.json`](../03-structured-closeout-candidate.json) |
| schema 5 丰富 timeline 和 Board/external-reader contract fixture | [`04-schema5-event-view.json`](04-schema5-event-view.json) | superseded；唯一入口为 [`../04-schema5-event-view-candidate.json`](../04-schema5-event-view-candidate.json) |
| schema 5 current 文档、安装和 adopter rollout | [`05-schema5-current-release.json`](05-schema5-current-release.json) | 暂停 |

## 重新激活条件

S2 已由 commit `0a14c714753a106a89a94e6d0af464a15024cc2e` 交付，且只覆盖 schema 4
Light authoring 简化。S3 candidate 已由 commit
`f08f66999799dda713fe43c50a5b4b08958e15dd` 交付，并负责 CLI/package `0.5.0`、schema
5 structured closeout、event validator、最低 Context 和 `tests/fixtures/context-v5-candidate.json`。

S4 已冻结为正式 candidate，不再由本目录中的旧 backlog/04 重新激活。S5 或其它后续项
重新进入规划前至少需要：

1. 重新读取最新 task artifact、current 实现和相关测试；
2. 核对 S3、S4 的 review acceptance 和 Git delivery；
3. 用户重新确认问题优先级、发布边界和外部 adopter 范围；
4. 新的完整 Standard plan 已写入 task store，聊天返回决策重点和 task ID，并获得
   精确 Revision 的明确批准。

真实六字段 Light authoring 样本尚未得到使用观察；该事实是后续观察限制，不阻断 S4
event/view 展示，也不得被编造成已验证证据。
