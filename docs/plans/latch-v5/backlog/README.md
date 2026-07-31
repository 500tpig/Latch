# Latch 工作流 candidate backlog

Source-Task: `20260731093527854-冻结-s3-结构化收尾-candidate-规划-258da4`

Source-Task-Plan-Revision: `3`

Document-Status: `candidate-backlog`

## 地位

本目录保存暂停的候选设计和已被取代的历史入口。文件保留此前规划中的产品选择、
边界、验收和影响面，但不属于当前主动实施顺序，也不构成 implementation
authorization。

不得直接依据本目录中的 plan JSON 创建 implementation task。旧 backlog/03 已由上级目录
中的 S3 candidate 取代；其余暂停项重新激活前，需要先取得 S2 真实使用证据，重新确认
优先级和产品选择，再生成新的完整 Standard plan。

## 候选项

| 候选项 | 文件 | 当前状态 |
|---|---|---|
| schema 5、CLI `0.5.0`、旧 schema 拒写和单一 scope 真源 | `02-schema5-plan-authoring.json` | 暂停 |
| 结构化未验证事项与 closeout resolution | [`03-schema5-structured-closeout.json`](03-schema5-structured-closeout.json) | superseded；唯一入口为 [`../03-structured-closeout-candidate.json`](../03-structured-closeout-candidate.json) |
| schema 5 丰富 timeline 和 Board/external-reader contract fixture | `04-schema5-event-view.json` | 暂停 |
| schema 5 current 文档、安装和 adopter rollout | `05-schema5-current-release.json` | 暂停 |

## 重新激活条件

除已由 S3 candidate 取代的 backlog/03 外，其余候选项重新进入规划前至少需要：

1. S2 schema 4 Light authoring 试点已完成；
2. 已取得真实 Light task 使用证据；
3. 用户重新确认问题优先级和产品方向；
4. 新规划重新读取 current 实现和测试；
5. 新的完整 Standard plan 已展示并获得明确批准。

样本数、观察周期和 go/no-go 标准不在本规划中预设，由后续独立评估确定。
