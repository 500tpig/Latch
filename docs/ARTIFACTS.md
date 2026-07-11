# Latch v2 文档分层

## Task 数据

`.latch` 只保存 task 当前状态、events、actor current 和 archive。它不是 PRD、设计文档或聊天存档。

## 项目文档

长期有效资料保存在项目 `docs/`，并由 `docs/INDEX.md` 提供入口：

- 大需求：PRD；
- 中等功能：brief；
- 难回退技术决定：ADR；
- 运行和恢复步骤：runbook；
- 长期架构说明：architecture 或 design。

## Artifact

通过 artifact 把 task 指向项目文档：

```text
prd:docs/prd/example.md
brief:docs/briefs/example.md
runbook:docs/runbooks/example.md
```

路径必须相对 workspace root。Task 不复制文档正文。

## 默认选择

- 只需当前 task 继续：保存完整 plan 和 decision event；
- 需要跨 task 复用：更新现有项目文档；
- 新增长期文档：加入 `docs/INDEX.md`，并由来源 task 添加 artifact。
