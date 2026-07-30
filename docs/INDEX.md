# Latch 文档入口

本页是当前文档入口。开始 task 时，先读取 task artifacts，再从本页选择与当前工作直接相关的 1–3 份文档。

普通恢复不遍历 `docs/`。已知事实足够时停在 task artifact；需要产品或 CLI
细节时，优先读取本页列出的 current 文档，并先用标题或 `rg` 定位相关章节。
未列入 current 入口的 brief、PRD、相邻归档或路径相似文件不构成当前契约，
只有明确追溯请求或 current 证据不足时才读取。

## 当前文档

### [使用手册](HANDBOOK.md)

v2 命令、phase、验证、review 和 archive 流程。

### [设计边界](DESIGN.md)

产品定位、当前事实、关键取舍和非目标。

### [本机安装](AI_INSTALL.md)

个人 macOS 环境的 v2 CLI、canonical skill、项目初始化、备份和回退步骤。

### [文档分层](ARTIFACTS.md)

Task 数据、项目文档和 artifact 的职责边界。

### [使用场景](SCENARIOS.md)

显式创建、继续 task、反馈分类和归档授权示例。

### [接入状态](ADOPTER_SYNC.md)

Latch、Latch-Board、appearance-sec 和 monitoring 的当前兼容状态。

### [观察期](OBSERVATION.md)

10 张真实 v2 task 的起点、样本规则、进度检查、证据来源和评估方式。

### [观察期评估](briefs/2026-07-27-latch-v2-observation-evaluation.md)

- 状态：`approved`；
- Source-Task：`20260727101723730-评估-latch-v2-观察期结果并规划改进-7184ec`；
- 用途：记录固定 10 张样本的正式评估、扩大样本对照、证据边界和分层改进建议；
- 边界：不修改 current 产品契约，不直接授权 CLI、Core、Skill 或外部 repo 变更。

## 当前产品契约

### [Latch 最终产品契约](prd/2026-07-15-latch-final-product-contract.md)

- 状态：`approved`，Revision 6；
- Source-Task：`20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1`；
- 用途：Latch 唯一 current 产品契约；包含触发、Actor、Light、Group、knowledge、Context、Record 与 R2 回退。

### [Project Record V1](prd/2026-07-23-latch-record-v1.md)

- 状态：`approved`，Revision 1；
- Source-Task：`20260723055901805-设计并实现项目级-record-v1-42de93`；
- 用途：定义 project-local Record 的存储、CLI、AI 访问、task 来源和 Board 只读边界。

### [Latch v2 分窗口实施计划](briefs/2026-07-10-latch-v2-implementation-slices.md)

- 状态：`approved`，Revision 2；
- 用途：第一阶段 7 个顺序 slice 的范围、验收和交接记录。当前接入结果以
  [接入状态](ADOPTER_SYNC.md)为准。

### [第一阶段验收结果](FIRST_PHASE_REVIEW.md)

第一阶段命令、数据、验证和第二阶段前置条件，仅用于历史追溯。

## 模板

- [功能 Brief 模板](templates/FEATURE_BRIEF.md)
- [PRD 模板](templates/PRD.md)

## 历史资料

- [Latch v2 PRD](prd/2026-07-10-latch-v2.md)是最终契约的历史基线，不再是 current 产品契约。
- [最终契约草案入口](prd/2026-07-15-latch-final-product-contract-draft.md)保留为历史跳转页。
- `docs/briefs/` 和 `docs/prd/` 中未列为 current 契约的文件只用于追溯。历史资料可以保留旧命令和旧设计事实，但不能作为当前使用说明。

## 维护规则

新增长期文档时：

1. 加入本页；
2. 由来源 task 添加 artifact；
3. 写明状态、用途和替代关系；
4. current 文档不得依赖聊天记录或本机绝对路径。
