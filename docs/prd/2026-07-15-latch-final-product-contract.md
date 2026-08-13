# Latch 最终产品契约

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

Decision-Status: approved

Document-Status: current product contract

Date: 2026-07-15

Revision: 8

Released: 2026-07-16 — C1–C8 已交付；本文件是唯一 current 产品契约入口。

Updated: 2026-07-22 — 增加 Light inline 输入、共享 worktree warning 分层和 archive JSON 标记。

Updated: 2026-07-23 — 增加批量 gate 验证、独立 artifact 命令、submit 缺失引用修复命令和 untracked warning 摘要。

Updated: 2026-07-23 — 增加 project-local Record V1，保持 Record 与 task 生命周期及默认上下文隔离。

Updated: 2026-07-28 — 修订 A/B/C 的多 gate 判定，按独立验收面与风险语义选择 profile。

Updated: 2026-08-03 — schema 5、CLI `0.5.0`、structured closeout 与 richer event/view 进入 Latch repo current；外部 adopter 保持 pending。

Updated: 2026-08-13 — 区分已决设计状态记录与产品决策，并允许紧邻 checkpoint 的明确 Standard 实施授权复用。

## 0. 地位

本文件与以下七个 current 分章共同构成 Latch 的产品契约。分章路径保留历史 `-draft` 文件名，仅为兼容既有链接；该文件名不表示文档状态。

最终契约由 v2 保留条款与分章按主题优先覆盖组成。未被分章覆盖的 v2 条款，例如 root 发现、JSON 输出形状、错误习惯、锁、archive 和 Board 只读，继续有效；`docs/prd/2026-07-10-latch-v2.md` 仅保留为历史基线，不再是 current 入口。

### 0.1 分章

| 章 | 路径 | 状态 |
|---|---|---|
| 触发、判定表、反馈与 worktree | `docs/prd/2026-07-15-latch-workflow-triggers-draft.md` | current component |
| Actor | `docs/prd/2026-07-15-latch-actor-writer-affinity-draft.md` | current component |
| Light | `docs/prd/2026-07-15-latch-light-proof-package-draft.md` | current component |
| Group | `docs/prd/2026-07-15-latch-group-minimal-draft.md` | current component |
| 知识与 freshness | `docs/prd/2026-07-15-latch-knowledge-freshness-draft.md` | current component |
| Context 与 benchmark | `docs/prd/2026-07-15-latch-context-benchmark-draft.md` | current component |
| 迁移、CLI 与发布 | `docs/prd/2026-07-15-latch-migration-cli-draft.md` | current component |
| Project Record | `docs/prd/2026-07-23-latch-record-v1.md` | current component |

## 1. 产品一句话

个人本地 coding task 记录器：保存可追溯的授权与验证，提供 Git 模块知识、受预算的 context pack 和显式 project-local Record；CLI 与 Skill 负责 bookkeeping。

## 2. 核心对象

task（唯一可写生命周期）、events、primary_writer、group_id、模块知识 Markdown、context pack 和独立 Record。

## 3. 生命周期摘要

```text
触发建 task → grill/判定表 → work_basis → dev/check → submit → review
                                                         ├─ 返工同 task
                                                         └─ 明确归档 → done
```

## 4. 阅读顺序

触发章 → 迁移/CLI → Actor → Light → Group → 知识 → Context → Record。

## 5. 跨章不变量

1. 同一时刻仅 `primary_writer` 可写该 task；允许跨 session 顺序 takeover，不允许同时共写。
2. group 无写门禁和完成门禁。
3. Core 处理结构与 revision，Skill 处理语义；Core 不根据 gate 数量或命令语义选择或升级 profile，也不做 NLP 归档。
4. `task.json` 是提交点，不实现通用事务。
5. `knowledge_impact` 在 submit 写入；知识文档与 fingerprint 基线独立维护。
6. stale 或失败的 adapter 不得静默当作 current。
7. 不恢复 v1 knowledge DB，不默认引入向量栈。
8. 日常不删除 `.latch`；v3 events 可经 R2 回退。
9. 文档与 Skill 只描述已发布的 CLI 行为。
10. actor current、primary writer 与 caller writer status 必须分别展示；reader 可统一投影授权状态，但不得增加第二份授权真源。
11. revision delta 依赖调用方已有 baseline；不能作为完整恢复入口。
12. 非实现修正只有在实现快照未变时保持原 proof；Core 不根据路径或自然语言自动判断影响。
13. 默认过程记录面向任务使用者，展示发生了什么、影响和下一步；原始 event 与 schema 字段只作为详情和调试入口。
14. inline Light 请求授权与 `none` knowledge impact 仅是 CLI 输入快捷路径，写入既有 work basis、submission、proof、revision 和 event 结构。
15. `done --json` 与 `abandon --json` 返回 `archived: true`；`phase` 保持归档前的最后开放 phase，`outcome` 保持既有语义。
16. `verify-all` 只编排当前 work revision 尚未通过的 named gate；每项仍独立记录 event 和 revision，失败即停。
17. `artifact add|remove` 复用 `save` 的 artifact 持久化语义；task schema 与 event 类型不增加新分支。
18. submit 一次报告全部缺失 artifact 引用并给出修复命令；untracked warning 默认返回总数和最多 8 个样本，完整清单由 `--verbose-warnings` 显式请求。
19. Record 是独立于 task 的 project-local 显式记录；Record 不具有 phase、writer、approval、gate、submission、review 或 event 历史。
20. Record 索引不含正文；普通启动、task 恢复、task list/context 和 context pack 不读取 Record。
21. Record 只允许当前 repo 内的标题和标签元数据查询，默认最多返回 5 条；正文只能按精确 ID 或唯一明确命中读取一条。
22. 显式 Record CRUD 只授权对应 Record 操作；关联与 task 来源不传播状态、writer 或 implementation authorization。
23. CLI `0.5.0` 是 current runner；新 task 使用 schema 5 和 `min_writer_version: "0.5.0"`。
24. schema 2–4 为 historical read-only；current runner 不提供 claim、upgrade、downgrade、双写或 archive migration。
25. schema 5 submit 使用结构化 `unverified_items`，done 必须为每项提供唯一 closeout resolution；自由文本 closeout 不是 current 契约。
26. schema 5 Context 提供 bounded item/resolution view、确定性 timeline 和 reviewer next action；`tests/fixtures/context-v5-board-reader.json` 是外部 reader 的冻结契约。
27. Latch repo current 与外部 adopter rollout 分开记录；外部 repo 未完成独立验收前必须保持 `pending`。

## 6. 触发与授权

触发章的判定表是权威定义：A 命中不明确或高风险改法不清时停在 grill；B 在范围明确、低风险且无未决问题时创建或续接 light task，并以请求作为授权，多个 lint、typecheck、build、文档索引等机械检查本身不触发 Standard；C 在需要方案确认、存在多个独立验收面、产品选择、公共契约或高风险面时创建或续接 standard task，展示 plan 后等待明确 approve，通常先展示已创建的 task id。Light task 出现 plan change、产品选择或 scope 扩大时，必须重新执行 A/B/C 判断，并按结果保持 Light、停在 grill 或升级 Standard。

已决设计的纯状态同步是 B 的窄例外，但必须同时满足：设计正文已冻结、`open_questions` 为空、用户已明确批准当前设计、改动仅包含 artifact 状态与索引元数据，且不新增产品选择、公共行为或 scope。来源设计 task 仍 open、同一 writer 可写且 approved scope 已覆盖时，按原 lifecycle 继续；来源 task 已关闭、只读或不存在时，创建并原子授权 Light task；open 来源 task 的 writer 或 scope 不满足时，先处理 handoff 或 plan。任一条件不满足时重新执行 A/B/C。设计 task 可以先提交 `proposed` artifact 供 review，但 plan 必须包含批准后的状态与索引同步；用户批准后在同一 task 完成同步，不得只为 `proposed` → `approved` 再建 Standard task。

Standard implementation authorization 可以发生在 checkpoint 前：Agent 必须先展示 goal、material scope、风险与 `open_questions`，用户以紧邻消息明确要求实施，且 checkpoint 持久化的 plan 与已展示内容没有材料变化。checkpoint 出现需用户判断的 warning、plan 变化或新增 open question 时必须停下。普通写入请求、未展示 plan 的指令、更早 task 的授权或含糊回复均不能推断为批准。该规则只消除重复确认，不改变每张 Standard implementation task 必须获得 direct approval 的要求。

## 7. 发布完成标准

Latch repo current release 已满足 C1–C8：Actor、Light、Group、knowledge freshness、Context/benchmark、schema 5 structured closeout、richer event/view、文档入口和指令面位于同一发布边界。Record V1 继续作为独立 current component。外部 adopter rollout 不属于 Latch repo current 完成条件，必须在接入状态中保持 `pending`。

## 8. 发布记录

2026-08-03 schema 5 current release 后，`docs/INDEX.md`、`docs/HANDBOOK.md`、`docs/DESIGN.md`、`docs/AI_INSTALL.md`、根 `AGENTS.md` 与 canonical Skill 均以本契约和触发章为 current 事实。CLI/package `0.5.0` 来自 S3 delivery，S4 保留 richer event/view，S5 负责 current 指令面与发布边界。

## 9. 残余风险

- 24k、8 步和 30% token 为默认参考值，观察期内可经独立 task 调整；
- Skill 的判定仍需以用户请求和 task 事实为依据；
- CodeGraph 未随本发布升级，聊天记录不进入产品真源。
- Latch-Board、monitoring 与 appearance-sec 的 schema 5 接入仍为 pending，需要分别使用独立 task 验收；本契约不授权外部 repo 修改或全局安装。
