# Gate 工作区 mutation 证明与失效语义

Source-Task: `20260730040007379-设计-gate-工作区-mutation-证明与失效语义-2e68d9`

Source-Record: `rec_41800a8d-00e2-413f-a730-3ead2e4e691b` revision 1

Source-Record-SHA256: `1f6559c1723325bac4f34cf9852c9c0b3b51fa839c0a00b6d8decf1a3489a33f`

Document-Status: `proposed`

Date: 2026-07-30

## 地位

本文件定义 gate 工作区 mutation 证明的候选产品设计，供后续独立 Standard
implementation task 使用。本文件不是 current 产品契约，不修改当前 `verify`、
`verify-all`、submit、task schema、event schema 或 CLI 行为，也不构成这些变更的
实施授权。

## 背景

当前 `verifyTaskV2` 在 workspace root 执行批准计划中的 argv，并只根据进程退出码
写入 `pass` 或 `fail`。`verification_run` 不保存 gate 前后的工作区证据，也不区分
scope 内写入与 scope 外写入。

来源案例中的 `eslint --fix` gate 退出码为 0，但修改了 task scope 外原本干净的
`src/utils/waterMark.js`。Latch 将该结果保存为普通 `pass`，人工撤回文件变化后，
已有 gate proof 仍显示 `stale=0`。问题不只是缺少 warning，而是 proof 没有说明
「命令成功时验证的是哪个工作区状态」。

辅助 Record `rec_30aece6f-457f-4a8b-8a73-d8aede8ff08b` 当前只保留 revision 7，
现有 CLI 不支持读取历史 revision，当前 store 也没有 revision 6 正文。本设计只把
revision 7 中仍存在的 gate mutation 摘要作为辅助材料，不声称取得 revision 6
原文。

## 已确认决策

1. 新增机器可读的 `workspace_scope.paths`，作为 scope 内外判断的唯一权威来源。
2. `plan.scope` 继续保存面向人的范围说明，Core 不从自然语言推断文件归属。
3. 所有 covered 净 mutation 均拒绝当前 gate 的 proof pass。
4. covered mutation 使 active proof generation 的全部 named gate proof stale。
5. scope 外 mutation 形成未解决 violation，并在恢复或扩 scope 后重新批准前阻止 submit。
6. `verify-all` 遇到 mutation、scope violation、command failure 或 evidence error 时立即停止。
7. 首版不提供 `ephemeral_outputs`、ignored 输出或其它 mutation 后保留 pass 的例外。
8. Latch 只观察 Git 与文件状态，不执行 Git 写入、自动回滚或 worktree 管理。

## 目标

- 让每次 gate 结果都能说明命令结果、工作区影响和 proof 资格。
- 在已有脏工作区中建立可靠 baseline，发现 status code 不变但内容改变的路径。
- 防止 scope 内或 scope 外 mutation 被普通退出码 0 掩盖。
- 让多个 gate 只在同一稳定 proof generation 上共同构成 submit proof。
- 让 reviewer 能从 task evidence 判断 mutation、stale 和未解决 violation。
- 保持 Latch 是本地任务状态记录器，而不是 Git 或 worktree 管理器。

## 不做什么

- 不绑定 commit hash、最终 tree hash 或仓库级全量 tree fingerprint。
- 不执行 `git add`、commit、checkout、reset、clean、stash、revert 或自动回滚。
- 不创建、选择、合并、清理或全局管理 Git worktree。
- 不扫描 argv、脚本名、`--fix` 或 formatter 名称来猜测 gate 是否会写文件。
- 不全量监视 ignored 目录，不引入 FSEvents、sandbox 或进程写入拦截。
- 不承诺发现 gate 内部 commit 后恢复 clean 的变化。
- 不承诺发现 gate 运行期间写入后恢复原内容的瞬时 mutation。
- 不在本设计中确定非 Git workspace provider、旧 schema migration 或 R2 downgrade 实现。

## 核心模型

gate proof 由三组正交事实组成：

| 事实 | 含义 | 不能替代什么 |
|---|---|---|
| command outcome | 子进程是否启动、退出码以及执行错误 | 不能证明工作区未变化 |
| workspace effect | before 与 after 之间的 covered 净变化 | 不能证明命令满足业务验收 |
| proof status | 该结果是否可参与 submit 门禁 | 不能丢失前两组原始事实 |

只有以下条件同时满足时，gate 的 proof status 才能为 `pass`：

1. 命令成功启动并以 0 退出；
2. before 与 after evidence 均完整；
3. covered workspace 没有净 mutation；
4. 结果绑定当前 `work_revision` 和 active proof generation；
5. 当前 task 没有未解决 workspace violation。

## 机器 scope

### `workspace_scope.paths`

未来 plan schema 增加：

```json
{
  "workspace_scope": {
    "paths": [
      "src/core/progress.ts",
      "src/core/workspace-evidence.ts",
      "tests/"
    ]
  }
}
```

路径规则：

- 只接受 repo-relative POSIX 路径；
- 拒绝绝对路径、空路径、`.`、`..` 和 repo escape；
- 末尾 `/` 表示目录前缀，其余值表示精确文件路径；
- 首版不支持 glob、Git pathspec magic 或自然语言匹配；
- 规范化后重复项去重；
- changed path 与精确文件相同，或位于目录前缀之下时，分类为 scope 内；
- 其它 changed path 分类为 scope 外。

`workspace_scope.paths` 是 scope 分类的唯一权威来源。task artifact 可以让 ignored
文件进入监视集合，但 artifact 不自动扩大 scope；artifact 若不在
`workspace_scope.paths` 中，发生变化时仍属于 scope 外 mutation。

### 与现有字段的关系

- `plan.scope`：面向人的范围说明，不参与 Core 路径判断；
- `work_basis.scope.paths`：授权摘要，不替代批准 plan 中的机器 scope；
- `task.artifacts`：交付与知识引用，不自动推导文件所有权；
- `workspace_scope.paths`：gate evidence 唯一的 scope 分类输入。

## Evidence coverage

首版 evidence domain 包含：

- tracked 文件的 staged、unstaged、删除、重命名、类型和 mode 状态；
- 非 ignored untracked 文件；
- `workspace_scope.paths` 中的精确 ignored 文件；
- task artifact 引用的精确 ignored 文件。

首版 evidence domain 不包含：

- ignored 目录的全量递归内容；
- scope 或 artifact 未显式引用的 ignored 文件；
- repo root 之外的文件；
- gate 运行期间已经恢复为原状态的瞬时写入；
- after snapshot 完成后才发生的后台写入。

每个 verification result 必须保存 coverage 说明。`pass` 只表示 covered workspace
未发生净 mutation，不得描述成对任意文件系统写入的绝对保证。

## Snapshot 数据

候选数据结构：

```ts
type WorkspaceSnapshot = {
  provider: 'git-v1'
  captured_at: string
  complete: boolean
  coverage: {
    git_visible: true
    explicit_ignored_files: true
    ignored_tree: false
  }
  counts: {
    tracked_dirty: number
    untracked: number
    explicit_ignored: number
  }
  entries_ref: WorkspaceEvidenceRef
  error?: string
}

type WorkspaceEntry = {
  path: string
  scope: 'in_scope' | 'out_of_scope'
  source: 'git_status' | 'workspace_scope' | 'artifact'
  index_state: string
  worktree_state: string
  file_type: 'file' | 'directory' | 'symlink' | 'submodule' | 'missing'
  exists: boolean
  content_sha256?: string
  index_fingerprint?: string
  mode?: string
}
```

`content_sha256` 是逐路径内容 fingerprint，不是最终 tree hash。symlink 对 link target
文本计算 fingerprint；submodule 保存 Git 状态与对象 fingerprint，但不递归读取
submodule 工作区。

## Before snapshot

在启动 gate 子进程前执行：

1. 使用 `git status --porcelain=v2 -z --untracked-files=all` 读取 Git-visible 状态；
2. 解析 staged、unstaged、rename、delete、mode、submodule 和 untracked 条目；
3. 加入机器 scope 或 artifact 显式引用的 ignored 精确文件；
4. 对所有条目读取文件类型、存在状态和逐路径 fingerprint；
5. 对 index 状态保存逐路径 index fingerprint；
6. 保存完整 entry 集合、计数、coverage 和采集时间；
7. 任一命令失败、解析失败、权限错误或采集期间状态不稳定时标记 `complete=false`。

采集失败时不启动 gate。Latch 写入 `evidence_error`，返回非零状态，并要求重新执行。
首版不对不稳定 snapshot 自动重试，避免把并发写入静默解释为稳定 baseline。

## After snapshot

gate 子进程退出后、写入 verification event 前，按 before 相同规则采集 after
snapshot。Latch 自身随后写入 `.latch` 的 task、event 和 evidence 文件，不属于该次
gate workspace effect。

after snapshot 不完整时：

- 保存 command outcome；
- proof status 为 `fail`；
- failure reason 为 `evidence_error`；
- 不保留或生成普通 `pass`；
- `verify-all` 立即停止。

## 净 mutation 计算

对 before 与 after entry 的路径并集逐项比较：

- 路径只出现在 after：`created`；
- 路径只出现在 before：`removed` 或 `restored_clean`；
- index state、worktree state、file type 或 mode 改变：`state_changed`；
- status tuple 相同但内容 fingerprint 改变：`content_changed`；
- rename 同时保存 old path 与 new path；
- 同一 tracked path 从 dirty 变 clean 仍属于 mutation；
- before 与 after 完全一致时 workspace effect 为 `unchanged`。

候选结构：

```ts
type WorkspaceDelta = {
  status:
    | 'unchanged'
    | 'in_scope_mutation'
    | 'out_of_scope_mutation'
    | 'mixed_mutation'
    | 'evidence_error'
  changed_count: number
  in_scope_count: number
  out_of_scope_count: number
  samples: WorkspacePathChange[]
  changes_ref?: WorkspaceEvidenceRef
}
```

完整路径集合参与正确性判断，`samples` 只用于 bounded output。

## 已有脏工作区

已有脏工作区不是 gate mutation，也不自动阻止 gate。before snapshot 将其保存为
当前 proof generation 的 baseline。

可靠 baseline 必须满足：

- 保存全部 Git-visible 脏路径，而不是只保存 `git status` code；
- 对已有 dirty 和 untracked 文件保存内容 fingerprint；
- 对 staged 状态保存 index fingerprint；
- 保存 scope 内外计数；
- 默认展示 baseline contamination warning；
- proof 明确表示命令针对该 dirty baseline 执行。

以下情况都能被检测：

| Before | After | 结果 |
|---|---|---|
| clean tracked | dirty tracked | mutation |
| dirty tracked，status code 不变 | 内容 fingerprint 改变 | mutation |
| dirty tracked | clean tracked | mutation |
| untracked | 内容改变 | mutation |
| untracked | missing | mutation |
| staged | index fingerprint 改变 | mutation |

before 已存在的 scope 外 dirty path 不归因于 gate，但 reviewer 必须能看到该 baseline
污染。若 gate 改变该路径，变化按 scope 外 mutation 处理。

## Proof generation

`work_revision` 继续表示实施生命周期版本。新增 `proof_generation` 表示稳定工作区
证据版本，避免把文件状态变化伪装成 review feedback 或实施授权变化。

候选 task root：

```ts
type WorkspaceProofState = {
  generation: number
  baseline_ref: WorkspaceEvidenceRef
  baseline_counts: WorkspaceSnapshot['counts']
  unresolved_violations: WorkspaceViolation[]
}
```

候选 verification binding：

```ts
type VerificationProofBinding = {
  work_revision: number
  started_generation: number
  ended_generation: number
  before_ref: WorkspaceEvidenceRef
  after_ref: WorkspaceEvidenceRef
}
```

结果为 current 的必要条件：

```text
result.work_revision == task.work_revision
AND result.ended_generation == task.workspace_proof.generation
AND result.status == pass
AND task.workspace_proof.unresolved_violations is empty
```

### Generation 转换

- 首个 gate 建立 generation 1 和 before baseline；
- gate 未改变 covered workspace 时，generation 保持不变；
- gate 发生 covered mutation 时，以 after snapshot 建立下一 generation；
- 前一 generation 的全部 named gate proof 立即 stale；
- 当前 mutating gate 保存 started 与 ended generation，但 proof status 为 `fail`；
- 人工恢复文件不会让旧 generation 的 proof 自动恢复；
- 恢复后必须在当前 baseline 上重新运行全部 named gate。

## Gate 派生规则

command outcome 与 workspace effect 按以下顺序派生 proof status：

| Command | Workspace | Proof status | Failure reason |
|---|---|---|---|
| exit 0 | unchanged | pass | 无 |
| non-zero | unchanged | fail | `command_failed` |
| 任意 | in-scope mutation | fail | `workspace_mutated` |
| 任意 | out-of-scope mutation | fail | `scope_violation` |
| 任意 | mixed mutation | fail | `scope_violation` |
| 任意 | evidence incomplete | fail | `evidence_error` |

scope 外优先于 scope 内显示，因为它需要额外的 unresolved violation。command
失败与 mutation 同时发生时，两组事实都保留，不用一个状态覆盖另一组事实。

候选 result：

```json
{
  "name": "eslint",
  "kind": "gate",
  "status": "fail",
  "failure_reason": "scope_violation",
  "command_outcome": {
    "status": "pass",
    "exit_code": 0
  },
  "workspace_effect": {
    "status": "out_of_scope_mutation",
    "changed_count": 1,
    "in_scope_count": 0,
    "out_of_scope_count": 1,
    "samples": [
      {
        "path": "src/utils/waterMark.js",
        "change": "content_changed"
      }
    ],
    "changes_ref": "evidence/verify-eslint-0004-delta.json"
  },
  "proof": {
    "work_revision": 2,
    "started_generation": 3,
    "ended_generation": 4,
    "before_ref": "evidence/verify-eslint-0004-before.json",
    "after_ref": "evidence/verify-eslint-0004-after.json"
  }
}
```

CLI 进程返回非零状态，因为 proof status 为 `fail`，即使 command outcome 为
`pass`。

## Scope 内 mutation

scope 内 mutation 表示 gate 改变了已批准实施范围内的文件，但该次执行不再是纯
验证。

处理规则：

1. 保存 before、after 和完整 delta；
2. 当前 gate proof status 为 `fail`；
3. 返回结构化 warning；
4. 推进 proof generation；
5. 使前一 generation 的全部 named gate proof stale；
6. `verify-all` 立即停止；
7. 不创建 unresolved scope violation；
8. 保留 after 状态，不自动回滚；
9. 在新 baseline 上重新运行全部 named gate。

首版不允许在 plan 中声明 mutating gate 后继续 pass。带 `--fix` 的 lint、formatter
或 generator 可以继续作为 implementation command 使用，但其发生 mutation 的那次
执行不构成 gate pass。

## Scope 外 mutation

scope 外 mutation 同时是 proof 失败和授权范围 violation。

处理规则：

1. 执行 scope 内 mutation 的全部处理；
2. 创建包含 path、before fingerprint、after fingerprint 和来源 gate 的 unresolved violation；
3. submit 在 violation 未解决时 fail closed；
4. 再次运行同一 gate且没有新增 mutation，不会覆盖或自动消解第一次 violation；
5. 路径恢复为 before 状态时，可以用新 evidence 将 violation 标记为 restored；
6. plan 扩大 `workspace_scope.paths` 并重新批准后，可以用新 plan revision 重新分类；
7. violation 解决后旧 proof 仍 stale，全部 named gate 必须重跑；
8. Latch 不提供自动恢复命令。

不提供「接受 scope 外风险后直接 submit」的 bypass。需要保留变化时，应修改 plan、
展示新 scope 并重新取得批准。

## Gate 之间的外部变化

每个 gate 启动前都重新采集 current snapshot，并与 active generation baseline
比较。

- 单独运行 `verify` 时，如果发现 baseline 已变化，先推进 generation 并使旧 proof stale，再在新 baseline 上执行请求的 gate；
- `verify-all` 启动前发现 baseline 已变化时，先推进 generation，再从 plan 中第一个 named gate 开始；
- `verify-all` 两个 gate 之间发现 baseline 变化时，视为不稳定执行环境，记录 proof invalidation 并立即停止，不执行下一个 gate；
- scope 外变化同时创建 unresolved violation；
- `context` 可以只读计算 live mismatch，但不得在读取命令中推进 generation。

## `verify-all` 状态机

当前实现会在调用开始时一次性计算 pending gate。新设计改为逐 gate 动态判断：

```text
prepare active baseline
  ↓
按 plan 顺序选择第一个非 current-pass gate
  ↓
确认 live snapshot 与 active baseline 一致
  ├─ 不一致：推进 generation，标记旧 proof stale，停止或从头重算
  └─ 一致：执行 gate
       ↓
     capture after
       ├─ evidence error：记录失败并停止
       ├─ mutation：推进 generation，记录失败并停止
       ├─ command failure：记录失败并停止
       └─ unchanged + exit 0：记录 pass，继续下一 gate
```

若第二个 gate 发生 mutation：

- 第一个 gate 从 `pass` 变为 `stale`；
- 第二个 gate 保存 command outcome 与 mutation evidence，但 proof status 为 `fail`；
- 第三个及后续 gate 保持 `pending`；
- 返回值列出已执行 gate、停止原因、新 revision 和新 generation；
- 下一次 `verify-all` 从第一个 named gate 重新执行。

每个实际执行的 gate 继续独立增加 task revision。只发生 baseline invalidation、未执行
命令时，写入独立 `proof_invalidated` event 并增加一次 revision。

## Submit 门禁

submit 前执行只读 live snapshot：

1. evidence capture 必须完整；
2. live snapshot 必须与 active generation baseline 一致；
3. 所有 named gate 必须同时绑定当前 `work_revision` 与 active generation；
4. 所有 named gate proof status 必须为 `pass`；
5. unresolved workspace violation 必须为空。

任一条件不满足时：

- submit 返回非零；
- 返回具体 stale 或 violation 原因；
- live mismatch 通过 task mutation 保存为新的 proof generation；
- 旧 submission 不得继续保持 current；
- 不自动运行 gate；
- 不自动恢复工作区。

## Context 与 reviewer 视图

gate brief 状态继续使用 `pending`、`stale`、`pass` 和 `fail`，并增加
`stale_reason`：

- `work_revision_changed`；
- `proof_generation_changed`；
- `workspace_baseline_mismatch`；
- `unresolved_scope_violation`。

status view 增加：

```json
{
  "workspace_proof": {
    "generation": 4,
    "baseline_dirty": 9,
    "baseline_out_of_scope": 1,
    "live_status": "mismatch",
    "unresolved_violations": 1
  },
  "gates": {
    "total": 3,
    "pending": 1,
    "stale": 1,
    "pass": 0,
    "fail": 1
  }
}
```

read-only context 可以计算 `live_status`，但不写 task、event 或 evidence。若 live
capture 失败，显示 `unknown`，不得把已有 proof 展示成已确认 current。

## Warning 与完整 evidence

默认 human output 和 brief JSON 只展示：

- changed path 总数；
- scope 内、scope 外数量；
- 稳定排序后的最多 8 个样本；
- 完整 evidence ref；
- 当前 generation 与 stale 数量。

正确性判断必须使用完整 entry 集合，不得使用 8 个样本。完整 evidence 建议保存为：

```text
.latch/tasks/<task-id>/evidence/<run-id>-before.json
.latch/tasks/<task-id>/evidence/<run-id>-after.json
.latch/tasks/<task-id>/evidence/<run-id>-delta.json
```

sidecar 使用原子写，task result 保存 repo-relative ref、SHA-256 完整性 fingerprint 和
entry count。该 SHA-256 只验证 sidecar 内容，不绑定 Git tree。sidecar 缺失、损坏
或 entry count 不一致时，相关 proof fail closed。

task update 失败后遗留的未引用 sidecar 不构成 proof；后续可以由独立维护任务设计
清理策略，本阶段不自动删除。

## Event 与 revision

后续实现至少需要表达：

- `proof_generation_started`：建立或推进稳定 baseline；
- `verification_run`：保存 command outcome、workspace effect 和 proof binding；
- `proof_invalidated`：命令执行前或 submit 前发现 baseline mismatch；
- `workspace_violation_resolved`：路径恢复或重新批准后解决 violation。

task.json 继续是当前事实与提交点，event 保存历史。一个 gate 的 generation 变化与
verification result 应在同一 task revision 中提交，避免先记录 pass 再补 mutation
warning 的中间状态。

## CLI JSON

`verify --json` 至少返回：

```json
{
  "task_id": "<task-id>",
  "previous_revision": 7,
  "revision": 8,
  "phase": "check",
  "verification": {
    "name": "eslint",
    "status": "fail",
    "failure_reason": "scope_violation",
    "command_outcome": {
      "status": "pass",
      "exit_code": 0
    },
    "workspace_effect": {
      "status": "out_of_scope_mutation",
      "changed_count": 1,
      "out_of_scope_count": 1,
      "samples": [
        "src/utils/waterMark.js"
      ],
      "changes_ref": "evidence/verify-eslint-0004-delta.json"
    },
    "proof_generation": {
      "before": 3,
      "after": 4
    }
  },
  "warnings": [
    "Gate eslint changed 1 out-of-scope path; proof pass was denied."
  ]
}
```

`verify-all --json` 额外返回：

- `executed`；
- `stopped_reason`；
- `stopped_gate`；
- `remaining`；
- `proof_generation`；
- `unresolved_violations`。

mutation、scope violation、command failure 和 evidence error 均返回非零进程状态。

## Ignored 与非交付输出

首版不支持 `ephemeral_outputs` pass 例外：

- Git ignored 不等于 proof 无关；
- cache 或生成物可能影响后续 gate；
- Core 不从命令名称判断某个输出是否安全；
- 显式进入 evidence domain 的 ignored 文件发生变化时，统一拒绝 pass；
- 未进入 evidence domain 的 ignored 文件必须在 coverage 中明确标为未覆盖。

若后续真实使用证明必须允许稳定的非交付输出，应另建产品设计，定义依赖、污染和
review 表达，不能在首版加入宽泛 allowlist。

## Git 与 worktree 边界

Latch 可以：

- 执行只读 `git status` 和必要的逐路径 index 查询；
- 读取文件类型、内容和 mode；
- 计算本地逐路径 fingerprint；
- 保存 evidence、warning 和 violation；
- 拒绝 pass 或 submit。

Latch 不可以：

- 修改 index、HEAD、branch 或 refs；
- 创建 commit、stash 或 worktree；
- checkout、reset、clean 或 revert 文件；
- 自动撤回 gate mutation；
- 将脏路径自动归属给某张 task；
- 因为共享 workspace 而自动隔离或迁移文件。

恢复、保留或扩 scope 均由实施人员在 Latch 外操作，Latch 只观察结果并更新 proof
状态。

## 实施影响面

后续 implementation task 预计涉及：

| 文件 | 影响 |
|---|---|
| `src/core/types.ts` | 增加 workspace scope、snapshot、delta、proof generation 与 violation 类型 |
| `src/core/plan-schema.ts` | 校验 `workspace_scope.paths` 的规范化与路径边界 |
| `src/core/workspace-evidence.ts` | 新增 Git-visible snapshot、逐路径 fingerprint 和 delta 计算 |
| `src/core/task-store.ts` | 校验 task 当前事实、evidence sidecar ref 和不可变字段 |
| `src/core/progress.ts` | 在 gate 前后采集 evidence，派生 proof status，并改造 `verify-all` |
| `src/core/task-view.ts` | 投影 generation、live mismatch、stale reason 和 violation |
| `src/cli.ts` | 返回结构化 JSON、human warning 和正确的非零进程状态 |
| `tests/review.test.mjs` | 扩展 `verify`、`verify-all`、submit 和 stale 行为测试 |
| `tests/workspace-evidence.test.mjs` | 增加 snapshot、dirty baseline、scope 分类和 sidecar 损坏测试 |
| current 文档与 canonical skill | 在行为发布后更新真实 CLI 与 AI 使用规则 |

该 implementation task 属于公共契约和 task schema 变更，必须使用新的 Standard
plan、明确 migration 或 schema 边界，并重新取得批准。本设计不预先选择兼容层。

## 测试矩阵

### Snapshot

- clean Git workspace 生成完整空 baseline；
- staged、unstaged、delete、rename、mode 和 submodule 状态可解析；
- untracked 文件展开为逐文件 entry；
- dirty 文件 status code 不变但内容变化可检测；
- staged index fingerprint 变化可检测；
- symlink target 变化可检测；
- 权限错误、Git 错误、解析错误和采集竞争返回 `complete=false`；
- sidecar 缺失、损坏或 count 不一致 fail closed。

### Scope

- 精确文件命中 scope 内；
- 目录前缀命中后代路径；
- 相似前缀不误命中；
- artifact 不自动扩大 scope；
- 绝对路径、repo escape、glob 和 pathspec magic 被拒绝；
- 显式 ignored 文件进入 evidence domain；
- ignored 目录不被全量递归。

### Gate

- exit 0 且 unchanged 返回 pass；
- non-zero 且 unchanged 返回 command failure；
- exit 0 且 scope 内 mutation 拒绝 pass；
- exit 0 且 scope 外 mutation 创建 violation；
- non-zero 与 mutation 同时保留两组事实；
- after evidence error 不保留 pass；
- mutation 后全部当前 named gate proof stale；
- 人工恢复不自动恢复旧 proof。

### `verify-all`

- 跳过同一 work revision 与 generation 的 current pass；
- command failure 后停止；
- scope 内 mutation 后停止并使前序 pass stale；
- scope 外 mutation 后停止并创建 violation；
- gate 间 baseline mismatch 时不执行下一个 gate；
- 恢复后从第一个 named gate 重跑；
- diagnostic 不参与 submit 门禁。

### Submit 与 context

- submit 拒绝 stale work revision；
- submit 拒绝 stale generation；
- submit 拒绝 live baseline mismatch；
- submit 拒绝 unresolved scope violation；
- context 只读显示 live mismatch 且不推进 generation；
- bounded view 最多返回 8 个样本；
- 详细 view 可读取完整 evidence；
- ignored coverage 缺口明确展示。

## 分步实施建议

1. 先冻结 `workspace_scope.paths`、snapshot、delta、proof generation 和 violation schema。
2. 实现纯函数式 status parser、scope classifier 与 delta calculator，并完成单元测试。
3. 实现 evidence sidecar 的原子写、完整性检查和 task ref。
4. 将 before/after capture 接入单 gate 原语，先完成 `verify` 行为。
5. 将 `verify-all` 改为逐 gate 动态状态机。
6. 接入 submit live baseline 门禁与 context 只读 freshness。
7. 更新 CLI JSON、human output、current 文档与 canonical skill。
8. 在独立 adopter repo 使用 mutating lint 案例做真实流程验收。

## 验收

- 本文明确回答 gate 前后采集什么 evidence；
- 本文明确回答 scope 内与 scope 外 mutation 的不同处理；
- 本文给出已有脏工作区的 fingerprint baseline；
- 本文明确 warning、pass 拒绝和全部 named gate proof stale 的关系；
- 本文给出 `verify-all` 中前序或后序 gate mutation 的状态转换；
- 本文保持 Latch 不自动管理 Git 或 worktree；
- 本文列出 JSON、event、revision、storage、CLI、测试和实施影响面；
- 本文不引入 commit hash、最终 tree hash、自动 Git 或自动回滚。

## 风险

- 全量 Git-visible untracked 路径可能产生较大 evidence sidecar，但不能用展示预算截断正确性输入。
- snapshot 不是文件系统事务，并发写入必须通过 incomplete 或 baseline mismatch fail closed。
- ignored 全量监视未覆盖，proof 必须明确描述 coverage。
- 未绑定 commit 或最终 tree 时，gate 内部 commit 后恢复 clean 的变化无法由本设计发现。
- 新字段涉及公共 task schema，后续 implementation task 必须独立确定 schema 与 migration 边界。
