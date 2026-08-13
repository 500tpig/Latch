# Latch 0.5 流程与指令面收口契约

Source-Task: `20260813080446817-设计-latch-0-5-流程与指令面收口-73a486`

Document-Status: `approved`

Date: 2026-08-13

## 1. 地位与范围

本文件冻结 Latch `0.5.0` / schema 5 的第一轮 consolidation 契约，供后续独立
implementation task 使用。本文件不修改 CLI、Core、task schema、event schema、现有命令行为
或 Record，也不授权创建后续 task。

consolidation 只收紧普通 Agent 的默认控制面：主流程保持短而稳定，异常恢复由
`error.code` 和 `next_action` 按需揭示。现有 fail-closed Core、安全门禁、proof generation、
revision 检查和原子 CLI primitive 继续作为机器边界，不能用提示词约定代替。

本契约采用以下原则：

1. 默认说明只覆盖高频 happy path 和不可违反的安全边界。
2. 恢复规则在命中对应状态或错误后才加载，不进入每轮常驻上下文。
3. `next_action` 只表达一个立即动作，不承载完整 lifecycle 教程。
4. 能由 Core 拒绝的条件继续由 Core 拒绝，不把安全责任移回 Agent 判断。
5. 第一轮不增加新的顶层命令、lifecycle 例外或 proof 例外。

## 2. 冻结边界

### 2.1 保留的原子边界

以下 primitive 不合并：

- `takeover` 与 `approve`；writer 转移不等于实施批准；
- `verify-all` 与 `submit`；gate proof 不等于 review submission；
- `reopen-review` 与 `approve --feedback`；proof 失效恢复不等于 reviewer 要求实施修正；
- `reconcile` 与 `append-scope`；恢复原始工作区不等于扩大批准范围；
- Record 与 task；轻量记录不传播 task 状态、writer 或授权；
- `done` 与 Git；task closeout 不执行 add、commit、push、branch 或 worktree 操作。

不设计万能 `advance` 命令，也不通过 alias、wrapper、fallback 或双路径重新组合上述边界。

### 2.2 第一轮 compatibility

第一轮 implementation：

- 不删除、改名或弃用现有命令；
- 不改变 schema 5 的 fail-closed writer、authorization、revision、proof 和 workspace 门禁；
- 不为旧字段、旧命令或旧流程增加 fallback、双写、双读或自动迁移；
- 不把 schema 2–4 接回 current writer；historical task 继续只读；
- `next_action` 的 string → object 属于 JSON protocol breaking change，必须随 CLI `0.6.0` 和
  envelope `schema_version: 3` 一次性切换；CLI `0.5.x` 的 envelope 2 继续冻结为 string，禁止在
  `schema_version: 2` 下静默替换 shape；
- Latch repo 的 producer 与规范 fixture 在同一机器输出 slice 切换；Latch-Board 和 adopter 直接
  reader 按兼容矩阵分别使用独立 task 和独立授权升级，不保留同一 reader 同时接受 envelope 2 / 3
  的 fallback，也不把本仓 implementation task 扩成跨 repo rollout。

## 3. 默认 Agent happy path

### 3.1 唯一短主流程

默认流程冻结为：

```text
list/status → checkpoint/approve → verify-all → submit/review → done
```

斜线表示按 profile 或当前状态二选一，不表示必须连续执行两条命令。成功 mutation 返回的
`revision` 和 `next_action` 直接供下一步使用；除 revision conflict、用户输入边界、需要判断的
warning 或 task 语义变化外，不为 revision 或路由重复读取 `context`。

| 阶段 | Light | Standard | 用户输入边界 |
|---|---|---|---|
| 启动 | `list --json --brief`；仅有已知 task 或 `current_task_id` 时读 `context --status` | 同 Light | 无 |
| 建立 work basis | `checkpoint` 原子创建并绑定明确请求 | `checkpoint` 创建 plan，等待批准后执行 `approve` | Standard 等待实施批准 |
| 验证 | `verify-all` | `verify-all` | 无 |
| 提交 | `submit`，然后按需读 `context --review` | `submit`，然后按需读 `context --review` | 等待 review 决策 |
| closeout | 明确完成授权后执行 `done` | 明确完成授权后执行 `done` | 有未验证项时等待 closeout 决策 |

`verify` 只用于指定 gate、临时 command 或 diagnostic，不进入默认 happy path。`context --brief`
用于需要完整 plan、gate 或 submission 摘要的展开读取，也不进入默认 happy path。

### 3.2 调用与用户回合预算

调用数从一次用户请求触发的首次 `list` 开始，到 `done` 成功结束；CLI 重试、真实 gate 子进程和
显式 diagnostic 不计为 happy path，但任何默认要求的重复 `context` 必须计入。用户回合包含初始
请求、实施批准和 review / closeout 决策；同一回复能同时给出 review 与 closeout 事实时只计一次。

| Profile | CLI 调用上限 | 必需用户回合上限 | 基准序列 |
|---|---:|---:|---|
| Light | 7 | 2 | `list`、可选 `status`、`checkpoint`、`verify-all`、`submit`、可选 `review`、`done` |
| Standard | 9 | 3 | Light 序列加独立 `approve`；允许一次必要的 plan 展开读取 |

超过预算的流程必须证明属于 recovery、diagnostic 或明确的额外用户要求，不能把常规重复读取标记为
恢复成本。

## 4. Recovery router

Recovery router 只在默认命令失败、`next_action` 指向恢复，或用户给出 implementation feedback
时加载对应分支。优先级固定为：只读或 writer 状态 → blocked → proof / workspace → plan → 当前
phase。高优先级未处理前不预告低优先级 mutation；唯一允许的有界预告是
`after_takeover_next_action`，且只包含接管后的一个动作。

| 情况 | 稳定信号 | 立即路由 | 禁止行为 |
|---|---|---|---|
| writer mismatch | `error.code: writer_mismatch` 或 writer 状态不匹配 | 先等待明确 handoff / takeover 授权；授权后执行 `takeover`，再按 mutation 返回动作继续 | 不自动 takeover；不把 takeover 视为 plan approval |
| stale review | `error.code: proof_stale`；review submission proof stale | 当前 writer 执行 `reopen-review`，然后 `verify-all`、重新 `submit` | 不用 feedback 模拟 stale 恢复；不在 review 中刷新 gate 后复用旧 submission |
| workspace violation | `error.code: workspace_violation` | 若意外改动已精确恢复，执行 `reconcile`；若改动应纳入 scope，先等待 plan delta 批准，再执行 `append-scope`；无法判定时停在批准边界 | 不自动 rollback、stash、clean、reset、扩大 scope 或忽略 violation |
| plan delta | `open_questions`、scope / gate command 缺口或 material plan change | `open_questions` 先等待 plan input，再使用 `resolve-open-questions`；仅追加 scope 使用 `append-scope`；仅修改现有 gate argv 使用 `update-verification-command`；其余 material change 使用 `save --plan-file`，然后重新批准 | answers 不等于 implementation approval；不用一个 generic delta 猜测意图；不保留旧 authorization 或 proof |
| implementation correction | reviewer 决策或 dev/check 中的实现修正 | dev/check 直接修正后执行 `verify-all`；review 且 proof current 时，implementation feedback 使用 `approve --feedback` 返回 dev；纯说明使用 `approve --non-implementation-feedback` 留在 review | 不把 dev/check 修正伪装为 feedback；不把 stale proof 伪装为 implementation feedback |

`phase_mismatch` 表示调用方选择了当前阶段不合法的 primitive。router 读取 bounded status 后重新选择
当前阶段动作，不能通过 fallback 依次试命令。`command_failed` 只表示未分类异常，必须停止自动路由
并做有界诊断，不能解析英文 message 猜测恢复命令。

## 5. 命令分层

分层只决定默认可见性和文档入口，不改变命令是否存在，也不建立 alias。

### 5.1 高频主流程

- 发现：`list`、`context --status`；
- 建立计划与授权：`checkpoint`、`approve`；
- proof 与 review：`verify-all`、`submit`、`context --review`；
- closeout：`done`。

AGENTS.md 与 canonical Skill 的 happy path 只出现本层，以及 recovery router 的入口规则。

### 5.2 按需恢复

- writer 与 blocked：`takeover`、`save --unblock`；
- stale proof 与 violation：`reopen-review`、`reconcile`；
- plan delta：`append-scope`、`update-verification-command`、`resolve-open-questions`、
  `save --plan-file`；
- review correction：`approve --feedback`、`approve --non-implementation-feedback`；
- artifact 修复：`artifact add|remove`。

本层只在对应 `error.code`、`next_action` 或明确 reviewer 决策出现后加载。

### 5.3 专用能力

`init`、`use`、`save` 的 metadata / blocked / profile / provenance / group 变体、`abandon`、Record、
knowledge 和 group 查询属于专用能力。它们保留独立授权与现有原子语义，不进入 coding task 默认流程。

### 5.4 高级诊断

完整 `context`、`--brief`、`--history`、`--since-revision`、`context pack`、`benchmark context`、
单 gate `verify`、`--diagnostic`、`--verbose`、`--verbose-warnings` 和
`patch-submission-knowledge-impact` 属于高级诊断或精确修复。CLI help 保留可发现性，canonical
Skill 只给按需入口。

### 5.5 历史迁移

schema 2–4 的 `list` / 精确 ID `context` 是 current runner 的只读能力。既有 `claim`、
`upgrade-v4`、`downgrade-v2` 等版本绑定 primitive 归入历史迁移层，不进入 `0.5.0` 默认 help、
happy path 或 schema 5 recovery router，也不能由 current Agent 自动调用。第一轮只调整归属和
可见性，不删除、改名、弃用或扩展这些 primitive。

## 6. 信息归属

每条规范只能有一个完整定义位置。其他位置只保存一句摘要和链接，禁止复制命令矩阵、恢复配方或
产品理由。

| 载体 | 唯一职责 | 禁止重复 |
|---|---|---|
| repo `AGENTS.md` | repo 触发条件、A/B/C 选择、启动读取上限、授权边界、停止条件、项目验证底线 | 不保存完整 CLI 语法、异常分支步骤、Context 字段或产品设计理由 |
| canonical Skill | 默认 happy path、跨 repo 通用安全 invariant、`next_action` 使用规则、按需 reference 路由 | 不复制 HANDBOOK 命令参考、DESIGN 取舍、项目文档目录或每个 recovery 的完整配方 |
| Skill references | lifecycle、handoff、group、context、migration、Record 等低频分支的完整 Agent 操作配方 | 不各自重写启动流程、A/B/C、revision invariant 或同一命令语法 |
| CLI help | current 命令、参数、互斥关系和最短 usage；按层提供可发现入口 | 不承载 Agent 授权政策、产品理由、长篇恢复教程或历史叙事 |
| `HANDBOOK.md` | current 可观察行为、用户与实现人员的操作参考、错误码和恢复语义 | 不逐行复制 AGENTS / Skill，不承担长期产品取舍 |
| `DESIGN.md` | 产品定位、不变量、关键取舍、非目标和文档所有权 | 不保存逐命令语法、happy path 调用清单或 runbook |

本 consolidation brief 冻结变更目标和验收预算。实施完成后，current 行为仍以 HANDBOOK 和
DESIGN 的各自职责为准；brief 不成为第二份使用手册。

## 7. Token budget 与 bounded projection

### 7.1 统一口径

所有 `KB` 使用 `1024 bytes`。文本文件按磁盘原始 UTF-8 bytes 计算；CLI projection 按默认
`--json` 输出的 UTF-8 bytes 计算，包含最终换行，不使用 pretty-print 后的字符数、模型 token
估算或 gzip 大小。

预算是 hard gate：任何默认 bounded view 超过 1 byte 即失败。该约束依赖本节的逐字段和逐集合
上限，不允许对无长度上限的存储字段直接序列化后再声称由单个 fixture 证明 hard limit。

| 项目 | 上限 |
|---|---:|
| repo `AGENTS.md` + `skills/latch/SKILL.md` 完整文件 | 10240 bytes |
| `context --json --status` | 3072 bytes |
| `context --json --review` | 6144 bytes |
| `context --json --brief` | 8192 bytes |

常驻预算按两个完整文件相加，不以「核心段落」标签排除仍会默认加载的正文。frontmatter、标题、空白
和链接均计入。低频配方必须移入按需 reference，而不是用未执行的阅读约定继续留在常驻文件。

当前基线测量为 `AGENTS.md` 5922 bytes、canonical Skill 8651 bytes，合计 14573 bytes，尚不满足
10240-byte 目标。当前设计 task 的 status / review / brief 样本分别为 1577 / 5034 / 6545 bytes，
只证明普通样本未超限，不替代最坏情况 fixture。

### 7.2 字段上限

下表只约束 status / review / brief 的 projection，不修改 task 真源。`original_bytes` 统计截断前的
UTF-8 bytes。

| 字段类别 | projection 上限 | 截断要求 |
|---|---:|---|
| task ID | 256 bytes | task schema / generator 必须保证上限；超限视为无效 task，不截断 identity |
| actor / writer ID | 256 bytes / 值 | 在有效 UTF-8 边界截断；截断值只用于展示，不得回填 mutation 参数 |
| title | 256 bytes | 保留前缀，不添加省略号 |
| repo-relative path | 512 bytes / 值 | 保留前缀；完整 path 只通过精确诊断读取 |
| gate name | 128 bytes / 值 | 保留前缀 |
| artifact kind、enum、`error.code`、command、mode | 64 bytes / 值 | current producer 自身生成的值不得超限；超限视为 producer bug，不截断成另一个合法 token |
| warning、blocked reason、waiting-for、authorization reason | 256 bytes / 值 | 保留前缀 |
| submission changes、knowledge summary | 1024 bytes / 值 | 保留前缀 |
| open question、unverified item、resolution / feedback 摘要 | 512 bytes / 值 | 保留前缀 |
| `error.message` | 2048 bytes | 沿用 current error message 上限 |

所有文本按原始 UTF-8 bytes 截取到不拆分 code point 的最大前缀。projection 不插入 `...` 或其它
伪正文；是否截断只由结构化 metadata 表达。机器 token 超限不得截断后继续执行，因为截断可能把
未知 token 变成另一个合法 token。

### 7.3 集合上限与优先级

| View | 集合上限 |
|---|---|
| status | shared-worktree sample 4、live-change sample 4、artifact delivery 4、warnings 2；gate 只返回计数 |
| review | shared-worktree sample 4、live-change sample 4、artifact delivery 8、warnings 4、gate detail 8、unverified item / resolution 各 8 |
| brief | shared-worktree sample 8、live-change sample 8、artifact delivery 8、warnings 4、gate detail 16、open question 8、artifact 8、unverified item / resolution 各 8 |

集合使用既有稳定排序后取前 N 项，并同时返回 `total_count` 与 `returned_count`。review 的
unverified item / resolution 具有最高保留优先级；超过 8 项时，bounded view 明确标记截断，
closeout 调用方必须按需读取完整 advanced context 后再请求用户逐项决策，不能根据样本构造
`done --closeout-file`。

每个 bounded view 根级返回：

```json
{
  "truncation": {
    "applied": true,
    "fields": [
      { "path": "task.title", "original_bytes": 900 },
      { "path": "task.unverified_items", "total_count": 12, "returned_count": 8 }
    ]
  }
}
```

没有截断时省略 `truncation`。`fields` 使用最多 16 项的固定 projection-group path 词表，单个字段
必须归入 `identity`、`writer`、`plan_text`、`gates`、`submission`、`closeout`、
`shared_worktree`、`live_changes`、`artifact_delivery`、`warnings`、`error` 等既有 group；同一 group
的多个截断聚合为一项并累加计数，不能因 metadata 上限而漏报。列表按 path 排序，metadata 本身计入
view 总预算。

### 7.4 总预算 clamp

逐字段和逐集合上限后仍超过 view 总预算时，projection builder 按以下固定顺序移除可选内容，直到
满足预算：sample 正文 → warnings 正文 → artifact delivery detail → gate detail → plan 摘要 →
submission changes / knowledge 摘要 → unverified / closeout item 正文。review 中的 unverified /
closeout item 正文是最后移除的可选内容；一旦移除，调用方必须展开 advanced context。每次移除都
保留对应计数并写入 `truncation.fields`。

以下字段不可被总预算 clamp 移除：envelope / view version、task ID 的 bounded projection、phase、
task / plan / work revision、writer 状态、blocked 状态、gate 计数、unverified / resolution 计数、
proof freshness、`error.code`、typed `next_action` 和 `truncation`。这些 mandatory 字段应用本节上限
后的组合必须独立证明低于各 view 预算；否则 build 失败，不能在运行时返回超限响应。

规范最大 fixture 同时填满每个 view 可共存的字段上限、集合上限和 16 条 truncation metadata，
作为 byte regression gate。fixture 是逐字段上限的验证载体，不是无长度上限字段的替代证明。

### 7.5 预算失败处理

- 常驻文件超限：删除重复定义或移入已有按需 reference；不缩写安全语义，不创建新的常驻摘要层。
- Context view 超限：先移除非该 view 决策必需的复制字段，再缩短 bounded sample；不截断 task ID，
  不移除 `error.code`、`next_action`、revision、writer 状态、proof freshness 或 closeout 计数事实。
- happy path 超限：删除重复读取；不合并 primitive，不自动批准、submit 或 done。

## 8. Versioned `next_action` 契约

### 8.1 Breaking change 与 reader 边界

typed `next_action` 的 release contract 冻结如下：

| 项目 | 冻结值 |
|---|---|
| producer CLI | `0.6.0` |
| JSON envelope | 根 `schema_version: 3` |
| task schema | 继续为 `task_schema_version: 5`，不因 projection 变化升级 |
| event schema | 继续为 `events_schema_version: 3` |
| CLI `0.5.x` | envelope 2；`next_action` 保持 string，不回填 typed object |
| CLI `0.6.x` | envelope 3；`next_action` 只允许本节 object，不返回 string |

CLI `0.6.0` 的所有 `--json` 成功、error、list、context 和 mutation envelope 统一报告
`schema_version: 3`，避免同一 CLI 按 command 混用 envelope 版本。`--version --json` 同时报告
`cli_version: "0.6.0"`、`envelope_schema_version: 3` 和
`current_task_schema_version: 5`。task 存储未变化，因此 schema 5 数据不迁移、不双写。

Latch-Board 与 adopter direct reader 使用精确版本配对：

| Producer | Reader | 结果 |
|---|---|---|
| CLI `0.5.x` / envelope 2 | reader-v2 | 支持；读取 string `next_action` |
| CLI `0.6.x` / envelope 3 | reader-v3 | 支持；读取 typed `next_action` |
| CLI `0.5.x` / envelope 2 | reader-v3 | fail closed：`reader_version_mismatch` |
| CLI `0.6.x` / envelope 3 | reader-v2 | fail closed：`reader_version_mismatch` |

reader-v3 不接受 envelope 2，reader-v2 不接受 envelope 3。Latch repo 的 M1 冻结 envelope 3 规范
fixture 和 reader contract，但不修改任何外部 reader。Latch-Board、monitoring、appearance-sec 与
其他 adopter repo 分别通过独立 task、独立 scope 和独立授权消费该 fixture；每个 rollout 状态按
`ADOPTER_SYNC.md` 记录。producer 与对应 reader、安装入口尚未完成配对前，不得宣称该 adopter 的
rollout、同步或安装完成，也不能靠兼容 parser、字段探测或 string/object union 跨越切换窗口。

### 8.2 单一判别联合

envelope 3 的 `next_action` 采用单一 discriminated shape：

```json
{ "kind": "command", "command": "verify-all" }
```

```json
{ "kind": "await_user", "boundary": "approval", "reason": "implementation_plan" }
```

```json
{ "kind": "await_user", "boundary": "plan_input", "reason": "open_questions" }
```

```json
{ "kind": "stop", "reason": "historical_read_only" }
```

允许的 `kind` 只有：

- `command`：`command` 必须是 current CLI 中真实存在、对当前 task schema、writer、phase、
  authorization、revision 和 proof 状态合法的顶层命令；mode 只可用于区分现有合法形态，例如
  `{ "command": "approve", "mode": "feedback" }`；不得返回 `review_or_archive`、
  `prepare_closeout` 等伪命令，默认 gate 路由使用准确的 `verify-all`，不以 `verify` 作为含混别名；
- `await_user`：`boundary` 只能为 `plan_input`、`approval`、`review` 或 `closeout`，明确表示当前
  必须等待用户输入。`plan_input` 只收集 open question answers 或 clarification，不授予实施权限；
  `approval` 覆盖初始 plan、plan delta 和 takeover 授权；`review` 覆盖接受、反馈或继续验收；
  `closeout` 覆盖未验证项 resolution 与完成 / 归档授权；
- `stop`：用于 historical read-only、archive read-only、无 writable actor 或未分类异常，不暗示
  mutation。

`command` 只标识 primitive，不复制完整 argv。调用方从当前 task ID、revision 和已获得的结构化
用户输入构造参数；缺少必需输入时必须先返回 `await_user`，不能生成占位 argv。

### 8.3 lifecycle 封闭映射

映射按表格顺序求值，首个命中项生效。任何 open task 状态都必须落入一行；未知或内部不一致状态
返回 `stop`，不能回退到 string 或猜测命令。

| 优先级 | 当前状态 | envelope 3 `next_action` | 说明 |
|---:|---|---|---|
| 1 | archived / outcome 已写 | `{ "kind": "stop", "reason": "archived_read_only" }` | archive 不接回 mutation |
| 2 | schema 2–4、`legacy_unclaimed`、`schema_upgrade_required` | `{ "kind": "stop", "reason": "historical_read_only" }` | existing migration primitive 只供显式历史工具使用，不由 current router 推荐 |
| 3 | caller 无 writable actor | `{ "kind": "stop", "reason": "caller_read_only" }` | 不提示伪造 actor |
| 4 | writer mismatch | `{ "kind": "await_user", "boundary": "approval", "reason": "takeover" }` | 明确授权后调用 `takeover`；不继承 plan approval |
| 5 | blocked | `{ "kind": "stop", "reason": "blocked" }` | 等待 `waiting_for` 条件；事实满足后显式 `save --unblock` |
| 6 | plan 且 `open_questions.length > 0` | `{ "kind": "await_user", "boundary": "plan_input", "reason": "open_questions" }` | 获得完整 answers 后调用 `resolve-open-questions`；answers 本身不批准实施 |
| 7 | plan 且没有 open question | `{ "kind": "await_user", "boundary": "approval", "reason": "implementation_plan" }` | 明确批准后调用 `approve` |
| 8 | dev / check 且 gate fail、proof capture error 或 unresolved violation | `{ "kind": "stop", "reason": "implementation_diagnosis" }` | 修正或完成授权的 recovery 后再 `verify-all`；不自动重试 |
| 9 | dev / check 且 named gate pending 或 stale | `{ "kind": "command", "command": "verify-all" }` | 对当前 phase 和 proof 状态合法 |
| 10 | dev / check 且所有 gate current pass | `{ "kind": "command", "command": "submit" }` | 有 gate 的普通 submit |
| 11 | dev / check 且没有 gate、合法 no-verify plan | `{ "kind": "command", "command": "submit", "mode": "no_verify" }` | 调用方仍须提供具体 reason |
| 12 | review 且 submission 缺失或内部状态不一致 | `{ "kind": "stop", "reason": "invalid_review_state" }` | 有界诊断，不构造 closeout |
| 13 | review 且 submission proof stale | `{ "kind": "command", "command": "reopen-review" }` | writer mismatch 仍由优先级 4 抢占 |
| 14 | review、proof current、存在未验证项 | `{ "kind": "await_user", "boundary": "closeout", "reason": "unverified_items" }` | 同一用户决策包含 review 结论与逐项 resolution |
| 15 | review、proof current、没有未验证项 | `{ "kind": "await_user", "boundary": "review", "reason": "review_decision" }` | 接受、implementation feedback 或非实施说明三选一 |
| 16 | 其它未知组合 | `{ "kind": "stop", "reason": "invalid_task_state" }` | fail closed |

writer mismatch 与 stale review 同时存在时，主动作是优先级 4；允许附加：

```json
{ "kind": "command", "command": "reopen-review" }
```

作为 `after_takeover_next_action` 的唯一有界预告。接管后仍须重新派生状态，预告不授权执行。

`resolve-open-questions` 只收到 answers、未同时收到结构化 `user_approve` authorization 时，清空
问题并保持 `plan`；mutation 后的动作按优先级 7 返回
`await_user/approval/implementation_plan`。只有同一调用同时携带明确 `user_approve`，并通过完整
authorizable validation，才可原子建立 work basis 并进入 `dev`。clarification、问题答案、方向认可
或 `user_delta` 均不得解释为 implementation approval。

review 接受是调用方从用户回复获得的外部授权事实，不写入一个新的「accepted」phase，也不使
`next_action` 自动变成 `done`。只有用户明确授权完成 / 归档，且所有 closeout resolution 已具备时，
调用方才可直接执行 `done`。`review_decision`、`closeout` 回复或设计方向认可能单独存在，均不自动
构成 `done`、归档或 Git 授权。

### 8.4 适用位置与错误路由

status、成功 mutation JSON 和可恢复的 JSON error envelope 复用同一派生函数。禁止三处维护
不同词表。`after_takeover_next_action` 使用同一 shape，最多预告一个动作。

机器动作必须满足 100% phase legality：测试对每个 `kind: command` fixture 使用同一状态调用对应
primitive 的 preflight；如果调用仍返回 `phase_mismatch`，契约测试失败。需要用户输入的状态必须
返回 `await_user`，不得为了让 Agent 猜测而返回类似命令的字符串。

`writer_mismatch`、`phase_mismatch`、`proof_stale` 和 `workspace_violation` 必须在所有同类 Core
拒绝中使用稳定 `error.code`，不能由部分 command 返回领域 code、其他 command 返回
`command_failed`。未知异常继续使用 `command_failed`，但其 `next_action` 必须是 `stop`。

错误信息可说明具体路径、revision 或 proof，但 Agent 不解析英文 message 选择命令。需要在多个
合法 primitive 间作产品判断时，`next_action` 返回 `await_user`，错误 envelope 可提供有界
`options`，每个 option 仍必须映射现有 primitive；router 不自动试错。

## 9. 后续 implementation slices

本任务不创建以下 task。后续只规划两张边界互不重叠的 Standard implementation task：

1. **M1：Latch repo 内一次性切换机器输出面**  
   负责本仓 CLI `0.6.0` producer、envelope 3、稳定领域错误、typed `next_action` 封闭映射、status /
   review / brief 的字段上限与总预算 clamp、唯一规范最大 fixture、reader contract、producer 侧
   mismatch fixture，以及 HANDBOOK 的机器协议说明和 DESIGN 的 reader invariant。M1 独占本仓 Core
   projection、JSON formatter 和 machine fixture；不修改 Latch-Board、monitoring、appearance-sec
   或其他 repo，也不宣称任何外部 rollout 已完成。
2. **A1：一次性收缩 Agent 指令面**  
   负责 repo AGENTS、canonical Skill、Skill references、human CLI help 和相应 docs-skill / happy-path
   scenario tests；落实 10240-byte 常驻预算、命令分层、按需 reference 路由和 Light / Standard 调用
   与用户回合预算。A1 不修改 Core、JSON projection、machine fixture、Board 或 adopter reader，也不
   重新定义 M1 已冻结的错误码和 typed action。

M1 和 A1 都只属于 Latch repo。顺序固定为 M1 → A1，两张 task 分别展示 material plan 并取得实施
批准；本设计批准不授权任一 slice。两者不得再拆出一个重复修改 projection、fixture 或 reader
contract 的预算 task。每个外部 reader 与安装 rollout 继续按 `ADOPTER_SYNC.md` 创建独立 task 并
取得对应 repo 的独立授权；这些外部 task 不属于 M1 或 A1。

## 10. 验收结论

第一轮 consolidation 完成的判定条件为：普通 Agent 只需读取短主流程即可安全推进 happy path；
异常分支能由稳定错误码和单一 typed `next_action` 精确进入对应原子 primitive；常驻文件、三个
Context view、CLI 调用数和用户回合均有 UTF-8 byte 或场景 fixture 门禁；现有安全边界、命令集合、
Record/task 分离和 Git 独立授权保持不变。
