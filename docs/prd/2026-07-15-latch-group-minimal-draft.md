# Group 最小集（最终契约草案节）

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

Decision-Status: design-accepted

Document-Status: draft (Group chapter base for final PRD; not product-approved)

Date: 2026-07-15

Revision: 1

Accepted: 2026-07-15 — design-accepted (user proceed; not product approve).

依据：handoff 已锁定「group 只读聚合」；与 Actor、Light 设计-accepted 底稿配套。本节供并入最终 PRD，**不**替代现行已批准 v2 全文，直至最终 PRD 批准。

## 1. 目的与边界

### 1.1 目的

- 把「一批相关工作」（含 Bug Wave）用可选标签聚合，便于列表与只读浏览；
- 保持 **task 为唯一可写生命周期单元**；
- 防止知识章 / Context 章误引入 group 级 phase、批准或验证门禁。

### 1.2 非目标

- 无 group phase、outcome、revision、锁；
- 无 group 级 `approve` / `verify` / `submit` / `done` / `abandon`；
- 无 task 依赖图、父子批准传播、group 完成门禁；
- 无自动 Git commit / branch / worktree；
- 不替代 batch item（同对话共批仍是**一张 task 内**有条件路径；**权威定义见** `docs/prd/2026-07-15-latch-workflow-triggers-draft.md` §5；本节不展开 batch schema）。

### 1.3 责任拆分

| 角色 | 必须 | 不得 |
|---|---|---|
| Core | 持久化可选 `group_id`；按 id 过滤 list；在 context 中提供只读兄弟摘要与派生计数；校验 id 形态 | 因 group 阻塞或放行任一 task 的 approve/verify/submit/done |
| Skill | 建议/写入 `group_id`（如用户说「这批」）；路径重叠时建议串行；不得把「继续这张」扩大为全组 claim | 发明 group 状态机；用 group 等待代替单 task done |
| 用户 | 可选命名一批工作 | 被要求先建父 task 才能记小 bug |

## 2. 数据模型

### 2.1 字段

`task.json` 可选：

```ts
type TaskV2 = {
  // ...existing fields
  group_id?: string
}
```

规则：

- **缺省**：无 `group_id` 键 = 不属于任何 group（合法）。
- **空字符串 / 仅空白**：schema/file error，不得当作「无 group」或合法 id。
- **有值**：必须满足 §2.2；写入后可被 `save` 修改或清除（清除 = 删除键，不是写成 `""`）。

### 2.2 `group_id` 形态

```text
group_id = 非空字符串
推荐（非强制）：wave:YYYY-MM-DD-<slug>
  或  <tool-safe-slug>
```

Core 硬约束（最小）：

- 去除首尾空白后长度 ≥ 1；
- 不得包含 ASCII 控制字符；
- 建议最大长度 128（超出拒绝），避免无界键；
- **不**在 Core 解析 `wave:` 语义；`wave` 只是命名约定。

同一 `group_id` 字符串相等（精确匹配）即同组；不做别名或大小写折叠（除非最终 CLI 章另定归一规则；本章默认 **区分大小写精确匹配**）。

### 2.3 无独立 group 对象

- **不**存在 `group.json`、group revision、group events 真源。
- group 的成员关系 = 「open 或 archive 中 `group_id` 等于该字符串的 task 集合」的**派生视图**。
- 删除「group」= 各 task 去掉或改写 `group_id`；无级联销毁 task。

## 3. 写入与变更

### 3.1 何时可写 `group_id`

- `checkpoint` 创建时可带 `group_id`；
- 已有 task：通过 `save`（或等价）更新/清除，须 writer 门禁与 `--expect-revision`（Actor 节）；
- 不要求 group 内其它 task 的 writer 同意；
- **不**因写入 `group_id` 改变 phase、work_basis、verification、submission。

### 3.2 Bug Wave 操作约定（非新生命周期）

| 步骤 | 行为 |
|---|---|
| 开波次 | Skill/用户确定 `group_id`；**不**强制预建空 task |
| 逐 bug | 各建独立 task（多为 light），挂同一 `group_id` |
| 完成 | 各 task 独立 verify → submit → review → 明确 done |
| 一张 blocked | **不**阻止同组其它 task 推进或 done |

「先 group、task 随做随建」为默认建议；清单一次性展开为 N 张 task **不是**默认。

### 3.3 与 claim / takeover

- claim / takeover **按单 task** 执行（Actor 节）；
- 单张「继续 task X」**不得**扩大为组内全部 legacy claim；
- 批量 claim 须用户明示批量，且仍是**逐 task** 提交（Actor 节）。

## 4. 读路径

### 4.1 `list --group <group_id>`

- 返回 `group_id` 精确匹配的 task（默认仅 open；是否含 archive 由标志决定，默认 open-only）；
- 每条含至少：`id`、`title`、`phase`、`profile`（若有）、`revision`、`group_id`、blocked 否；
- 可附**派生计数**（非持久状态）：

```ts
type GroupListDerived = {
  group_id: string
  open_count: number
  by_phase: Partial<Record<'plan' | 'dev' | 'check' | 'review', number>>
  blocked_count: number
  done_archived_count?: number  // 仅当查询含 archive
}
```

- 派生计数**不得**作为任何写命令的门禁输入。

### 4.2 只读兄弟摘要

在 `context <task-id>`（及 brief JSON）中，若 task 有 `group_id`，可包含：

```ts
type GroupSiblingSummary = {
  task_id: string
  title: string
  phase: string
  blocked: boolean
  /** 路径提示：来自 plan/authorization scope.paths 或 artifacts 的截断列表，可空 */
  path_hints: string[]
}
```

规则：

- **只读**；不包含完整 plan、verification 细节、submission 正文、events；
- 条数可截断（建议默认最多 20，超出标记 truncated）；
- 用于减少上下文污染，**不是**合并验证集。

### 4.3 无参 `context` / current

- 不引入「current group」；
- current 仍是 per-actor 的 task id（Actor 节）。

## 5. 明确禁止的行为

Core 与契约文本均不得定义：

| 禁止 | 说明 |
|---|---|
| group approve | 不存在 |
| group verify / 共享 gate 集合 | 每 task 自有 verification |
| group submit / done | 每 task 独立；一张 done 不关闭其它 |
| 「group 全部 pass 才能 done」 | 违反 task 独立完成 |
| group 锁 / group revision | 无 |
| 因同组 blocked 拒绝本 task 的 done | 禁止 |
| 自动把路径重叠 task 并入同一 group | Skill 可建议，Core 不强制 |

## 6. 与 Light / Actor / 知识 / Context 的边界

| 章 | 关系 |
|---|---|
| Actor | 写 `group_id` 仍受 primary_writer / session actor 约束 |
| Light | 证明包、submit→review、done 均在 **task** 上；group 不出现在证明包硬门禁 |
| 知识章 | 可建议「同 group 多张 `none` 后人工补一页文档」；**不得**要求 group-level knowledge_impact 或 deferred_wave |
| Context 章 | 可把兄弟摘要纳入 pack 预算；**不得**因 group 放宽单 task 证明包或共享 authorization |

## 7. 迁移

| 对象 | 行为 |
|---|---|
| 旧 task 无 `group_id` | 合法，保持无组 |
| 非法空字符串 | 读时 schema error；迁移命令可删除该键 |
| 无历史 group 表 | 无需迁移 group 实体 |

不删除 `.latch`；不静默改写 title 冒充 group。

## 8. 命令面（逻辑）

| 操作 | 行为 |
|---|---|
| `checkpoint … --group <id>` | 创建时设置 `group_id` |
| `save … --group <id>` / `--clear-group` | 更新或删除键；expect_revision；不改 phase |
| `list --group <id>` | 过滤 + 可选派生计数 |
| `context <id>` | 可含 siblings 摘要 |

具体 flag 命名以 CLI 总章为准；行为须等价。

## 9. 错误示例

```text
Invalid group_id: empty string.
```

```text
Invalid group_id: exceeds max length 128.
```

```text
Save denied: cannot set group completion gates.
```

（最后一条若实现误加 group 门禁 API 时使用；正常最小集无该命令。）

## 10. 一致性摘要

- `group_id` = 可选字符串标签，精确匹配聚合；
- 无 group 对象、无 group 生命周期、无 group 写门禁；
- list/context 只读视图 + 派生计数；
- 单 task 独立 done；一张 blocked 不拖死同组；
- 知识/Context 章不得把状态上收为 group 级。
