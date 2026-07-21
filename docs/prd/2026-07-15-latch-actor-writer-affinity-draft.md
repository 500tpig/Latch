# Actor、primary writer、claim 与 takeover

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

Decision-Status: approved

Document-Status: current component of `2026-07-15-latch-final-product-contract.md`

Date: 2026-07-15

Revision: 3

Released: 2026-07-16 — 全面 current 发布。

依据：handoff revision 28 及此前已锁定决定。本节供并入最终 PRD，**不**替代现行已批准的 v2 全文，直至最终 PRD 批准并废止冲突条款。

## 1. 目的与边界

### 1.1 目的

- 使跨会话对同一 task 的写入可区分、可拒绝、可转移；
- 防止多个对话在无明确意图时共写一张 task；
- 为旧 open task 提供不静默占有的首任 writer 绑定。

### 1.2 非目标

- 不提供安全认证、多租户隔离或防恶意伪造 actor；
- 不证明 opaque 会话标识在物理上唯一；
- 不检测会话是否仍存活（无 session liveness）；
- 不阻止其他进程修改共享 Git worktree 中的文件；Core 只控制 Latch task 写入。

### 1.3 责任拆分

| 角色 | 必须 | 不得 |
|---|---|---|
| adapter / skill | 为每个会话绑定稳定 opaque id；调用写命令前设置合法 `LATCH_ACTOR`；保证本工具内同会话同 id、异会话异 id | 依赖 Core 验证 id 真实性 |
| Core | 校验 actor 声明形态与写权限；强制 primary writer 门禁；执行 claim / takeover 的确定性规则 | 宣称能验证 opaque id 的物理真实性；将 affinity 当作安全边界 |
| 用户 | 在需要时给出继续 / 接手 / 批量接管等意图 | 被要求必须使用「claim」「认领」等内部术语才能迁移旧 task |

writer affinity 是**防误写的协作门禁**，不是认证机制。

## 2. Actor 声明

### 2.1 环境变量

- 写路径与依赖 current 的读路径以进程环境中的 actor 为准。
- 宿主 adapter 或 skill 应在启动 Latch 前设置：

```text
LATCH_ACTOR=<canonical-actor>
```

- 用户不得手工猜测或 export 该值来取得写权限。

### 2.1.1 通用 adapter 边界

- Core 只消费 `LATCH_ACTOR` 并校验 canonical 形态；新宿主接入不得通过新增厂商环境变量检测分支实现。
- adapter 只有在能从宿主运行时或协议获得稳定、每会话唯一的 opaque id 时，才可注入 `<tool>:session:<opaque-id>`。
- adapter 无法获得该 id 时不得注入退化 actor；该宿主只能执行 `list` 和带明确 task id 的 `context`。
- 不得以 `default`、随机 UUID、PID、机器名、工作目录或用户输入构造 opaque id。
- 已存在的运行时兼容映射不构成新宿主的接入模板；新集成应复用本节的 adapter 契约，而不是扩展 Core 的厂商识别。
- 当前发行的 CLI 将 Codex adapter 置于 Core 之前：仅当 `LATCH_ACTOR` 未声明且 Codex 提供稳定 `CODEX_THREAD_ID` 时，adapter 注入 `codex:session:<thread-id>`；显式空 `LATCH_ACTOR` 仍保持不可写。

### 2.2 Canonical 形态

可写 actor 必须匹配：

```text
<tool>:session:<opaque-id>
```

约束：

- `tool` 与 `opaque-id` 均非空；
- `opaque-id` 不得为 `default`（大小写按实现归一后比较，规范比较建议大小写不敏感于 `default` 字面量）；
- 不得使用旧示例形态 `codex:default:<thread-id>` 作为最终规范；实施时归一为 `codex:session:<thread-id>`。

### 2.3 不可写 actor（fail closed）

下列声明**不得**执行任何修改 task 的命令（含创建、save、approve、verify、submit、done、abandon、claim、takeover 等）：

- `unknown:default`
- `<tool>:default`（仅两段且第二段为 default）
- `claude:default`、`opencode:default` 及同类客户端级退化
- 无法解析为 `*:session:*` 的任意字符串
- 空 actor

### 2.4 无合法 session actor 时允许的命令

仅允许：

- `latch list`（及等价只读列表）；
- `latch context <task-id>`（必须显式 task id）。

禁止：

- 无参数 `latch context`（依赖共享 current，会跨会话串味）；
- 一切写命令；
- 依赖「当前 actor 的 current task」且会改变 state 或 task 的命令（含无合法 actor 时的 `use`）。

### 2.5 错误结果（写拒绝示例）

```text
Actor not writable: claude:default.
The host adapter must provide LATCH_ACTOR=<tool>:session:<opaque-id>.
```

```text
Actor required for context without task id.
Pass an explicit task id or set a session actor.
```

## 3. primary_writer 与派生状态

### 3.1 当前事实

`task.json` 增加可选字段（新 task 创建时必写）：

```ts
type TaskV2 = {
  // ...existing fields
  primary_writer?: string  // canonical session actor
}
```

- `primary_writer` 是**当前**主写方事实。
- 合法迁移态：字段**缺失**（旧文件未写该键）。不得用空字符串等假默认「补齐」。
- 字段**存在**但为空串、仅空白、非 canonical session 形态，或其它无法识别为合法 primary 的值：视为 **schema / file error**，拒绝派生与写入，不得当作 `legacy_unclaimed`。

### 3.2 派生状态 `legacy_unclaimed`

- `legacy_unclaimed` **不是** phase，不进入 `plan | dev | check | review`。
- 派生规则（须同时满足）：
  1. task 为 open（无 `outcome`）；
  2. `primary_writer` 键**缺失**（`undefined` / 未序列化该字段）。
- 下列**不是** `legacy_unclaimed`：
  - `primary_writer: ""` 或仅空白；
  - 值为 `claude:default` 等不可写形态；
  - 值为非 canonical 字符串。  
  上述情况报 schema/file error，阻塞写与 claim，直至人工或修复工具纠正文件。
- 列表与 context 可暴露派生标志（如 `writer_status: "legacy_unclaimed" | "claimed" | "invalid_primary_writer"`），供 skill 判断，但不新增生命周期 phase。

### 3.3 历史

- `writer_claimed`、`writer_taken_over` 仅写入 `events.jsonl`。
- 历史事件中的旧 actor 字符串（含 `*:default`）只作 provenance，不得自动转换为 `primary_writer`。

## 4. 写权限矩阵

设调用方 actor 为 `A`（已通过 2.2 可写校验）。

| 条件 | 允许的 task 写 |
|---|---|
| 新 task `checkpoint` | 创建时 `primary_writer = A` |
| open 且 `primary_writer === A` | 普通写命令（仍受 phase / revision / 其它门禁） |
| open 且 `legacy_unclaimed`（字段缺失） | **仅** claim；拒绝其它写 |
| open 且 `primary_writer` 为合法 canonical 且 `!== A` | **仅** takeover；拒绝其它写 |
| open 且 `primary_writer` 存在但非法 | **拒绝一切写与 claim/takeover**；schema/file error |
| archived（有 `outcome`） | 无写（既有归档只读规则） |

同 `primary_writer` 继续工作：不产生 takeover 事件。

## 5. 创建时绑定

`checkpoint`（或等价创建命令）在成功创建 task 时：

1. 要求可写 session actor `A`；
2. 将 `primary_writer` 设为 `A`；
3. `task_created`（或等价）事件的 `actor` 为 `A`；
4. 不得创建无 `primary_writer` 的新 open task。

## 6. Claim（首任 writer）

### 6.1 适用对象

仅 `legacy_unclaimed` open task。

### 6.2 语义

- 将 `primary_writer` 从缺失设为调用方 `A`；
- **不**改变 `phase`、`implementation_approval`、verification gates、`submission` 或 plan 内容；
- **不**构成 implementation approval；
- **不是**归档；之后仍可 takeover。

### 6.3 用户意图（skill 解释；Core 提供确定性命令）

算作 claim 授权：

- 用户明确要求继续、接手或处理**某张具体**的 `legacy_unclaimed` task；
- 且当前调用方已是可写 session actor。

不算：

- 仅查看、读取或报告状态；
- 无法确定具体 task id 的「继续 Latch」；
- AI 自行从 open task 列表中挑选。

不要求用户说出「claim」或「认领」。

### 6.4 执行行为

1. Skill 回显：将按本次继续请求把该 task 绑定到当前会话（主写方）。
2. 不追加额外确认往返。
3. 调用 Core claim（名称实施可定为 `latch claim` 或 `save` 子操作），要求：
   - 可写 session actor；
   - `--expect-revision`；
   - 目标 task 确为 `legacy_unclaimed`。
4. 成功时提交点与副作用（**非通用事务**，见 §8.1）：
   - 以 `task.json` 原子更新成功为 claim 提交点：`primary_writer = A`，`revision` 加一；
   - 随后追加 `writer_claimed` 事件；若 event 追加失败，**不回滚**已成功的 `task.json` writer 变更，返回 warning，可按修复策略补写 event；
   - 若调用方还要更新 current：在 task 提交成功后按锁序 `task -> state` 调用 `use`（或内联 state 更新）。state 失败时 **不回滚** writer；current 保持原状，可重试单独 `use`。

### 6.5 批量 claim

- 必须用户明确表达批量接管（或等价明确批量意图）；
- 单张「继续这张」不得扩大为全仓库 claim；
- **逐 task 提交**：每张 task 独立走 §6.4 提交点；允许部分成功；
- 返回逐项结果（成功 / 失败原因）；**不**因后一张失败而回滚已成功 claim 的 task；
- 不实现跨 task 事务。

### 6.6 事件 schema

```ts
type WriterClaimedEvent = {
  type: 'writer_claimed'
  task_id: string
  actor: string          // new primary_writer
  revision: number
  created_at: string
  reason?: string        // optional short note, e.g. continue-request
}
```

### 6.7 错误结果

```text
Task is legacy_unclaimed: write denied.
Claim this task after an explicit user continue/handle request for this task id.
```

```text
Task already has primary_writer: codex:session:abc.
Use takeover, not claim.
```

## 7. Takeover（转移 primary writer）

### 7.1 适用对象

open task 且已存在 `primary_writer`，且调用方 `A !== primary_writer`。

### 7.2 非对称用户意图

| 调用方相对 primary | 用户说法 | 行为 |
|---|---|---|
| 相同 | 继续 | 直接写；无 takeover 事件 |
| 不同 | 明确「接手 task X」「把 task X 切到当前对话」等 | **直接** takeover，不二次确认 |
| 不同 | 仅「继续 task X」 | 先只读恢复 context；告知当前 `primary_writer`；**询问一次**是否转到当前会话；用户明确同意后再 takeover |
| 不同 | 新对话、fork、交接或对话快满 | 先只读恢复 context；新 session 必须获得明确 takeover 授权；plan approval 不替代该授权 |
| 任意 | 仅查看状态 | 不 takeover |

### 7.3 语义

成功 takeover：

- `primary_writer` 从 `from` 改为 `to`（调用方 `A`）；
- 追加 `writer_taken_over`；
- `revision` 加一；
- **不**改变 phase、approval、gates、submission；
- **不**构成 implementation approval；
- 旧 writer 此后对该 task 的写入失败；
- 输出必须提示：旧会话可能仍修改共享 worktree；Latch 只能拒绝其对 task 的写入。

fork 或新对话均视为新 session。正常顺序交接中，旧 writer 停止写入后再完成 takeover，不构成并行工作，`provenance` 保持 `clean`；只有用户明确接受重叠并行时才写入 `mixed`。同一用户消息可同时明确授权 takeover 与当前 plan approval，但必须先完成 takeover、重新读取 revision，再执行 `approve`。

### 7.4 命令要求与提交点

- 可写 session actor；
- `--expect-revision`；
- 目标存在且 open，且当前 `primary_writer` 为合法 canonical 且与调用方不同；
- 提交点与 claim 相同（§8.1）：`task.json` 成功为提交点；event 或后续 state/`use` 失败不回滚 `primary_writer`；state 失败可重试 `use`。
- 锁顺序在涉及 state 时为 `task -> state`（先完成 task 提交，再改 state）。

### 7.5 事件 schema

```ts
type WriterTakenOverEvent = {
  type: 'writer_taken_over'
  task_id: string
  actor: string          // performing actor, equals `to`
  revision: number
  created_at: string
  from: string           // previous primary_writer
  to: string             // new primary_writer
  reason: string         // short machine/human reason, e.g. explicit-handoff | continue-confirmed
}
```

### 7.6 错误结果

```text
Writer mismatch: primary_writer is codex:session:abc, caller is claude:session:xyz.
Continue read-only, or takeover with explicit user handoff / confirmed transfer.
```

```text
Task changed: expected revision 12, current revision 13.
Changed by: codex:session:abc.
Run latch context <id> --json --brief and retry.
```

## 8. state.current、锁顺序与提交点

### 8.1 提交点（不实现通用事务）

Latch 不实现跨文件通用事务。claim / takeover 与既有 v2 多文件规则一致：

1. **`task.json` 原子替换成功** = writer 变更的提交点（含 `primary_writer` 与 `revision`）。
2. **`events.jsonl` 追加**在 task 提交之后；失败时**不回滚** task.json；命令应返回 warning（或可诊断错误码 + warning），并允许后续修复补写事件。
3. **`state.json` / `use`** 在 task 提交之后；失败时**不回滚** writer；current 保持失败前状态，调用方可重试 `use`。
4. 需要同时动 task 与 state 时，锁顺序固定为：

```text
task -> state
```

不得将 claim/takeover 描述为「task 与 state 事务性一并成功或一并失败」。

### 8.2 `use` 与 current

- `state.json` 仍按 actor 键保存 `current_task_id`。
- actor 键必须是合法 canonical session actor 字符串；不得将旧 `*:default` current 自动映射到新 session actor。
- `use` **必须**具备合法 canonical session actor（与写 task 同一可写标准）。
- `use` **不要求**该 actor 已是目标 task 的 `primary_writer`。
- `use` 只修改 state，不修改 task revision，**不授予** primary_writer 或写权。
- 无合法 session actor 时拒绝 `use`（避免 `*:default` 污染 state 键空间）。

## 9. 迁移

### 9.1 原则

- 原地兼容：保留既有 `.latch` task、events、archive；
- 失败则停，不删除 `.latch`；
- 禁止用错误默认「补齐」`primary_writer`。

### 9.2 规则

| 对象 | 行为 |
|---|---|
| 新 task | 创建时写 `primary_writer` |
| 旧 open **缺** `primary_writer` 键 | 视为 `legacy_unclaimed`；普通写拒绝；经 claim 绑定 |
| 旧 open 有非法 `primary_writer` 值 | schema/file error；不按 legacy 处理 |
| 旧 archive | 只读；不补 `primary_writer` |
| 旧事件 actor | 仅 provenance |
| 旧 `state.json` actors 键为 default 等 | 不自动映射；新会话显式 `use` / claim 后重建 current |

### 9.3 否决

- 继承 `claude:default` 等为 `primary_writer`；
- 静默 first-writer-wins（第一位合法 actor 自动占有）。

### 9.4 验收样本

task `20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1`（历史事件含 `claude:default`）在 S0 实施验收中必须覆盖：

1. 升级后为 `legacy_unclaimed`；
2. 普通写失败；
3. 用户「继续该 task」+ 合法 session actor → claim 成功；
4. 另一 session 「继续」→ 不直接写，走 takeover 确认路径；「接手」→ 直接 takeover。

## 10. 废止的 v2 条款（并入最终 PRD 时）

下列现行 v2 表述与本节冲突，最终 PRD 批准时废止或替换：

- 允许客户端级 actor 退化并在 warning 后继续写 task；
- actor 仅作 current 键与事件追溯、**不**进入 task 主写方事实（本节以 `primary_writer` 为当前主写事实）；
- 无参数 context 在无会话级 actor 时仍可依赖共享 current 的隐含允许（若有）。

## 11. 事件类型扩展

在既有 `TASK_EVENT_TYPES` 中增加：

- `writer_claimed`
- `writer_taken_over`

二者均递增 task `revision`，并遵循既有 event 追加与 task 提交点规则。

## 12. 命令面（逻辑）

实施可将下列逻辑映射为独立子命令或现有命令标志；行为必须等价。

| 逻辑操作 | 前置 | 成功效果 |
|---|---|---|
| `checkpoint` | 可写 actor | 新 task + `primary_writer` |
| `claim` | 可写 actor；字段缺失之 legacy；expect_revision；用户继续意图（skill） | task.json 提交 `primary_writer`；再 event；可选其后 `use` |
| 批量 `claim` | 用户明示批量；同上逐张 | 逐 task 提交；部分成功；无跨 task 回滚 |
| `takeover` | 可写 actor；已有其他 primary；expect_revision；接手或已确认继续 | 更新 `primary_writer`；`writer_taken_over` |
| 其它写 | 可写 actor 且 `primary_writer === caller` | 既有语义 |
| `list` | 无 | 只读 |
| `context <id>` | 无（无合法 actor 时仍可读该 id） | 只读；可含 `writer_status` |
| `context`（无 id） | 可写 session actor（以解析 current） | 只读当前；无合法 actor 则拒绝 |
| `use` | 可写 session actor | 只改 state |

## 13. 一致性摘要

- `legacy_unclaimed` = open 且 **`primary_writer` 键缺失** 的派生状态，非 phase；非法字段值是 schema error，不是 legacy。
- 当前事实在 `task.json.primary_writer`；历史在 events。
- claim / takeover 均不改 phase、approval、gate、submission。
- 提交点是 `task.json`；event/state 失败不回滚 writer；锁序 `task -> state`。
- `use` 必须合法 session actor，但不授予写权。
- Core 验声明与权限；adapter 保证会话 id 质量。
