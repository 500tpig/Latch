# Latch 设计边界

## 定位

Latch 是个人 macOS 开发环境中的本地任务状态记录器。它帮助 AI 保存明确 task 的当前计划、实施批准、验证和 review 状态，并提供独立的 project-local Record 保存显式轻量记录。Latch 不替代项目管理系统或 Git。

当前产品契约见 [Latch 最终产品契约](prd/2026-07-15-latch-final-product-contract.md)。

## 触发规则

对会导致仓库写入或明确改变可观察行为的请求，先使用触发章 A/B/C 判定表：A 停在 grill；B 创建或续接 light task 并以请求授权；C 创建或续接 standard task，展示 plan 后等待明确 approve，通常先展示已创建的 task id。纯问答、只读探索、无写入意图或明确要求「不用 Latch」的请求不建 task。

已决设计的纯状态同步是 B 的窄例外：设计正文必须已冻结、`open_questions` 为空、用户已明确批准当前设计，改动只涉及 artifact 状态与索引元数据，且不新增产品选择、公共行为或 scope。可写且 approved scope 已覆盖的 open 来源 task 继续原 lifecycle；关闭、只读或不存在来源 task 时才创建并原子授权 Light task。open 来源 task 存在 writer 或 scope 问题时先处理 handoff 或 plan。任一条件不满足时重新执行 A/B/C。

设计 task 可以用 `proposed` artifact 进入 review，但 plan 必须包含批准后的状态与索引同步。用户批准设计后复用同一 task 完成同步和验证，不为状态迁移单独创建 Standard task。Standard plan 的明确授权可以紧邻发生在 checkpoint 前，但仅限 Agent 已展示 material plan 且持久化内容未发生材料变化；需判断 warning、plan 变化、普通写入请求或旧消息均不能授权。

启动时，`latch list --json --brief` 在未初始化目录中返回稳定的
`error.code: "not_initialized"`。canonical Skill 收到该错误后立即停止 Latch
流程，不生成 template 或 plan，不调用 `checkpoint`，也不自动执行 `latch init`。
该只读探测不创建项目文件。

## 当前事实

- `task.json` 保存当前状态；
- `events.jsonl` 保存可追溯历史；
- `state.json` 只保存各 actor 的 current task；
- `.latch/records/index.json` 只保存 Record 元数据，正文位于独立 Markdown 文件；
- 项目正式文档通过 artifact 关联，并从 `docs/INDEX.md` 发现。
- 新 task 使用 schema 5，并保存 `min_writer_version: "0.5.0"`、`primary_writer` 和 `profile`；CLI `0.5.0` 是 current writer。
- schema 2–4 仅供 historical read-only。CLI `0.5.0` 可读取这些 task，但在 mutation、event、evidence、backup 或 archive 写入前返回 `writer_version_mismatch`。
- schema 5 新 task 写入根 `provenance: clean`；历史 task 缺失该字段时按 `clean` 读取，只有明确的重叠并行或隔离恢复才显式修改。
- light request 与 retrospective task 可在 `checkpoint` 时原子写入 work basis，不需要创建后再拼接生命周期状态。
- plan validation 分为历史可读 shape、schema 5 writable 和 authorizable 三层；只有第三层在创建或更新 work basis 前要求执行字段完整，并按 profile 检查 Light gate。
- Light 与 Standard scaffold 共用 `TaskPlan` shape，只证明结构合法，不能直接获得 work basis。
- 新 plan 使用 `workspace_scope.paths` 保存机器范围；自然语言 `plan.scope`、授权摘要和 artifact 不替代该字段，获得 work basis 前 paths 必须非空。
- `append-scope` 是独立的 scope-only plan delta：只追加 normalized path，拒绝 repo root、glob、删除、替换、缩小和 no-op。未提供结构化 authorization 时回到 `plan`；只有显式 `user_delta` 或 `user_approve` 通过 post-delta 校验后，才原子绑定新 plan revision 并进入 `dev`。
- `update-verification-command` 是独立的 gate-command-only plan delta：只按 exact name 更新唯一现有 `kind: gate` 的 argv，拒绝未知 name、重复 name、diagnostic、空 argv、相同 argv、sentinel 与 instruction-only command。未提供结构化 authorization 时回到 `plan`；只有显式 `user_delta` 或 `user_approve` 通过 post-delta 校验后，才原子绑定新 plan revision 并进入 `dev`。
- `resolve-open-questions` 是独立的原子 open-question plan delta：只接受 `plan` 阶段当前全部问题的结构化 exact resolution，清空 `plan.open_questions`，并按输入顺序记录 `plan_updated` 与 `decision_recorded` events。未提供 authorization 时回到 `plan`；只有显式 `user_approve` 通过 post-delta 校验后，才原子绑定新 plan revision 并进入 `dev`。
- named gate 保存 command outcome、before/after workspace evidence、workspace effect 和 proof generation；只有当前 generation 上的完整无 mutation proof 才能参与 submit。
- workspace evidence 覆盖 Git-visible 脏路径、非 ignored untracked 路径，以及 scope 或 artifact 精确引用的 ignored 文件；不递归扫描 ignored 目录。
- 新 evidence 在既有 dirty `entries` 外保存可选的 `scope_entries` 内容视图；gate 前后仍比较完整 dirty worktree，review live freshness 与 done 只比较 task scope 的 worktree 内容。历史 sidecar 缺少该字段时继续使用旧的 fail-closed 比较，不迁移或重写。
- schema 5 submission 使用结构化 `unverified_items`，closeout 为每项保存 `resolved`、`accepted_risk` 或 `followup` resolution；不保留自由文本 closeout 双路径。
- schema 5 Context 在最小 lifecycle 投影之外提供 bounded item、resolution 摘要和 reviewer next action；`tests/fixtures/context-v5-board-reader.json` 是 Board/adopter 的冻结读取契约。
- `context --json --review` 组合最小 lifecycle、named gate、live proof 与有界的 schema 5 submission/closeout 投影，默认不携带历史，也不复制 task 真源或 verification proof。
- schema 5 review submission 的 proof stale 时，Context 使用 `reopen_review` 替代 closeout 动作；writer mismatch 仍先返回 `takeover`，并通过 bounded `after_takeover_next_action` 预告接管后的恢复动作。
- 所有成功 task mutation 的 JSON 复用 `status` 投影的 `next_action` 派生规则，并按 mutation 后的 task、writer 与 live proof 状态返回下一步；已有 proof 时还复用同一 bounded `workspace_proof` 投影，没有 proof 时省略该字段；归档 mutation 返回 `read_only`。
- status 与成功 mutation JSON 复用 bounded `shared_worktree` 投影，统计其他 open task 及 plan scope overlap；sample 最多返回 8 条确定性排序的 task ID 与相交 path。缺少 historical `workspace_scope` 的 task 只计入 active task，不推断 overlap。
- CLI error envelope 将明确的生命周期拒绝投影为稳定领域 code：`phase_mismatch`、`proof_stale` 和 `workspace_violation`；Core 通过领域错误类型携带 code，未知异常仍为 `command_failed`。
- open task 的 `workspace_proof.live_changes` 以 bounded additive view 展示 task scope content、ambient、index content 与 delivery state 计数和最多 8 个样本；该投影不改变 `live_status` 或 lifecycle 门禁。
- `docs/INDEX.md` 指向唯一 current 产品契约；既有七个分章与 Record 分章按主题覆盖历史 v2 基线。

## 关键取舍

- 创建 task 不等于批准实施；
- 记录已经明确作出的设计决定不等于重新作出产品选择；只有满足冻结正文、空 `open_questions`、显式批准和纯元数据 scope 的状态同步才可使用 Light；
- 每张 implementation task 单独获得 direct approval；
- plan 和 work revision 使旧结果明确失效；
- proof generation 表示稳定的 covered workspace baseline；gate mutation 或 task scope 内容 mismatch 使旧 generation 的 named gate proof stale。scope 外 ambient 变化保持可见，但不会单独使 review submission stale。
- workspace delta 以 additive `category` 区分 `content`、`index_content` 和 `delivery_state`；Git add、取消暂存或 commit 在 worktree 字节未变化时属于 delivery evidence，不替代 Git 交付，也不单独使 review proof stale。
- stale review 使用显式 `reopen-review` 返回 `dev`、推进 work revision 并移除旧 submission，之后重新运行 `verify-all` 并提交；proof 或 Git 状态恢复不伪装成 implementation feedback，也不允许在 review 中刷新 gate 后复用旧 submission。
- scope 内 mutation 拒绝当前 gate pass；scope 外 mutation 还创建 unresolved violation，并在恢复或重新批准前阻止 submit。
- 独立 `reconcile` mutation 只在 schema 5 的 `dev` / `check` 阶段按 violation 原始 `before` entry 精确恢复；当前 scope reclassification、近似内容和调用方选择都不能清除 violation。成功调用单次推进 proof generation、删除 submission，并要求重新验证；no-op 与拒绝不写 task、event 或 evidence。
- `append-scope` 不采集 workspace，也不创建或重写 evidence。scope coverage 变化会移除 active `workspace_proof` 引用，保留历史 sidecar，并使旧验证与 submission 失效；后续 `verify` 或 `verify-all` 为追加后的完整 scope 建立新 generation。
- `update-verification-command` 不采集 workspace，也不创建或重写 evidence。command 变化会清空全部 verification result 并删除 submission，但 machine scope 未变时保留既有 `workspace_proof` baseline；命令本身不运行新旧 gate command，也不推进 proof generation。
- `resolve-open-questions` 不采集 workspace，也不创建或重写 evidence。问题 resolution 会清空旧 verification 与 submission，但 machine scope 未变时保留既有 `workspace_proof` baseline；答案文件不进入 workspace evidence。
- `context` 只读计算 live workspace status，不推进 generation，也不写 task、event 或 evidence。
- 不同 task 可以在同一 workspace 独立推进；结构化 scope overlap 与 human warning 均不声明文件归属、不自动修改 provenance，也不阻止 lifecycle mutation；
- 原子写和短锁保护当前事实，不引入通用事务框架；
- provenance 只保存在 task 根，不复制到 submission 或 closure；
- archive 使用目录 rename 作为提交点。
- 已知完整 Task ID 时，Context 先读 open task，再按精确 ID 只读回退 archive；所有 mutation 继续只解析 open task。
- schema 5 的机器拒写提交点是 `task.json`；event log 继续使用 forward-compatible 的 `events_schema_version: 3`，不承担 writer capability 判断。
- workspace evidence sidecar 使用原子写和 SHA-256、entry count 校验；未引用、缺失、损坏或计数不一致的 sidecar 不构成 proof。
- Record 与 task 完全分离，只复用 repo root、原子写和短锁；Record 关联不传播状态、writer 或授权。
- Record 索引不含正文，AI 只在用户明确保存或召回时访问，默认最多返回 5 条候选。

## 非目标

Latch 不提供：

- 自动任务分类、创建或查重；
- 任务树、依赖图、排期或百分比；
- 聊天、日志或全局 knowledge store；
- 向量检索、RAG 或跨 repo 搜索；
- 自动 Git、hook 或 worktree 管理；
- gate mutation 自动回滚、允许 mutation 后继续 pass，或通过 argv 猜测写入意图；
- 全量 ignored 目录监视、commit hash 或最终 tree hash 证明；
- Board 写操作；
- 多用户、远程同步或公共 npm 发布；
- schema upgrade、downgrade、双写、字符串 closeout migration 或历史 archive 重写。

后续扩展必须保持 workspace coverage 与未覆盖边界可见，不能静默回退到仅按退出码判断 gate。
