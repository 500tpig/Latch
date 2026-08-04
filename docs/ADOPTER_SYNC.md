# Latch schema 5 接入状态

本页区分 Latch repo 的 schema 5 current release 与外部 adopter rollout。Latch Core、
CLI、canonical Skill 和 current 文档可以进入 current；Latch-Board、monitoring 与
appearance-sec 在各自完成独立 task 前保持 `pending`。

## 当前矩阵

截至 2026 年 8 月 3 日：

| 项目 | 状态 | 当前证据 | 独立后续 |
|---|---|---|---|
| Latch | schema 5 Core current | package/CLI `0.5.0`；S3 structured closeout commit `f08f66999799dda713fe43c50a5b4b08958e15dd`；S4 richer event/view commit `18bfb36d59ee9f789f051ba5ea372a2e35246ba2` | 完成本 repo 的 review 与 Git delivery；Git 不属于 S5 task 授权 |
| Latch-Board | pending | 冻结 reader fixture `tests/fixtures/context-v5-board-reader.json` 已在 Latch repo；未修改 Board repo | 独立 Standard task 更新 reader、fixture、UI 和真实流程验收 |
| monitoring | pending | 本次未读取或修改该 repo，也未迁移其 historical task | 独立 Standard task 核对 CLI/Skill 安装、schema 5 新 task 与 historical read-only 展示 |
| appearance-sec | pending | 本次未读取或修改该 repo，也未创建 adopter task | 独立 Standard task 核对 CLI/Skill 安装、schema 5 新 task 与空状态流程 |

本矩阵不表示全局 CLI 已重新链接、外部 repo 已修改、Board UI 已验收或全面 rollout
已完成。

## Current schema 边界

- 新 task 使用 `schema_version: 5` 和 `min_writer_version: "0.5.0"`；
- schema 5 是唯一 current writer；
- schema 2–4 为 historical read-only，CLI `0.5.0` 在 mutation 前返回
  `writer_version_mismatch`；
- CLI JSON envelope 继续使用 `schema_version: 2`；
- event 文件继续使用 `events_schema_version: 3`，该字段不是 writer lock；
- current release 不提供 upgrade、downgrade、双写、字符串 closeout migration 或
  historical archive 重写。

## Reader contract

Latch-Board 与其它 adopter 以
`tests/fixtures/context-v5-board-reader.json` 作为 schema 5 冻结读取契约。fixture
覆盖：

- open、review 与 archived schema 5 view；
- bounded `unverified_items` 与 resolution sample，默认 sample limit 为 8；
- `reviewer_next_action`、确定性 timeline 标题、影响和下一步；
- `resolved`、`accepted_risk`、`followup` 三种 closeout outcome；
- mixed resolution、额外 follow-up 和没有 follow-up 的归档；
- historical archive 的 `historical_schema: true` 与原字符串投影。

fixture 不包含本机绝对路径、聊天内容、凭据或外部 repo 状态。reader 不得从 event
重建 submission 或 closure，也不得把 fixture 当作 Board 写入授权。

## Adopter 阻断条件

每个外部 repo 的 rollout 必须使用独立 task，并至少满足：

1. 明确批准该 repo 的 workspace scope、reader/UI 影响和验收路径；
2. 使用冻结 fixture 更新并验证 open、review、archive 与 historical read-only 读取；
3. schema 5 未知字段按单 task 隔离，不影响同一数据源的其它可读 task；
4. 不直接写 `.latch/tasks/*/task.json`，不迁移或重写 historical archive；
5. 需要更新全局 CLI 或 canonical Skill 链接时，取得单独安装授权；
6. 完成目标 repo 的测试、构建和必要的真实 UI/流程验收；
7. 单独完成目标 repo 的 review 与 Git delivery。

任一条件未满足时，该 adopter 保持 `pending`。Latch S5 不自动创建 adopter task，
也不把外部验收写成已完成事实。

## 全面 rollout 完成条件

只有 Latch-Board、monitoring 与 appearance-sec 的独立 task 均完成 review acceptance
和 Git delivery，并核对安装传播状态后，才能通过新的 Latch task 将全面 rollout 状态
改为完成。

## Historical evidence

schema 4 接入证据继续保留用于追溯：Latch commit `1337ad0`、Latch-Board commit
`10569dd`，以及更早的 v2 接入 commits `cd52f2d`、`d41ada8`、`9bd4272`、
`ee66345`。这些事实不证明 schema 5 adopter rollout 已完成，也不授权修改对应 repo。
