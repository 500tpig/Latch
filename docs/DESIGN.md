# Latch 设计边界

## 定位

Latch 是个人 macOS 开发环境中的本地任务状态记录器。它帮助 AI 保存明确 task 的当前计划、实施批准、验证和 review 状态，并提供独立的 project-local Record 保存显式轻量记录。Latch 不替代项目管理系统或 Git。

当前产品契约见 [Latch 最终产品契约](prd/2026-07-15-latch-final-product-contract.md)。

## 触发规则

对会导致仓库写入或明确改变可观察行为的请求，先使用触发章 A/B/C 判定表：A 停在 grill；B 创建或续接 light task 并以请求授权；C 创建或续接 standard task，展示 plan 后等待明确 approve。纯问答、只读探索、无写入意图或明确要求「不用 Latch」的请求不建 task。

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
- 新 task 使用 schema 4，并保存 `min_writer_version: "0.4.0"`、`primary_writer` 和 `profile`；CLI 0.2.0 和 0.3.0 在 task 读盘时拒绝该格式。
- schema 3 只作为历史读取和显式迁移来源；open schema 3 task 的普通 mutation 全部拒绝。当前 primary writer 通过单 task `upgrade-v4` 升级；原 writer 永久不可用时，获得具体 task 和 revision 的明确恢复授权后，新的 canonical session 可通过 `upgrade-v4 --recover-writer --reason <text>` 同时完成升级和 writer 转移。
- schema 4 新 task 写入根 `provenance: clean`；历史 schema 2/3 task 缺失该字段时按 `clean` 读取，只有明确的重叠并行或隔离恢复才显式修改。
- light request 与 retrospective task 可在 `checkpoint` 时原子写入 work basis，不需要创建后再拼接生命周期状态。
- plan validation 分为历史可读 shape、schema 4 writable 和 authorizable 三层；只有第三层在创建或更新 work basis 前要求执行字段完整，并按 profile 检查 Light gate。
- Light 与 Standard scaffold 共用 `TaskPlan` shape，只证明结构合法，不能直接获得 work basis。
- 新 plan 使用 `workspace_scope.paths` 保存机器范围；自然语言 `plan.scope`、授权摘要和 artifact 不替代该字段，获得 work basis 前 paths 必须非空。
- named gate 保存 command outcome、before/after workspace evidence、workspace effect 和 proof generation；只有当前 generation 上的完整无 mutation proof 才能参与 submit。
- workspace evidence 覆盖 Git-visible 脏路径、非 ignored untracked 路径，以及 scope 或 artifact 精确引用的 ignored 文件；不递归扫描 ignored 目录。
- schema 3/4 task 可通过带完整 backup 的 `downgrade-v2` 投影回可写 schema 2；主投影剥离 writer 元数据和 workspace proof 扩展，完整数据只保留在来源 schema backup。
- `docs/INDEX.md` 指向唯一 current 产品契约；既有七个分章与 Record 分章按主题覆盖历史 v2 基线。

## 关键取舍

- 创建 task 不等于批准实施；
- 每张 implementation task 单独获得 direct approval；
- plan 和 work revision 使旧结果明确失效；
- proof generation 表示稳定的 covered workspace baseline；工作区 mismatch 或 gate mutation 使旧 generation 的 named gate proof stale。
- scope 内 mutation 拒绝当前 gate pass；scope 外 mutation 还创建 unresolved violation，并在恢复或重新批准前阻止 submit。
- `context` 只读计算 live workspace status，不推进 generation，也不写 task、event 或 evidence。
- 不同 task 可以在同一 workspace 独立推进；共享 worktree 风险通过 warning 提示；
- 原子写和短锁保护当前事实，不引入通用事务框架；
- provenance 只保存在 task 根，不复制到 submission 或 closure；
- archive 使用目录 rename 作为提交点。
- 已知完整 Task ID 时，Context 先读 open task，再按精确 ID 只读回退 archive；所有 mutation 继续只解析 open task。
- R2 回退先备份整个 task 目录，再重写 event，最后以 `task.json` 作为格式切换提交点。
- schema 4 的机器拒写提交点是 `task.json`；event log 继续使用 forward-compatible 的 `events_schema_version: 3`，不承担 writer capability 判断。
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
- v1 migration 或兼容层。

后续扩展必须保持 workspace coverage 与未覆盖边界可见，不能静默回退到仅按退出码判断 gate。
