# Latch 最终产品契约（草案 r2 — 跨章 P1 修复）

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

Decision-Status: design-accepted (user confirmed complete design 2026-07-15; not INDEX current; not product approve)

Document-Status: **not** current product contract

Date: 2026-07-15

Revision: 3

Cross-chapter-verify: passed 2026-07-15 (P1 items 1–7 closed; item 5 uniqueness fixed).

User-confirmed: 2026-07-15 — complete design OK; design-accepted. INDEX/current not switched; no product code; implement via separate tasks.

Revised: 2026-07-15 — 对齐 provenance/R2/全面 current（含知识 Context 与 AI_INSTALL）。

## 0. 地位

- 最终契约**候选**入口；**current 仍为** `docs/prd/2026-07-10-latch-v2.md`。
- **基础 + 覆盖：** 最终 = **v2 保留条款** + 分章按主题**优先覆盖**（迁移章 §1）。未覆盖的 v2 条款（root、JSON、错误习惯、锁、archive、Board…）继续有效。

### 0.1 分章

| 章 | 路径 | 状态 |
|---|---|---|
| 触发/判定表/反馈/worktree | `docs/prd/2026-07-15-latch-workflow-triggers-draft.md` | candidate r2 |
| Actor | `docs/prd/2026-07-15-latch-actor-writer-affinity-draft.md` | design-accepted |
| Light | `docs/prd/2026-07-15-latch-light-proof-package-draft.md` | design-accepted |
| Group | `docs/prd/2026-07-15-latch-group-minimal-draft.md` | design-accepted |
| 知识/freshness | `docs/prd/2026-07-15-latch-knowledge-freshness-draft.md` | candidate r2 |
| Context/benchmark | `docs/prd/2026-07-15-latch-context-benchmark-draft.md` | candidate r2 |
| 迁移/CLI/发布 | `docs/prd/2026-07-15-latch-migration-cli-draft.md` | candidate r3 |

Actor/Light/Group **不重开产品取舍**；仅允许为消解硬冲突做交叉引用修补。

## 1. 产品一句话

个人本地 coding task 记录器：可追溯授权与验证，Git 模块知识 + 受预算 context pack；CLI+Skill 做 bookkeeping。

## 2. 核心对象

task（唯一可写生命周期）；events；primary_writer；group_id；模块知识 Markdown；context pack。

## 3. 生命周期摘要

```text
触发建 task → grill/判定表 → work_basis → dev/check → submit → review
                                                         ├─ 返工同 task
                                                         └─ 明确归档 → done
```

## 4. 阅读顺序

触发章 → 迁移/CLI → Actor → Light → Group → 知识 → Context。

## 5. 跨章不变量（硬）

1. **同一时刻**仅 `primary_writer` 可写该 task；允许跨会话**顺序** takeover（非同时共写）。  
2. group 无写门禁、无完成门禁。  
3. Core 结构/revision；Skill 语义；Core 不做 NLP 归档。  
4. task.json 提交点；非通用事务。  
5. knowledge_impact 在 submit（Light）；文档与 fingerprint 基线（知识）。  
6. stale/失败 adapter 不静默当 current。  
7. 不恢复 v1 knowledge DB；不默认向量栈。  
8. 日常不删 `.latch`；v3 events 有回退方案（迁移章）。  
9. **文档/skill 不超前未实现 CLI**；发布边界见迁移章 §7。

## 6. v2 关系

见迁移章 §1 与 §6：覆盖表 + 保留表。不是「六份分章替代 v2 全文」。

## 7. 完成标准（设计）

| 标准 | 含义 |
|---|---|
| 入口 + 全部分章 | 含触发章 |
| 无悬空引用 | 判定表 B、batch、触发、反馈、worktree 有章 |
| freshness/benchmark 可执行 | 基线字段与 bench schema 已定义 |
| 迁移可回退 | R1/R2 路径 |
| 发布边界一致 | 代码+文档+skill 同列车 |
| open_questions | 已决项已清 |
| **非**完成 | 代码已实现；INDEX 已切 current |

## 8. 确认后步骤（不自动）

1. ~~核验 7 项 P1~~ **已通过**（含 1/5/6 收紧与 events 唯一规则）。  
2. 用户确认完整设计。  
3. **实施 task**（approve）按 slice 交付。  
4. 每 slice **同发布边界**更新代码 + 必要文档/skill；全面 current 见迁移章最小集合。

## 9. 残余风险

- 24k / 步数 8 / 30% token 为默认与参考，观察期可调参；  
- Skill 松紧；CodeGraph 未升级；聊天不入真源。
