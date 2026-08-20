# 触发、判定表、反馈与 worktree

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

Decision-Status: approved

Document-Status: current component of `2026-07-15-latch-final-product-contract.md`

Date: 2026-07-15

Revision: 7

Released: 2026-07-16 — 全面 current 发布。

Updated: 2026-07-28 — 修订多 gate 判定与 Light 中途重新分类规则。

Updated: 2026-08-03 — current task writer 更新为 schema 5。

Updated: 2026-08-14 — 增加 canonical Skill 激活前提，区分用户级可发现与 repo 采用；普通 repo 写入不再单独触发 Latch。Source-Task: `20260814031650489-收窄-latch-全局-skill-触发并兼容-cc-switch-管理-4ea1d4`。

Updated: 2026-08-20 — 将 `.latch` / 普通写入与必须创建 task 解耦；支持 Latch 后按 enable 条件创建，低风险单会话直做。Source-Task: `20260820071601760-调整-latch-激活策略-低风险直做-高风险与跨会话才建-task-09778d`。

**定位：** 承接 handoff 用户流程中尚未落入分章的可执行规则；Light 章「判定表 B」、Group 章「batch 委托」以本节为准，不重开 Actor/Light/Group 已定产品取舍。

## 1. 目的与边界

### 1.1 目的

- 规定何时自动建 task / 跳过；
- 规定「够不够做」判定表（含 Light 请求即授权 B 档）；
- 规定同对话 batch item 的有条件路径；
- 规定用户反馈与 review 返工入口；
- 规定 worktree 重叠建议与 `provenance: mixed`。

### 1.2 非目标

- 不恢复「所有写入都建 standard 全流程」；
- 不引入 task 依赖图；
- 不自动创建/合并/删除 worktree（除非项目预先授权创建，且 merge 等仍单独授权）。

## 2. 任务触发（Skill + 用户）

### 2.1 Skill 激活前提

用户级 canonical Skill 只有命中以下至少一项时才激活：

- 项目 `AGENTS.md` 明确接入 Latch；
- repo root 已存在 `.latch`；
- 对话正在继续已知 Latch task；
- 用户显式请求 Latch 或 project-local Record 操作。

普通 repo 仅因请求会写文件、修 bug 或改变可观察行为，不运行 Latch startup，不调用
`list`，也不询问是否初始化。若唯一未知项是 `.latch` 是否存在，只读检查该路径；不得
用 `list` 作为激活探针。

### 2.2 支持后按需创建

项目接入或 repo root 已存在 `.latch` 只表示项目支持 Latch，并授权冷启动廉价探测；二者都不能单独创建 task。普通写入、修 bug 或改变可观察行为，不单独创建 task。减少的是 task bookkeeping，不是必要验证。

低风险、局部、单会话请求直接读取相关事实、完成最小完整修改、运行最窄权威验证并检查 diff。风险不得只按代码行数或文件数判断。

以下任一条件成立时，Skill **应**创建或续接 Latch task（再按 A/B/C 选择 light 或 standard）：

- 用户明确要求使用、保存或恢复 Latch task
- 已知 Latch task 的续接、review、closeout 或跨会话恢复
- 多个独立验收面
- 目标、根因、方案或产品选择需要确认
- 修改公共 API、兼容契约、认证、权限或其他信任边界
- 修改持久化数据、schema、迁移、并发或一致性语义
- 存在不可逆或难恢复的外部副作用
- 影响面广、回归代价高，或预计需要跨会话
- 需要 workspace proof、revision、stale-proof 或结构化 unverified items

### 2.3 不建

| 情况 | 行为 |
|---|---|
| 用户明确「这次不用 Latch」，且无已知 continuation 或 closeout 责任 | 本轮不建、不写 task |
| 用户明确「这次不用 Latch」，但存在已知 continuation 或 closeout 责任 | 继续 Latch，不可绕过 |
| 纯问答、只读探索 | 不建 |
| 普通写入且未命中 §2.2 enable 条件 | 直做并验证，不建 |
| 用户只要看状态 | `list` / `context`，不建 |

### 2.4 与显式 Latch 请求

显式 Latch 请求直接进入本章的 A/B/C 判定，但不是唯一入口；已知 task continuation 同样必须进入。项目接入或已有 `.latch` 只表示支持 Latch，不单独进入本章。没有支持信号时，普通写入请求不进入本章。

### 2.5 信息不足

先 grill / 写 `open_questions`，**不实施**；可先建 task 记录已知/未知（Light 章）。

## 3. 判定表（可操作）— 权威定义

先判 **能否实施**，再判 **light 还是 standard**。borderline → 默认多问一句。

### 3.1 A — 必须停下 grill（不得实施）

命中任一条：

| 信号 | 例子 |
|---|---|
| 目标不清 | 「优化一下表格」 |
| 成功标准不清 | 不知怎样算修好 |
| 范围可大可小 | 「搜索有问题」未指哪种 |
| 要猜产品偏好 | 文案、默认行为、兼容策略 |
| 根因未收敛且改法未指定 | 只描述现象 |
| 存在设计取舍 | 性能 vs 正确性等 |
| 高风险面且无明确改法 | 认证、迁移、公共 API、数据删除 |

### 3.2 B — 可以 light + 请求即授权

**须同时满足：**

| 条件 | 说明 |
|---|---|
| 改法可复述 | 能钉成「改什么行为/哪个点」 |
| scope 可钉死 | 文件/组件/行为边界可写进 authorization.scope |
| 低风险 | 不碰认证/迁移/公共契约/数据销毁 |
| `open_questions` 空 | 本轮阻塞问题已清空 |
| AI 不扩 scope | 实施不超出用户原话 |
| 验收面单一 | 可同时配置 lint、typecheck、build、文档索引等多个机械检查 |

→ 写入 `implementation_authorization` 且 `source=user_request`（Light 章结构）。

### 3.3 C — standard（展示 plan → 明确 approve）

目标足以写出完整方案，但需要方案确认，或存在多个独立验收面、产品选择、公共契约或高风险面时：`profile=standard`，`source=user_approve`。

gate 数量不是 profile 信号。多个 lint、typecheck、build、文档索引或其他机械检查如果共同证明同一个边界明确、低风险的验收面，不单独触发 Standard；多个命令分别证明独立验收面，或任务包含产品选择、公共契约或高风险面时，才进入 C。Core 不统计 gate 数量，也不根据命令名称或语义自动选择或升级 profile。

### 3.4 Light 中途重新分类

Light task 出现 plan change、产品选择或 scope 扩大时，立即停止沿用原分类和 authorization，并重新执行 A/B/C 判断：

- 重新满足 B：可保持 Light，但 plan 变化仍按 Light 章使旧 authorization 失效，并通过新的请求或精确 delta 重新授权；
- 命中 A：保持在 plan，记录阻塞问题并继续 grill，不实施；
- 命中 C：升级 Standard，展示更新后的完整 plan 并等待明确 approve。

发现要猜、越界、产品选择或 scope 扩大时，不得只因现有 gate 已通过而继续实施。Core 只执行 Skill 请求的结构化 plan/profile 变化，不负责上述语义判断。

### 3.5 「按推荐方案」

Skill 将选取写入 plan 与 authorization.reason；仍须合法 scope；Core 只见结构。

## 4. Delta 授权

- 用户给出**精确低风险增量**且 plan 可能微调：`source=user_delta` 的 authorization（经 `approve` 通道落盘，Light 章）；
- 绑定当时 `plan_revision`；plan 再变则失效；
- 不替代 grill：模糊「顺便也改改」走 A 或 C。

## 5. 同对话 batch item（有条件）

### 5.1 何时允许

**仅当同时：**

1. **同一对话**；
2. 用户在**同一条消息或紧邻确认**中一次给出多项，并要求一起做/一起批；
3. 共同批准边界清楚。

### 5.2 模型

- **一张** task（通常 light 或 standard 一张 plan）；
- plan 内用有序列表描述多项（`scope`/`acceptance` 分条）；
- **一个** work_basis、**一套** verification_plan、**一次** submit/review/done；
- **不是** item 级独立 revision/锁（已否决隐藏 task tree）。

### 5.3 何时禁止

- 跨对话 → 多 task + 可选 `group_id`；
- 条目分开发送 → 各建 light；
- 一项 blocked 需要独立归档语义 → 拆 task。

### 5.4 与 Group

Batch item ≠ group。Group 只标签聚合多 task（Group 章）。

## 6. 用户反馈

| 类型 | 行为 |
|---|---|
| review 实现修正 | `work_revision+1`，phase→dev（Light 章矩阵） |
| plan/profile 变化 | plan_revision+1，phase→plan |
| 纯评价 | 不改状态；可记 `review_feedback` / decision |
| 负面反馈短记录 | 回显；可撤销（skill 约定）；CLI 可记 objective fallback |

反馈**不**自动 done；不伪造批准史。

### 6.1 用户可读记录

Latch 保存任务事实摘要，不保存完整聊天记录。grill 阶段只记录阻塞问题和关键决定，不记录每轮追问。

AI 写入 `review_feedback`、`decision_recorded`、submission 和 closure 时，默认先分类再总结。用户可见摘要应说明：

- 发生了什么；
- 为什么需要记录；
- 对实现、验证或归档有什么影响；
- 下一步需要做什么。

默认摘要不得直接裸露 `plan_revision`、`work_revision`、`knowledge_impact`、`artifact_refs`、`frontmatter`、`implementation_correction`、`non_implementation_correction` 等内部字段。需要追溯时，通过原始 event 或详情层查看这些字段。

Core 只做确定性投影，不用自然语言判断反馈真实含义。Skill 负责判断反馈分类和摘要表述；若影响不确定，先诊断并询问一个具体问题。

## 7. Worktree 与并发路径

### 7.1 规则

| 情况 | 行为 |
|---|---|
| 路径不重叠的多 task | 可共用 worktree；approve 可带非阻塞 warning |
| 路径可能重叠 | Skill 建议：串行、新 worktree、或等待 |
| 用户明确并行重叠 | 允许，但必须按 §7.2 将 task 根 **`provenance` 设为 `mixed`** |
| 创建 worktree | 仅当项目预授权或用户当次授权；**merge/rebase/push/删 branch/移除 worktree** 始终单独授权 |

### 7.2 `provenance`（唯一真源）

**唯一存放位置：** `task.json` 根字段（当前事实）。

```ts
// task.json
provenance: 'clean' | 'mixed'   // 必填于 schema 5 新写入；historical 读缺省 = clean
```

| 规则 | 规定 |
|---|---|
| 真源 | **仅** `task.provenance`；**禁止**在 `submission` / `closure` 再存第二份权威值 |
| 缺省（读旧数据） | 键缺失 → 视为 `clean` |
| 新写入 | schema 5 task 创建时写 `clean`；除非立即已知 mixed |
| 置 `mixed` | Skill 在用户**明确** override 路径重叠并行时，经 `save`/等价写命令更新 `task.provenance = mixed`（须 writer + expect_revision）；记 decision 或短 event 可选 |
| 冲突 | 若实现误在 submission 携带 provenance 字段：**忽略**，以 `task.provenance` 为准；不得用 submission 覆盖 task |
| 重置为 `clean` | **仅**当用户明确声明隔离已恢复（例如已串行化/已换独立 worktree 且确认无并行脏写）并经 Skill 写入；**不得**因 submit/done/verify/换 phase 自动清回 `clean` |
| done/archive | archive 快照**拷贝**当时 `task.provenance` 到归档 task.json；历史 submission 不另存权威 provenance |
| 门禁 | list/context 展示；**不**单独作 submit 硬门禁 |

Core 不解析 git diff 以推断 mixed。

approve 会检查全部其他活动 task。只要存在 `dev` 或 `check` task，始终保留共享
worktree warning；只有 `review` task 且 Git worktree clean 时不提示。review task
存在但 worktree 非 clean、或 Git status 无法获取时，继续返回可行动的非阻断 warning。
该判断不尝试把 Git 路径归属给具体 task，也不写入新的 lifecycle 真源。

### 7.3 与 primary_writer

- **同一时刻**仅 `primary_writer` 可写该 task（Actor）；
- 跨会话 **顺序** takeover 后新 writer 可写——不叫「同时共写」。

## 8. 判定表与 Light 交叉引用

Light 章凡写「判定表 B」均指 **本节 §3.2**。  
Group 章凡写 batch 委托，均指 **本节 §5**。

## 9. 一致性摘要

- 自动建 light 有客观信号；可跳过；发布时改 AGENTS/skill/AI_INSTALL；
- 判定表 A/B/C 按验收面与风险语义区分请求即授权和 Standard，机械 gate 数量不决定 profile；
- Light 出现 plan change、产品选择或 scope 扩大时重新执行 A/B/C，Core 不自动分类；
- batch 仅同对话共批一张 task；跨对话用 group+多 task；
- 反馈有矩阵；`provenance` 仅 task 根字段；同时仅 primary 可写。
