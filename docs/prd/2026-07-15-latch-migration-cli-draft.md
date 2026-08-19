# Schema、CLI 与发布边界

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

Decision-Status: approved

Document-Status: current component of `2026-07-15-latch-final-product-contract.md`

Date: 2026-07-15

Revision: 5

Updated: 2026-08-03 — CLI `0.5.0` 与 schema 5 进入 current；schema 2–4 固定为 historical read-only。

Updated: 2026-08-19 — current runner 更新为 CLI `0.6.1`，JSON envelope 更新为 3；schema 5 的 minimum writer 仍为 `0.5.0`。

## 1. 与历史契约的关系

`docs/prd/2026-07-10-latch-v2.md` 是历史基线。本分章覆盖 task schema、current CLI、
结构化 closeout 和发布边界；未被 current 分章覆盖的 root 发现、JSON envelope、错误
习惯、短锁与 archive 提交点继续有效。

## 2. Schema 版本

| 位置 | Current 规则 |
|---|---|
| `task.json.schema_version` | 新写入固定为 `5` |
| `task.json.min_writer_version` | schema 5 固定为 `0.5.0` |
| CLI package | current 为 `0.6.1` |
| CLI JSON envelope | 使用 `schema_version: 3` |
| `events.jsonl` | 保持 `events_schema_version: 3` |

`events_schema_version` 表示 forward-compatible event grammar，不是 writer lock。task
schema 决定 writer 与 event validator。

## 3. Current writer

CLI `0.6.1` 的 `checkpoint` 创建 schema 5 task，并写入 `primary_writer`、`profile`、
`provenance: clean` 和完整 `TaskPlan`。Standard 为默认 profile；Light authoring input
在持久化前补齐为完整 `TaskPlan`。

`workspace_scope.paths` 是机器范围的唯一真源。普通 Light request 使用
`--authorize-request <reason>`；current 命令面不再接受单独的 scope summary 或 scope
path 输入。

schema 5 submit 使用重复的 `--unverified-item <summary>`，Core 生成稳定 item ID。
done 使用 `--closeout-file`，并要求每个 item 恰好对应一个 `resolved`、
`accepted_risk` 或 `followup` resolution。

## 4. Historical read-only

CLI `0.6.1` 可读取 schema 2–5，但只修改 schema 5。schema 2–4 mutation 在 task、
event、evidence、backup 或 archive 写入前返回 `writer_version_mismatch`。

Current workflow 不提供：

- claim、upgrade 或 downgrade historical task；
- schema 4/5 双写；
- 自由文本 submission 或 closeout 到 schema 5 的字符串 migration；
- 启动、恢复、构建或验证期间的自动 migration；
- historical archive 重写、删除或批量转换。

历史 task 与 archive 保持原值，可通过 `list` 和精确 ID `context` 读取。任何未来迁移
都需要独立产品契约、备份方案、实施 task 和明确授权。

## 5. Event 与 current state

`task.json` 是 current state 和跨文件提交点。event log 保存历史线索与计数，不复制
完整 submission 或 closure。event append 失败返回 warning，可能导致
`history_incomplete`，但不回滚已提交的 `task.json`。

schema 5 `submitted` event 只保存 item ID 与数量；`done` event 只保存三种 outcome
计数。完整 `unverified_items`、resolution、用户接受事实和 follow-up owner 只保存在
task current state 与 archive closure。

## 6. CLI current 命令面

| 操作 | 语义 |
|---|---|
| `init` | 显式初始化 `.latch`；未初始化探测不自动调用 |
| `checkpoint` | 创建 schema 5 Standard、Light 或 retrospective task |
| `checkpoint --print-plan-template` | 输出 Light 或 Standard shape scaffold，不写 store |
| `use` | 只更新当前 actor 的 state 指针 |
| `list` / `context` | 读取 open task 与 historical archive |
| `save` / `approve` / `takeover` | 只修改 schema 5 open task |
| `verify` / `verify-all` | 执行 approved plan 的 named gate |
| `artifact add|remove` | 更新 task artifact 引用 |
| `submit` | 写 structured submission 并进入 review |
| `patch-submission-knowledge-impact` | 修正 review submission 的知识影响 |
| `done` / `abandon` | 在明确授权后归档 schema 5 open task |
| `record` | 显式 project-local Record CRUD |
| `knowledge fingerprint/check` | 模块知识 freshness |
| `context pack` / `benchmark context` | 受预算上下文与 diagnostic benchmark |

顶层 help 不列出 historical mutation、重复 scope 输入或自由文本 closeout。

## 7. 读取契约

`list` 与 `context` 的 JSON envelope 使用 `schema_version: 3`。schema 5 detail 在既有字段之上
增加 `schema5_view`：

- bounded `unverified_items` 与 resolution sample；
- 完整 total、sample limit 与 truncated 状态；
- `reviewer_next_action`；
- 确定性 timeline 标题、影响和下一步；
- closeout outcome 计数和 follow-up 导航。

schema 2–4 archive 明确返回 `historical_schema: true`，保留原字符串投影，不推断
schema 5 resolution。`tests/fixtures/context-v5-board-reader.json` 冻结 Board 与 adopter
reader contract；fixture 不构成外部 repo 写入或 UI 实施授权。

## 8. 错误、锁与 archive

- revision mismatch 使用 `--expect-revision` 冲突错误，不自动重试；
- writer mismatch 在 mutation 前 fail closed；
- task 使用独立短锁，组合锁顺序保持 `task -> state`；
- archive 继续以目录 rename 为提交点；
- `done --json` 与 `abandon --json` 返回 `archived: true`，保留最后开放 phase 与
  outcome；
- current mutation 只解析 open schema 5 task，不把 archive 接回写路径。

## 9. 发布边界

Latch repo current release 必须在同一边界包含：

1. package 与 CLI `0.6.1`；
2. schema 5 writer 与 schema 2–4 historical read-only；
3. canonical Skill、Handbook、Design、AI install、产品契约和文档入口；
4. S3 structured closeout 与 S4 richer event/view；
5. 冻结 Board/adopter reader fixture；
6. 项目检查、canonical Skill 链接检查和 diff 完整性检查。

外部 adopter、全局安装、npm 发布和 Git delivery 不属于同一 implementation 授权。
Latch-Board、monitoring 与 appearance-sec 在独立 task 完成前保持 `pending`。

## 10. 一致性摘要

- CLI `0.6.1` 是 current runner；schema 5 是唯一 current writer，minimum writer 为 `0.5.0`；
- schema 2–4 保持 historical read-only，不迁移、不双写、不重写 archive；
- `workspace_scope.paths` 是唯一机器 scope；
- submission 与 closeout 使用结构化 item/resolution；
- event grammar 保持 schema 3，task schema 承担 writer lock；
- Latch repo current 与外部 adopter rollout 分开验收和记录。
