# Latch 轻量 lifecycle delta CLI 契约

Source-Task: `20260812100351819-设计轻量-lifecycle-delta-最小稳定-cli-契约-ee1a38`

Document-Status: approved

Date: 2026-08-12

## 1. 目的与边界

本设计为三类窄 plan 变更提供独立 CLI，并引用已交付的 workspace violation
恢复命令。四项能力不得合并为 `simplify`、`patch`、`delta` 等通用命令：

1. `append-scope`：只向 `plan.workspace_scope.paths` 追加路径；
2. `update-verification-command`：只按现有 gate name 修改 `command`；
3. `resolve-open-questions`：一次精确解决当前全部 `open_questions`；
4. `reconcile`：只按既有 violation evidence 恢复已精确还原的 violation。

前三项减少重写完整 12 字段 plan 的机械成本，不降低 plan change、authorization、
revision、proof 或 submission 门禁。`goal`、`acceptance`、自然语言 `scope`、公共契约、
产品范围、user flow、assumption、out-of-scope 或 verification gate 集合发生变化时，
仍使用完整 `save --plan-file`。本设计不提供任意 JSON Patch、字段选择器、删除、重命名、
默认答案、force、ignore、fallback、别名或临时兼容命令。

本任务只冻结产品与 CLI 契约，不修改 Core、CLI、测试或 canonical Skill。

## 2. 共同契约

### 2.1 命令和输入

新增命令使用 flat top-level 名称，不增加通用 `plan patch` 子系统：

```bash
latch append-scope <task-id> \
  --expect-revision <revision> \
  --path <repo-relative-path>... \
  [--authorization-file <path|->] [--json]

latch update-verification-command <task-id> \
  --expect-revision <revision> \
  --name <existing-gate-name> \
  [--authorization-file <path|->] [--json] \
  -- <command> [arg...]

latch resolve-open-questions <task-id> \
  --expect-revision <revision> \
  --answers-file <path|-> \
  [--authorization-file <path|->] [--json]

latch reconcile <task-id> --expect-revision <revision> [--json]
```

`append-scope` 的 `--path` 可重复，至少出现一次。成功输出和 event 使用校验后的
normalized path。`update-verification-command` 的 `--` 后至少有一个 argv；CLI 不经过
shell，也不接受 command string。
`resolve-open-questions` 的答案只从结构化文件读取，不接受重复的 inline
`--question`、`--answer` 或 `--decision`。

前三项不得与 `--plan-file`、`--reason`、`--authorize-request`、
`--retrospective-file`、feedback、artifact、block、profile、provenance 或 group
参数组合。`reconcile` 的参数保持 current 实现，不接受 path、violation ID、ignore、
force 或 authorization 参数。

### 2.2 Schema、writer、revision 与 phase

| 项目 | `append-scope` | `update-verification-command` | `resolve-open-questions` | `reconcile` |
|---|---|---|---|---|
| task schema | 只写 schema 5 | 只写 schema 5 | 只写 schema 5 | 已交付：只写 schema 5 |
| minimum writer | `0.5.0` | `0.5.0` | `0.5.0` | 已交付：`0.5.0` |
| profile | Light / Standard | Light / Standard | Light / Standard | 已交付：Light / Standard |
| writer | 仅 current `primary_writer` | 仅 current `primary_writer` | 仅 current `primary_writer` | 已交付：仅 current `primary_writer` |
| phase | `plan/dev/check/review` | `plan/dev/check/review` | 仅 `plan` | 已交付：仅 `dev/check` |
| blocked | 拒绝 | 拒绝 | 拒绝 | 已交付：拒绝 |
| revision | 必填且精确匹配 | 必填且精确匹配 | 必填且精确匹配 | 已交付：必填且精确匹配 |

前三项的全部输入、post-delta plan、optional authorization 和 authorizable 条件必须在
task mutation 前完成校验。成功 mutation 只增加一次 task `revision`；任何拒绝不得写
task、event、state 或 workspace evidence。revision conflict 返回后先刷新 status，
不得自动重试。

### 2.3 显式 authorization

前三项可选择 `--authorization-file <path|->`，把 delta 保存与 post-delta plan 授权合并
为一次 task mutation。文件必须是现有 `implementation_authorization` input：

```json
{
  "kind": "implementation_authorization",
  "source": "user_delta",
  "reason": "用户明确批准该 delta 后的当前 plan",
  "scope": {
    "summary": "实施当前 plan 及本次明确 delta"
  }
}
```

允许的 `source` 只有：

- `user_delta`：mutation 前已有绑定 current plan revision 的有效 implementation
  authorization 或 legacy Standard approval；
- `user_approve`：用户明确批准完整的 post-delta plan。

`append-scope` 和 `update-verification-command` 可使用满足上述条件的任一 source。
`resolve-open-questions` 只接受 `user_approve`：含 open question 的 current plan 不能持有
有效 authorization，因此回答问题不能伪装为既有授权上的小 delta。

`user_request`、retrospective 和缺少结构化文件的 Agent 意图均不构成授权。命令名称、
成功保存 delta、答案内容、自然语言 reason、聊天中的执行倾向和
`work_basis.scope.paths` 都不得替代 authorization。机器 scope 始终来自 post-delta
`plan.workspace_scope.paths`；authorization 的 `scope` 只保存授权摘要。

提供 authorization 时，Core 先校验 post-delta plan 可授权，再将输入 materialize 为
绑定新 `plan_revision` 的 `work_basis`。未提供 authorization 时，命令只保存 delta 并
停在 `plan`；即使 mutation 前已有有效授权，也不得推断为 post-delta authorization。

### 2.4 共同 lifecycle 变化

前三项都是 plan change，成功后具有以下共同结果：

| 字段 | 未提供 authorization | 提供有效 authorization |
|---|---|---|
| task `revision` | `+1` | `+1` |
| `plan_revision` | `+1` | `+1` |
| `work_revision` | 不变 | `+1` |
| `phase` | `plan` | `dev` |
| `work_basis` | 保留旧值作为历史，但因绑定旧 `plan_revision` 而失效 | 替换为绑定新 `plan_revision` 的 materialized authorization |
| legacy `implementation_approval` | 删除 | 删除 |
| `verification.gate` / `verification.diagnostic` | 清空 | 清空 |
| `submission` | 删除 | 删除 |

每项 mutation 先追加一个 `plan_updated` event，event 与 task 使用同一新 revision，字段为
`plan_revision`、`change` 和该命令定义的 delta 摘要。question resolution 的
`decision_recorded` 按 answers 顺序紧随其后。提供 authorization 时，同一 revision 最后
追加 `implementation_authorized` 和 `work_started`；`work_started` 保存新
`work_revision`。不增加新的 event type，`events_schema_version` 保持 `3`。

`next_action` 继续从 mutation 后的 current task 派生，不硬编码：

- 未授权且仍有问题：`resolve_open_questions`；
- 未授权且 plan 可批准：`approve`；
- 已授权且存在未通过 gate：`verify`；
- 已授权、Standard 且无 gate：`submit`；
- writer、blocked 等更高优先级状态继续覆盖上述结果。

### 2.5 JSON 和 human formatter

前三项成功 JSON 复用 current mutation envelope，不创建第二套 formatter。共同字段冻结为：

```json
{
  "schema_version": 2,
  "generated_at": "<ISO-8601>",
  "task_id": "<task-id>",
  "previous_revision": 4,
  "revision": 5,
  "phase": "plan",
  "plan_revision": 2,
  "work_revision": 1,
  "authorization_applied": false,
  "next_action": "approve",
  "shared_worktree": {},
  "warnings": []
}
```

存在 active proof 投影时沿用 current `workspace_proof` 可选字段。命令特有字段见后续各节。
JSON success 只写 stdout；warning 和 JSON error envelope 只写 stderr。human success 写
stdout，warning 写 stderr。human 输出不打印 authorization 文件正文、答案正文、完整
workspace evidence 或 gate 日志。

前三项 human 输出使用以下两行模板。未提供 authorization 时：

```text
<command-specific summary>
Lifecycle: plan revision <before> -> <after>; task revision <before> -> <after>; phase plan; authorization not-applied.
```

提供有效 authorization 时：

```text
<command-specific summary>
Lifecycle: plan revision <before> -> <after>; work revision <before> -> <after>; task revision <before> -> <after>; phase dev; authorization applied.
```

formatter 只负责稳定展示已经完成的 mutation；不得据文案反推授权、补 scope、改 phase
或吞掉 typed error。

### 2.6 Typed error

前三项新增命令冻结以下 `error.code`。human 模式输出对应 message，但调用方只按 code
选择恢复动作，不解析英文 message。

| `error.code` | 条件 | mutation |
|---|---|---|
| `invalid_arguments` | 参数组合、payload shape、path、gate、argv、答案覆盖或 authorization 内容无效；或 delta 无有效变化 | 无 |
| `not_initialized` | 当前 repo 未初始化 Latch | 无 |
| `task_not_found` | 精确 task ID 或既有 unique prefix 未命中 open task | 无 |
| `revision_conflict` | `--expect-revision` 与 current revision 不同 | 无；刷新 status，不自动重试 |
| `writer_mismatch` | caller 不是 current `primary_writer` | 无；需要显式 handoff/takeover |
| `writer_version_mismatch` | task 不是 schema 5 或 minimum writer 不可写 | 无 |
| `phase_mismatch` | 命令不接受 current phase | 无 |
| `task_blocked` | task 存在 blocked state | 无 |
| `command_failed` | 原子写、event 校验或其他未分类真实异常 | 不得报告成功 |

`revision_conflict`、`writer_mismatch`、`task_not_found` 和 `task_blocked` 是前三个新增命令
的稳定恢复 code；后续实现不得把这些已分类拒绝降级为 `command_failed`。该要求不追溯
改变已交付 `reconcile` 或其它 current 命令的 error code。

## 3. Scope-only append

### 3.1 允许与禁止的 plan 变化

`append-scope` 只允许改变 `plan.workspace_scope.paths`：

- 保留全部既有 path 及其顺序；
- 对输入按首次出现顺序去重，只追加尚不存在的 path；
- path 必须是 repo-relative POSIX exact file 或以 `/` 结尾的 directory prefix；
- 现存目录仍必须使用尾斜杠；不存在的 path 不自动解释为目录；
- 拒绝空值、绝对路径、repo escape、glob、Git pathspec magic、`.`、`./` 和 repo root；
- 至少追加一个新 path，否则返回 `invalid_arguments`。

命令不得删除、替换、重排或缩小既有 machine scope，不得修改自然语言 `scope`，也不得
把任何输入扩大为 repo root。若真实变化同时涉及产品范围、acceptance、goal、公共契约
或其它 plan 字段，必须使用完整 `save --plan-file`。

### 3.2 Proof、event 与输出

scope coverage 发生变化后，旧 workspace proof 不能证明新增 path。命令删除 task 中
active `workspace_proof` 引用，但不删除或重写既有 evidence sidecar；本命令不采集
workspace、不创建 sidecar，也不尝试把新增 path 解释为当前 workspace evidence。
后续 `verify` 或 `verify-all` 建立覆盖 post-delta scope 的新 generation。

`plan_updated` event 使用：

```json
{
  "type": "plan_updated",
  "plan_revision": 2,
  "change": "workspace_scope_append",
  "appended_paths": ["docs/new.md", "src/new/"]
}
```

JSON success 在共同字段外增加 `appended_paths`。human 第一行冻结为：

```text
Appended <count> workspace scope path(s) to <task-id>: <path>, <path>.
```

## 4. Verification command update

### 4.1 允许与禁止的 plan 变化

`update-verification-command` 只允许修改一个现有
`plan.verification_plan[name].command`：

- `--name` 必须精确匹配且只匹配一个现有 `kind: "gate"`；
- 新 command 是 `--` 后的非空 argv，按字节顺序保存，不经过 shell；
- 新 command 必须不同于旧 command；
- 继续执行现有 sentinel 和 instruction-only gate 校验；
- `name`、`kind`、gate 顺序、gate 数量和其它 plan 字段保持不变。

命令不得新增、删除、重命名 gate，不得把 diagnostic 改为 gate，也不得借 gate command
修改 acceptance 或公共行为。上述变化继续使用完整 `save --plan-file`。

### 4.2 Proof、event 与输出

command 变化后清空全部 verification result，旧 gate proof 必须失效，不能按相同 name
复用。现有 `workspace_proof` baseline 可保留，因为 machine scope 没有变化；本命令不
运行新旧 command、不采集 workspace、不推进 proof generation，也不写 evidence。
提供 authorization 时，新增 `work_revision` 进一步保证旧 proof 不能成为 current proof。

`plan_updated` event 使用：

```json
{
  "type": "plan_updated",
  "plan_revision": 2,
  "change": "verification_command_update",
  "gate_name": "project-check",
  "previous_command": ["pnpm", "test"],
  "command": ["pnpm", "check"]
}
```

JSON success 在共同字段外增加：

```json
{
  "verification": {
    "name": "project-check",
    "kind": "gate",
    "previous_command": ["pnpm", "test"],
    "command": ["pnpm", "check"]
  }
}
```

human 第一行冻结为：

```text
Updated verification command for <task-id> gate <name>: <argv rendered with JSON string escaping>.
```

argv 使用 JSON string escaping 逐项展示，不拼接为可执行 shell command。

## 5. Atomic open-question resolution

### 5.1 Answers payload

`--answers-file` 接受以下唯一 shape：

```json
{
  "answers": [
    {
      "question": "是否保留旧格式？",
      "answer": "不保留。",
      "decision": "只提供 current schema 5 格式。"
    }
  ]
}
```

根对象只允许 `answers`，每个元素只允许 `question`、`answer` 和 `decision`。
`answers` 必须与 mutation 时 current `plan.open_questions` 等长、同序，并逐项精确匹配
`question` 字符串。`answer` 和 `decision` 必须是非空文本；校验可用 trim 判断空值，但保存
原始字符串。缺少、重复、额外、乱序、过期问题或空答案全部返回
`invalid_arguments`，不得部分解决或静默使用默认值。current `open_questions` 为空时也
拒绝 no-op。

### 5.2 允许变化、event 与输出

命令只把 `plan.open_questions` 从 current 完整数组改为 `[]`，其它 plan 字段保持不变。
每个 answer 按输入顺序追加一个 `decision_recorded` event，保存同一新
`plan_revision`、`question`、`answer` 和 `conclusion: decision`。同一 mutation 另追加：

```json
{
  "type": "plan_updated",
  "plan_revision": 2,
  "change": "open_questions_resolved",
  "resolved_count": 1
}
```

旧 verification 与 submission 按共同 plan change 规则失效。machine scope 未变化，
因此现有 `workspace_proof` baseline 可保留；命令不采集 workspace 或写 evidence。

JSON success 在共同字段外增加完整的 `resolved_questions` 数组，元素保持输入的
`question`、`answer`、`decision`。human 输出不打印答案正文，第一行冻结为：

```text
Resolved <count> open question(s) for <task-id>.
```

保存答案不等于批准实施。只有同时提供合法 `--authorization-file`，且 post-delta plan
通过 authorizable validation，mutation 才能原子进入 `dev`。

## 6. 已交付 reconcile 契约

`reconcile` 已由 current CLI `0.5.0` 独立实现。本设计只引用
`docs/HANDBOOK.md`、`skills/latch/SKILL.md`、`src/commands/reconcile.ts` 和
`tests/workspace-reconcile.test.mjs` 已一致交付的契约：

- 只处理 schema 5、current writer、有效 implementation authorization、非 blocked 且
  phase 为 `dev/check` 的 task；
- 不接受 selector，一次采集 live workspace，只解决当前 entry 与 violation 原始
  `before` entry 完全一致的全部 violation；
- scope expansion、近似内容、不同 Git 状态和调用方声明均不是 restoration；
- 成功只增加一次 task revision，保持 `plan_revision`、`work_revision`、`work_basis` 和
  phase 不变；
- 成功推进一次 proof generation，保留 gate result 但使其 stale，删除 submission，追加
  `proof_invalidated` 和 `workspace_violation_resolved` event；
- `next_action` 为 `verify`，后续显式运行 `verify-all`；
- no-op、capture failure、phase、schema、writer 或 revision 拒绝不修改 task、event 或
  evidence，revision conflict 不自动重试。

Human success 保持 current 三行模板：

```text
Reconciled <task-id>: <resolved-count> restored, <remaining-count> remaining; revision <before> -> <after>.
Resolved IDs: <stable bounded IDs|none>.
Remaining IDs: <stable bounded IDs|none>.
```

JSON 保持 current mutation envelope，并包含 `resolved_count`、`remaining_count`、
`resolved_ids`、`remaining_ids` 和 `workspace_proof`。current typed error 保持：参数错误为
`invalid_arguments`，历史 schema 为 `writer_version_mismatch`，phase 为
`phase_mismatch`，无 proof、无 violation 或无精确恢复为 `workspace_violation`；current
实现仍归入 `command_failed` 的 revision、writer 或 capture error 不在本设计中重分类。

本设计不新增 reconcile implementation task，不修改其参数、event、formatter、evidence
算法或 error code。

## 7. JSON stdin、workspace evidence 与 formatter 边界

### 7.1 JSON stdin

结构化 JSON stdin 契约已经交付。`--answers-file` 和 `--authorization-file` 都接受字面值
`-`；同一命令最多一个结构化 file option 使用 `-`。因此
`resolve-open-questions --answers-file - --authorization-file -` 必须在读取 stdin 前以
`invalid_arguments` 拒绝。

stdin 仍只读取一个完整 JSON value，可有尾部 whitespace；empty、malformed、shape、
业务或 authorization 校验均在 task mutation 前完成。stdin 没有 workspace path，不进入
workspace evidence，不创建临时文件，也不获得 ignore 或 allowlist 语义。真实文件继续
使用 current file evidence 语义。`append-scope --path` 和
`update-verification-command -- <argv>` 不是 JSON file input；不把 raw JSON 参数、JSON
Lines 或 shell string 加入 CLI。

### 7.2 Workspace evidence

三项 plan delta command 都不运行 gate、不采集 snapshot、不比较 live workspace、不推进
proof generation，也不把输入文件作为新的 evidence 特例。`append-scope` 仅因 coverage
变化移除 active `workspace_proof` 引用；另外两项保留 baseline，但清空 verification。
真实 proof 只能由后续 `verify`、`verify-all` 或已交付 `reconcile` 产生。

### 7.3 Formatter

CLI 继续使用 schema 2 JSON envelope、current `mutationJson` 的 `next_action`、
`shared_worktree`、可选 `workspace_proof` 和 warning 投影。实现可以增加小型共享 helper
拼装本设计的共同 delta 字段，但不得创建独立响应 schema、通用模板 DSL 或从 human 文案
反解析状态。timeline formatter 只读取已保存 event；不得生成未写入的 authorization、
answer 或 proof 事实。

## 8. 后续 implementation tasks

三张 implementation task 顺序执行。每张 task 都要复用本契约，不得顺手实现其它 delta
命令；已交付 `reconcile` 只运行 regression，不另建实现 task。

### I1. `append-scope` vertical slice

**Material scope**

- 新增 `append-scope` CLI parsing、usage、Core mutation、event payload、human/JSON 输出与
  typed error；
- 增加 optional structured authorization 和 post-delta authorizable validation；
- 处理 path normalize、append-only、repo-root 拒绝和 workspace proof coverage 失效；
- 更新 current HANDBOOK、DESIGN、Skill 与 CLI/docs tests。

**Acceptance**

- 只追加 machine scope，顺序、去重、尾斜杠和禁止 repo root 的规则与本契约一致；
- 未授权回 `plan`，显式 authorization 可原子进入 `dev`；
- lifecycle、event、JSON、human 和 typed error 与本契约逐字段一致；
- 所有拒绝无 task/event/state/evidence partial write。

**非目标**

- 不删除或替换 scope，不修改自然语言 `scope`，不处理 goal/acceptance/product scope；
- 不实现其它两个 delta 命令，不改变 reconcile；
- 不采集 workspace 或删除历史 evidence sidecar。

**测试矩阵**

| 类别 | 用例 |
|---|---|
| success | 单 path、多 path、输入去重、保留既有顺序、human、JSON |
| path refusal | absolute、escape、glob、pathspec、`.`、`./`、现存目录无 `/`、全为既有 path |
| lifecycle | 四个 open phase；未授权回 plan；`user_delta` 与 `user_approve` 原子授权；work/plan/task revision |
| authorization | missing 不推断、invalid source、stale `user_delta`、post-delta authorizable failure、stdin authorization |
| proof | verification/submission 清除、active proof 引用移除、sidecar 不变、下一次 verify 新建 coverage |
| concurrency | revision conflict、writer mismatch、blocked、historical schema、无 partial write、不自动重试 |
| regression | full plan save、scope classifier、structured stdin、reconcile suites |

### I2. `update-verification-command` vertical slice

**Material scope**

- 新增 `update-verification-command` parsing、`--` argv、Core mutation、event、formatter 与
  typed error；
- 增加 exact existing gate lookup、command validation、proof invalidation 和 optional
  structured authorization；
- 更新 current HANDBOOK、DESIGN、Skill 与 CLI/docs tests。

**Acceptance**

- 只改变一个现有 gate 的 command，name、kind、顺序和 gate 集合不变；
- 旧 proof 永不成为 current proof，命令本身不运行 gate；
- 未授权与原子授权 lifecycle、event 和输出完全符合本契约；
- argv 不经过 shell，human 使用 JSON string escaping。

**非目标**

- 不新增、删除、重命名 gate，不更新 diagnostic，不提供 command string 或 shell mode；
- 不实现 scope/question delta，不修改 reconcile；
- 不依据 formatter、lint 或 `--fix` 猜测 command 行为。

**测试矩阵**

| 类别 | 用例 |
|---|---|
| success | 带 flag/space/unicode argv、human escaping、JSON previous/new command |
| target refusal | unknown name、duplicate name、diagnostic name、empty argv、same argv、sentinel、instruction-only command |
| lifecycle | plan/dev/check/review；plan/work/task revision；未授权与两种 explicit source；next_action |
| proof | 全部 verification 清除、submission 删除、workspace baseline 保留、旧 gate proof stale、命令不执行 |
| authorization | invalid/missing 不推断、stdin authorization、post-delta authorizable validation |
| concurrency | revision、writer、blocked、schema、原子失败和 typed error |
| regression | verify、verify-all、submit、full plan save、reconcile suites |

### I3. `resolve-open-questions` vertical slice

**Material scope**

- 新增 `resolve-open-questions` parsing、answers schema、exact coverage validator、Core
  mutation、decision event、formatter 与 typed error；
- 增加 optional structured authorization 和双 structured file stdin preflight；
- 更新 current HANDBOOK、DESIGN、Skill 与 CLI/docs tests。

**Acceptance**

- 一次精确覆盖 current 全部问题，逐项保存 question、answer 和 decision；
- 不存在 partial resolution、默认答案或答案即授权的推断；
- 未授权保持 `plan`，只有显式 `user_approve` 可原子进入 `dev`；
- lifecycle、event、JSON、human、stdin 和 typed error 与本契约一致。

**非目标**

- 不增加、编辑或重排问题，不解决问题子集，不从聊天或 Agent 结论自动生成答案；
- 不修改其它 plan 字段，不实现 scope/verification delta，不修改 reconcile；
- 不引入 raw JSON、JSON Lines 或临时兼容参数。

**测试矩阵**

| 类别 | 用例 |
|---|---|
| success | 单问题、多问题、unicode、完整 JSON result、human count、逐项 decision event |
| coverage refusal | empty current、missing、extra、duplicate、out-of-order、stale question、empty answer/decision |
| lifecycle | 仅 plan；plan/work/task revision；未授权 approve；原子授权 dev；next_action |
| authorization | answer 不授权、`user_delta` / `user_request` 拒绝、post-delta authorizable failure |
| stdin | answers stdin、authorization stdin、两个 `-` 读取前拒绝、empty/malformed/trailing whitespace、无 evidence path |
| proof | verification/submission 清除、workspace baseline 保留、不采集 evidence |
| concurrency | revision、writer、blocked、schema、原子失败和 typed error |
| regression | existing `save --decision`、approve authorizable gate、full plan save、reconcile suites |

## 9. 发布门禁

每张 implementation task 都必须使用 schema 5 Standard 或经 A/B/C 重新判定后的明确
profile，获得独立实施授权，并运行其 named gates。本文件作为 approved contract 独立于
三项命令的实施状态；三项全部交付前，current HANDBOOK 和 Skill 不得把未实现命令写成
可用行为。任何实现若需要改变本文件冻结的 command、payload、lifecycle、event、output
或 typed error，必须先通过独立 design task 更新契约并重新批准。
