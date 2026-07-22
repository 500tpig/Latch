# Latch 最终产品契约

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

Decision-Status: approved

Document-Status: current product contract

Date: 2026-07-15

Revision: 5

Released: 2026-07-16 — C1–C8 已交付；本文件是唯一 current 产品契约入口。

Updated: 2026-07-22 — 增加 Light inline 输入、共享 worktree warning 分层和 archive JSON 标记。

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

## 1. 产品一句话

个人本地 coding task 记录器：保存可追溯的授权与验证，并提供 Git 模块知识和受预算的 context pack；CLI 与 Skill 负责 bookkeeping。

## 2. 核心对象

task（唯一可写生命周期）、events、primary_writer、group_id、模块知识 Markdown 和 context pack。

## 3. 生命周期摘要

```text
触发建 task → grill/判定表 → work_basis → dev/check → submit → review
                                                         ├─ 返工同 task
                                                         └─ 明确归档 → done
```

## 4. 阅读顺序

触发章 → 迁移/CLI → Actor → Light → Group → 知识 → Context。

## 5. 跨章不变量

1. 同一时刻仅 `primary_writer` 可写该 task；允许跨 session 顺序 takeover，不允许同时共写。
2. group 无写门禁和完成门禁。
3. Core 处理结构与 revision，Skill 处理语义；Core 不做 NLP 归档。
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

## 6. 触发与授权

触发章的判定表是权威定义：A 命中不明确或高风险信号时停在 grill；B 在范围明确、低风险且无未决问题时创建或续接 light task，并以请求作为授权；C 需要方案确认、多 gate 或存在高风险面时创建或续接 standard task，展示 plan 后等待明确 approve。

## 7. 发布完成标准

本次全面 current 发布已满足 C1–C8：Actor、Light、Group、knowledge freshness、Context/benchmark、迁移与 R2 回退、文档入口和指令面均已同一发布边界交付。冻结 `0.1.0` CLI R2 smoke 作为兼容性 gate 保留在发布验证中。

## 8. 发布记录

2026-07-16 发布完成后，`docs/INDEX.md`、`docs/HANDBOOK.md`、`docs/DESIGN.md`、`docs/AI_INSTALL.md`、根 `AGENTS.md` 与 canonical Skill 均以本契约和触发章为 current 事实。

## 9. 残余风险

- 24k、8 步和 30% token 为默认参考值，观察期内可经独立 task 调整；
- Skill 的判定仍需以用户请求和 task 事实为依据；
- CodeGraph 未随本发布升级，聊天记录不进入产品真源。
