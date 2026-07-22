# Latch 使用手册

Latch 记录本地 coding task。每张 task 保存 plan、批准、工作轮次、验证、submission 和 archive outcome。

当前产品契约见 [Latch 最终产品契约](prd/2026-07-15-latch-final-product-contract.md)。

## 任务触发

触发章的 A/B/C 判定表决定是否创建或续接 task：

- A：目标、成功标准、范围、根因或高风险改法不明确时，停在 grill，不实施；
- B：改法和范围明确、低风险、`open_questions` 为空且不扩 scope 时，创建或续接 light task，`source: user_request` 作为授权；
- C：需要方案确认、多 gate 或存在高风险面时，创建或续接 standard task，展示 plan 后等待明确 approve。

纯问答、只读探索和无写入意图的请求不建 task。用户明确要求「不用 Latch」时，本轮也不建 task。

## 基本流程

```text
plan -> dev -> check -> review -> done
                    └──────────> dev
plan/dev/check/review -> abandoned
```

blocked 不改变 phase。其他处于 dev、check、review 的 task 不阻止批准；共享 worktree 风险仍会作为 warning 返回。

### Agent 启动读取

Agent 处理请求时，先运行 `git status --short` 和 `latch list --json --brief`。请求已点名 task 时，读取该 task 的 `context --json --status`；未点名时，仅当 list 返回 `current_task_id` 才读取对应 status。

当 list 不含 `current_task_id` 且请求未点名 task 时，不得调用无 task ID 的 `latch context --json --status`。需要 goal、scope、acceptance、完整 gate 或 submission 时，再从 status 展开为 brief 或完整 context。

先读取 task artifact。只有任务涉及产品契约、架构、安装、文档行为，或现有证据不足时，才从 `docs/INDEX.md` 选择直接相关文档；简单且证据充分的改动不固定读取项目文档。

## 命令

### 初始化

```bash
latch init
```

v2 不迁移或覆盖 v1 `.latch`。

### 创建与选择

```bash
latch checkpoint "任务标题" --plan-file plan.json
latch checkpoint "低风险任务" --plan-file plan.json \
  --authorize-request "用户请求完成明确修正" \
  --scope-path src/cli.ts
latch checkpoint "低风险任务" --plan-file plan.json \
  --profile light --authorization-file authorization.json
latch checkpoint "事后记录" --plan-file plan.json \
  --retrospective-file retrospective.json
latch use <task-id>
latch list --json --brief
latch context [task-id] --json --brief --history timeline
latch context [task-id] --json --status
latch context [task-id] --json --since-revision <revision>
```

`checkpoint` 必须读取完整 plan 文件。同标题 task 不覆盖。`use` 只修改当前 actor 的索引。

无新增参数时，`checkpoint` 创建 standard plan task。`--authorization-file` 只接受
`source: user_request`，并原子创建 light task、写入 work basis、进入 dev 且将
`work_revision` 设为 1。`--retrospective-file` 默认创建 standard retrospective
task；需要 light 证明规则时显式增加 `--profile light`。两种 basis 文件不能组合。

明确且低风险的请求可使用 `--authorize-request <reason>` 省去 authorization JSON
文件。该选项固定写入 `source: user_request` 并创建 light task；`--scope-summary`
可覆盖默认的 reason，重复的 `--scope-path` 写入 scope paths。inline 参数仅能与
`profile: light` 一起使用，并且不能与 `--authorization-file` 或
`--retrospective-file` 组合。复杂 scope、notes 或非请求授权继续使用文件方式。

从 CLI 版本 `0.2.0` 开始，`checkpoint` 创建 schema 3 standard task，并将当前 canonical session actor 写入 `primary_writer`。既有 schema 2 task 保持可读，但普通写入会按 `legacy_unclaimed` 拒绝；明确继续该 task 后，使用 `claim` 完成单 task 升级：

```bash
latch claim <task-id> --expect-revision 3 --reason "继续该 task"
```

`context --json --brief` 不返回完整 `plan`，但 `task.verification_plan` 会列出每项计划验证的 `name`、`command`、`kind` 和 `status`。`status` 为 `pending`、`stale`、`pass` 或 `fail`；`task.verification` 继续保留执行结果的完整记录。

`context --json --status` 是最小状态入口，只返回 phase、revision、授权、writer、blocked、gate 计数和 `next_action`。`context --json --since-revision <revision>` 返回该 revision 之后的 event，以及当前最小状态；调用方必须已有对应 baseline，delta 不能替代完整 context。`--brief`、`--status` 和 `--since-revision` 互斥。

context 的 `current` 只表示当前 actor 的 state 指针是否指向该 task。`task.writer.primary_writer` 是 task 主写方，`task.writer.task_status` 表示 task 是否已有 writer，`task.writer.caller_capability` 表示调用方是否可写；兼容字段 `task.writer.status` 继续给出调用方相对 task 的汇总状态。`task.authorization` 统一投影 schema 2 的 `implementation_approval` 与 schema 3 的 `work_basis`，但不改写 task 真源。

省略 `--history` 时，`context --json`、`context --json --brief` 和 `context --json --since-revision` 保持既有响应：同时返回用户可读 `timeline` 与原始 `recent_events` 或 `events`，timeline item 也保留 `details`。既有 reader 无需改动。

`--history` 只适用于 JSON Context，可取 `timeline`、`events` 或 `both`，并可与 `--brief` 和 `--since-revision` 组合。显式选择会返回 `history_view`：

- `timeline`：只返回 timeline，省略 raw event 与 `timeline.details`，适合作为普通恢复视图；
- `events`：只返回 raw event，适合调试、审计和兼容性核对；
- `both`：返回与默认相同的两套历史字段，用 `history_view: "both"` 标明显式选择。

`--status --history`、非 JSON 的 `--history` 和非法枚举值均会被拒绝。selector 只投影响应字段，不修改 task、event 存储或 timeline 文案语义。

### 更新计划和状态

```bash
latch save <task-id> --expect-revision 3 --plan-file plan.json
latch save <task-id> --expect-revision 4 --decision "采用本地 JSON"
latch save <task-id> --expect-revision 5 --block-reason "等待接口" --waiting-for "后端确认"
latch save <task-id> --expect-revision 6 --unblock
latch save <task-id> --expect-revision 7 \
  --provenance mixed --provenance-reason "用户允许重叠并行"
```

plan 任一持久化值变化都会增加 `plan_revision`，phase 回到 plan，并使旧批准、gate 和 submission 失效。

schema 3 新 task 的根 `provenance` 默认为 `clean`。只有明确允许路径重叠并行时才写
`mixed`；隔离恢复后，使用同一命令显式写回 `clean`。provenance 更新必须单独执行，
只增加 task revision，并用现有 decision event 记录 reason。

### 批准实施

```bash
latch approve <task-id> --expect-revision 7 --reason "用户批准当前 plan"
latch approve <task-id> --expect-revision 12 --feedback "修正实现细节"
latch approve <task-id> --expect-revision 13 \
  --non-implementation-feedback "修正文档表述，代码未变"
```

首次批准绑定当前 plan revision。review 中的明确实现修正保留 plan approval，增加 `work_revision` 并回到 dev。发现其他活动 task 时，批准仍会成功，并提示共享 worktree 风险。

`--non-implementation-feedback` 只用于 schema 3 中实现快照未变化的 review 修正。该操作追加 `review_feedback` 事件，但保持 phase、`work_revision`、verification 和 submission 不变；不得用于代码、配置、生成输入或其他可能影响 gate 的改动。R2 downgrade 将该分类投影为 `evaluative`。

### 验证

```bash
latch verify <task-id> --expect-revision 8 --name typecheck
latch verify <task-id> --expect-revision 9 --diagnostic --name exploratory -- pnpm typecheck
```

普通 gate 执行 plan 保存的 argv，不接受调用方替换命令。diagnostic 可以使用 plan 命令或 `--` 后的临时 argv，不参与 submit 门禁。验证进程不经过 shell。

### 提交 review

```bash
latch submit <task-id> --expect-revision 10 \
  --changes "完成实现" \
  --unverified "未做浏览器验收" \
  --knowledge-impact-none "未修改长期知识"
```

也可继续使用结构化文件记录 `updated` 或复杂 impact：

```bash
latch submit <task-id> --expect-revision 10 \
  --changes "完成实现" \
  --unverified "未做浏览器验收" \
  --knowledge-impact-file impact.json
```

`--knowledge-impact-none <reason>` 只构造 `{ kind: "none", reason }`，必须提供
非空 reason，且不能与 `--knowledge-impact-file` 组合。`updated` 仍必须通过文件
提供 artifact refs。

无可执行 gate 的任务使用：

```bash
latch submit <task-id> --expect-revision 4 \
  --no-verify \
  --reason "只有文档改动" \
  --changes "更新设计说明" \
  --unverified "未运行代码测试" \
  --knowledge-impact-file impact.json
```

schema 3 submission 必须通过 `impact.json` 提供 `knowledge_impact`，使用 `none` 时 reason 需说明为何不更新模块知识。submission 绑定当前 work revision，verified 摘要由结构化 gate 结果生成。

context 会在 `artifact_delivery` 中标记 task 已声明 artifact 的 Git 状态：`tracked`、`untracked`、`ignored`、`missing` 或 `unknown`。submit 对非 `tracked` artifact 返回非阻断 warning，并单独列出 worktree 中全部 untracked 文件；后者不自动归类为 artifact 或实现文件。Git 状态不把 ignored 文件自动解释为「本地知识」，也不增加 submit 或 done 门禁。

### 修正 review submission 的知识影响

```bash
latch patch-submission-knowledge-impact <task-id> \
  --expect-revision 11 \
  --knowledge-impact-file impact.json

latch patch-submission-knowledge-impact <task-id> \
  --expect-revision 12 \
  --knowledge-impact-file corrected-impact.json \
  --reason "提交时误判了知识影响"
```

该命令复用同一入口处理两种情况：legacy submission 缺少 `knowledge_impact` 时补齐；已有值时原地修正。后者必须提供非空 `--reason`，相同 impact 会被拒绝。两种情况都要求 schema 3、非 blocked、review、当前双 revision、有效 work basis、仍有效的 gate 或无 gate 的合法 `no_verify` proof，以及合法的 artifact 引用。

修正只增加 task revision，保留 phase、plan/work revision、work basis、verification 和 submission 其余字段。只有实现、配置、生成输入、gate 对象与公共行为均未变化时，调用方才能保留 proof；否则应使用 `approve --feedback` 开启新的 work revision，而不是调用 patch。审计 event 会区分补齐和修正；修正记录原因及前后 impact。该命令不编辑知识文档或 freshness baseline。

### 归档或放弃

```bash
latch done <task-id> --expect-revision 11 --followup "后续观察"
latch abandon <task-id> --expect-revision 5 --reason "用户取消"
```

`done` 只接受 review 中当前 work revision 的有效 submission。`abandon` 必须提供原因。AI 只有获得明确用户授权后才能执行这两个命令。

两条命令的 JSON 响应都保留既有 `outcome` 与最后开放 phase，并增加
`archived: true` 以明确目录已归档；不把 `done` 或 `abandoned` 加入 phase 枚举。

### Schema 3 回退

需要让 schema 3 task 重新被 v2 CLI 读写时，先明确确认 v3 专用字段和 event 细节只保留在 backup，再执行：

```bash
latch downgrade-v2 \
  --task <task-id> \
  --expect-revision 8 \
  --confirm-data-loss
```

命令支持 open 或 archived task，并在改写前将完整 task 目录复制到 `.latch/archive/v3-backup/<task-id>-<utc-ts>/`。主 `task.json` 投影为 schema 2，主 `events.jsonl` 只保留 v2 event 并将 revision 重写为 `1..n`；`state.json` 不改写。失败时保留 `.latch` 和已创建的 backup。

## 并发与文件

- task：`.latch/tasks/<task-id>/task.json`；
- event：`.latch/tasks/<task-id>/events.jsonl`；
- actor current：`.latch/state.json`；
- archive：`.latch/archive/YYYY-MM/<task-id>/`。

所有 task 更新需要 `--expect-revision`。task 使用独立短锁；需要组合锁时顺序固定为 `task -> state`。Latch 不跟踪 task 的文件归属，验证命令针对整个 worktree；需要代码隔离时由用户使用外部 Git worktree，Latch 不负责创建或合并它。

同一连续写入流程中，成功 mutation 的 JSON 返回值包含新的 `revision`。下一条命令直接使用该值作为 `--expect-revision`，不得只为获取 revision 重读 context。发生 revision conflict、进入新的用户输入边界、warning 需要重新判断或任务语义变化时，再刷新 status；冲突 mutation 不得自动重试。

### 顺序跨会话交接

fork 或新对话都会产生新的 session actor。即使继续同一 workspace 和同一 task，新 session 也必须取得明确的 takeover 授权；仅包含 plan approval 的交接提示词不能绕过 `primary_writer` 门禁。

交接提示词应包含 task ID、当前 phase/revision、旧 `primary_writer`、未完成的批准项和 gate、`git status --short` 摘要及共享 worktree 风险。用户须明确说明旧 session 停止写入该 task，并授权新 session 执行：

```bash
latch takeover <task-id> --expect-revision <revision> --reason "用户明确授权交接" --json
```

takeover 不改变 phase、plan approval 或 gate，也不构成 implementation approval。若同一用户消息同时明确授权 takeover 和当前 plan，则先 takeover，再将其 JSON 返回的 `revision` 用于 `approve`；否则在 takeover 后等待单独批准。正常顺序交接保持 `provenance: clean`，只有明确允许重叠并行时才写入 `mixed`。

## 最终契约能力

C1–C8 已在当前发布中交付。C1–C3 的 session writer、Light 证明包与 Group 最小集已接入真实 schema 3 task；Light request/retrospective 可通过真实 `checkpoint` 原子创建，task 根 provenance 可显式维护；C4 提供独立于 task schema 的 Git 知识文档 freshness 只读检查；C5 提供受预算 Context pack 与 benchmark diagnostic；C6 提供 legacy claim/patch 升级与 R2 回退；C7/C8 提供 current 产品契约与 A/B/C 指令面。

Group 只聚合 task，不增加 group phase、revision、锁或完成门禁。schema 3 task 可使用 `save --group` 或 `save --clear-group` 修改单张 task；`list --group [--include-archive]` 返回精确匹配的成员与派生计数，`context` 只附带受限的 sibling 摘要。Group 变更不会修改 plan、work basis、verification 或 submission。

知识文档使用 YAML frontmatter 的 `covers`、`status`、`last_fingerprint` 与 `last_fingerprint_algo` 判定 freshness：

```bash
latch knowledge fingerprint --path docs/modules/example.md --json
latch knowledge check --path docs/modules/example.md --json
latch knowledge check --task <task-id> --json
```

`fingerprint` 只计算 `sha256-v1`；`check --path` 返回 `fresh`、`stale`、`baseline_missing`、`error` 或 `retired`；`check --task` 只检查当前 submission 中 `knowledge_impact.updated` 引用的 artifact。三种调用都不写知识文档、task、events 或 state。baseline 只能由已授权的普通文档编辑更新，freshness 结果不增加 submit、done 或 group 门禁。

Context pack 与 benchmark 使用结构化 JSON 输入：

```bash
latch context pack --input-file context-request.json
latch benchmark context --case-file case.json --run-file run.json --json
latch benchmark context --case-file case.json --run-file run.json \
  --baseline-run-file broad.json --json
```

`context-request.json` 可包含 `task_id`、`knowledge_paths`、map/excerpt/expand `sources` 和上次返回的 orientation 计数。CLI 按 task、knowledge、map、sibling、excerpt、expand 排序，默认限制 task 4000、知识/地图/兄弟累计 6000、单包 24000、扩读单批 8000、同 orientation 累计 48000 Unicode code points；`meta.char_count` 统计最终 JSON 和尾部换行。orientation 只由调用方回传，不写 `.latch`；换 task、开始实施或结束 orientation 时丢弃旧计数。

`benchmark context` 只校验 case/run 并计算主成功和 30% 次目标，不执行检索、CodeGraph 或模型判断，也不成为 task gate。

schema 3 event 文件允许可选的首行 `events_meta`；未知 v3 event 会被跳过并以 `warnings` 返回，schema 2 reader 仍对未知 event fail closed。schema 3 的 `min_cli_version` 为 `0.2.0`。

最终产品契约已全面 current；v2 中未被最终分章覆盖的条款继续作为历史基线有效。
