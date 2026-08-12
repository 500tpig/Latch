# Latch 文档入口

本页是当前文档入口。开始 task 时，先读取 task artifacts，再从本页选择与当前工作直接相关的 1–3 份文档。

普通恢复不遍历 `docs/`。已知事实足够时停在 task artifact；需要产品或 CLI
细节时，优先读取本页列出的 current 文档，并先用标题或 `rg` 定位相关章节。
未列入 current 入口的 brief、PRD、相邻归档或路径相似文件不构成当前契约，
只有明确追溯请求或 current 证据不足时才读取。

## 当前文档

### [使用手册](HANDBOOK.md)

schema 5 current writer、historical read-only、phase、验证、review 和结构化 closeout。

### [设计边界](DESIGN.md)

产品定位、schema 5 机器拒写、当前事实、reader contract、关键取舍和非目标。

### [本机安装](AI_INSTALL.md)

个人 macOS 环境的 CLI `0.5.0`、canonical Skill、项目初始化、备份和安装回退边界。

### [文档分层](ARTIFACTS.md)

Task 数据、项目文档和 artifact 的职责边界。

### [使用场景](SCENARIOS.md)

显式创建、继续 task、反馈分类和归档授权示例。

### [接入状态](ADOPTER_SYNC.md)

Latch、Latch-Board、appearance-sec 和 monitoring 的当前兼容状态。

### [Agent 使用反馈](AGENT_FEEDBACK.md)

非默认流程。其他 repo 先生成可核对的交接材料，Latch repo 再按当前版本核验并分流到
Record、task、Skill、文档、测试或来源 repo；不再统一追加到单一 Project Record。该流程与
v2 / Schema 5 观察期的 archive 定量样本分离。

### [观察期](OBSERVATION.md)

真实使用观察规则入口，含两段：

- **v2 观察期**：10 张真实 v2 task 的起点、样本规则、进度检查与证据边界；
- **Schema 5 观察期**：schema 5 current writer 窗口的起点
  （`20260804032944615` / `2026-08-04T03:42:02.974Z`）、合格/排除规则、
  `unverified_items` 与 structured closeout 等字段、进度检查格式；固定 10 张样本
  评估尚未开始。

### [观察期评估](briefs/2026-07-27-latch-v2-observation-evaluation.md)

- 状态：`approved`；
- Source-Task：`20260727101723730-评估-latch-v2-观察期结果并规划改进-7184ec`；
- 用途：记录 **v2** 固定 10 张样本的正式评估、扩大样本对照、证据边界和分层改进建议；
- 边界：不修改 current 产品契约，不直接授权 CLI、Core、Skill 或外部 repo 变更；
  不替代 schema 5 观察期评估（schema 5 满 10 张后另建评估 task）。

## 待实现设计

### [轻量 lifecycle delta CLI 契约](briefs/2026-08-12-latch-lifecycle-delta-contract.md)

- 状态：`proposed contract`；
- Source-Task：`20260812100351819-设计轻量-lifecycle-delta-最小稳定-cli-契约-ee1a38`；
- 用途：冻结 `append-scope`、`update-verification-command`、
  `resolve-open-questions` 三项独立 plan delta CLI，并引用已交付的 `reconcile` 契约；
- 边界：当前 Core/CLI 尚未实现前三项命令；本文不改变 `reconcile`、结构化 JSON stdin、
  workspace evidence 或 formatter 的 current 已交付行为。

## 已实现设计基线

### [Gate 工作区 mutation 证明与失效语义](briefs/2026-07-30-latch-gate-workspace-mutation-proof.md)

- 状态：`implemented`；文件内 `Document-Status` 保留实施前的设计状态；
- Source-Task：`20260730040007379-设计-gate-工作区-mutation-证明与失效语义-2e68d9`；
- Source-Record：`rec_41800a8d-00e2-413f-a730-3ead2e4e691b` revision 1；
- 用途：记录 gate 前后工作区 evidence、mutation 分类、proof generation、`verify-all` 停止规则和只读 Git 边界的设计基线；
- 边界：current 行为以 [使用手册](HANDBOOK.md)和[设计边界](DESIGN.md)为准，该文件不单独授权后续变更。

## Schema 5 release 基线

### [Latch schema 5 工作流设计基线](briefs/2026-07-31-latch-v5-workflow-contract.md)

- 状态：`implemented-baseline`；
- Current-Release-Task：`20260803033739558-s5-schema-5-current-release-836ec7`，Plan Revision 1；
- S4-Planning-Task：`20260803021354850-冻结-s4-schema-5-event-view-candidate-规划-2eae7e`，Plan Revision 2；
- 规划 source baseline：`35e6ff0f3fedc4753c04d8a599075c1d0621f411`；
- 当前基线：S1 未初始化停止边界已完成、验收并通过 commit `d83fe11` 交付；
- 已交付试点：S2 schema 4 Light authoring 已由 commit
  `0a14c714753a106a89a94e6d0af464a15024cc2e` 交付；
- 已交付 candidate：S3 schema 5 结构化 closeout 已由 candidate delivery commit
  `f08f66999799dda713fe43c50a5b4b08958e15dd` 交付，CLI/package `0.5.0` 来自 S3，不是 S2；
- 已交付 candidate：S4 schema 5 event/view 丰富展示已由 commit
  `18bfb36d59ee9f789f051ba5ea372a2e35246ba2` 交付，规划入口为
  [S4 event/view candidate](plans/latch-v5/04-schema5-event-view-candidate.json)；
- 取代关系：`plans/latch-v5/backlog/03-schema5-structured-closeout.json` 和
  `plans/latch-v5/backlog/04-schema5-event-view.json` 仅保留 superseded 指针；
- current release：schema 5 是 current writer；schema 2–4 为 historical read-only；
  structured closeout 与 richer event/view 已进入 current；
- 规划入口：[Latch 工作流改进计划与对话交接](plans/latch-v5/README.md)；
- 边界：Latch-Board、monitoring、appearance-sec、全局安装和 Git delivery 仍需独立授权；
  当前状态见[接入状态](ADOPTER_SYNC.md)。

## 当前产品契约

### [Latch 最终产品契约](prd/2026-07-15-latch-final-product-contract.md)

- 状态：`approved`，Revision 8；
- Source-Task：`20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1`；
- 用途：Latch 唯一 current 产品契约；包含触发、Actor、Light、Group、knowledge、Context、Record、schema 5 structured closeout 与 historical read-only。

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
