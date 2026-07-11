# Latch 文档入口

本页是当前文档入口。开始 task 时，先读取 task artifacts，再从本页选择与当前工作直接相关的 1–3 份文档。

## 当前文档

### [使用手册](HANDBOOK.md)

v2 命令、phase、验证、review 和 archive 流程。

### [设计边界](DESIGN.md)

产品定位、当前事实、关键取舍和非目标。

### [本机安装](AI_INSTALL.md)

个人 macOS 环境的 CLI、canonical skill、备份和回退步骤。第一阶段不执行全局切换。

### [文档分层](ARTIFACTS.md)

Task 数据、项目文档和 artifact 的职责边界。

### [使用场景](SCENARIOS.md)

显式创建、继续 task、反馈分类和归档授权示例。

### [接入状态](ADOPTER_SYNC.md)

Latch、Latch-Board、appearance-sec 和 monitoring 的当前兼容状态。

## 当前产品契约

### [Latch v2 PRD](prd/2026-07-10-latch-v2.md)

- 状态：`approved`，Revision 2；
- Source-Task：`202607090959-根治-latch-漏触发与重复修补`；
- 用途：v2 用户协议、生命周期、schema、并发、发布和验收的唯一产品契约。

### [Latch v2 分窗口实施计划](briefs/2026-07-10-latch-v2-implementation-slices.md)

- 状态：`approved`，Revision 2；Slice 6 已归档，Slice 7 已完成并停在 review；
- 用途：第一阶段 7 个顺序 slice 的范围、验收和交接记录。

### [第一阶段验收结果](FIRST_PHASE_REVIEW.md)

第一阶段命令、数据、验证和第二阶段前置条件。

## 模板

- [功能 Brief 模板](templates/FEATURE_BRIEF.md)
- [PRD 模板](templates/PRD.md)

## 历史资料

`docs/briefs/` 和 `docs/prd/` 中未列为当前契约的文件只用于追溯。历史资料可以保留旧命令和旧设计事实，但不能作为当前使用说明。

## 维护规则

新增长期文档时：

1. 加入本页；
2. 由来源 task 添加 artifact；
3. 写明状态、用途和替代关系；
4. current 文档不得依赖聊天记录或本机绝对路径。
