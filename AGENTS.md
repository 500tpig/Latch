# Latch 项目规则

## Latch 入口

对会导致仓库写入或明确改变可观察行为的请求，先按 A/B/C 判定是否创建或续接 task：

- A：目标、成功标准、范围、根因或高风险改法不明确时，停在 grill，不实施；
- B：改法和范围明确、低风险、`open_questions` 为空且不扩 scope 时，创建或续接 light task，`source: user_request` 作为授权；
- C：需要方案确认、多 gate 或存在高风险面时，创建或续接 standard task，展示 plan 后等待明确 approve。

纯问答、只读探索、无写入意图或明确要求「不用 Latch」时不建 task。显式 Latch 请求直接进入同一判定表，不是唯一入口。

开始前按顺序执行：

1. `git status --short`；
2. `latch list --json --brief`；
3. 用户点名 task 时执行 `latch context <task-id> --json --status`；未点名时，仅当 list 返回 `current_task_id` 才读取对应 status；两者都没有时，不得调用无 task ID 的 `latch context --json --status`；
4. 需要 goal、scope、acceptance、完整 gate、submission 或可读过程时，优先展开 `--brief --history timeline`；只有调试、审计或兼容核对时读取原始 event；
5. 只有已持有同一 task 对应 revision 的可信 baseline 时才使用 `--since-revision`，不得用 delta 代替跨会话完整恢复；
6. 先读取 task artifact；只有任务涉及产品契约、架构、安装、文档行为，或现有证据不足时，才从 `docs/INDEX.md` 选择直接相关文档。

同一连续写入流程中，成功 mutation 的 JSON 返回值已包含下一次所需的 `revision`；直接将其用于下一条命令的 `--expect-revision`，不得只为获取 revision 重读 context。发生 revision conflict、进入新的用户输入边界、warning 需要重新判断或任务语义变化时，再刷新 status；不得自动重试冲突 mutation。

不得读取其他 Codex 会话或跨会话材料。需要扩大范围时，先说明当前 repo 内证据为何不足。

## 用户授权

- 创建或续接 task 前必须有明确的用户写入请求；无需用户额外点名 Latch。显式 Latch 请求直接进入同一 A/B/C 判定表。
- plan 必须展示给用户；只有明确实施授权后才能执行 `approve`。
- `done` 只能在用户明确要求完成、归档或结束 task 后执行。
- `abandon` 只能在用户明确要求放弃或取消后执行。
- 模糊认可不作为实施、归档或放弃授权。

## 开发规则

- 写代码前读取现有实现、相关测试和 import。
- 做最小可维护改动，不顺手重构或清理无关代码。
- 不回滚、覆盖或清理用户改动。
- 明确标识符先用 `rg`；仓库存在 `.codegraph/` 时，调用关系和删除影响使用 CodeGraph。
- JavaScript 和 TypeScript 命令使用 `pnpm`。
- 完成前运行 `pnpm check` 和 `git diff --check`；若任务只需更小范围验证，说明原因并运行相关测试。
- 不自动执行 Git add、commit、push。

## v2 边界

- phase 只有 `plan`、`dev`、`check`、`review`。
- blocked 是附加状态，不是 phase。
- 同一 workspace 的不同 task 可以独立处于 `dev`、`check` 或 `review`；共享 worktree 风险只作为 approve warning。
- 需要组合锁时顺序固定为 `task -> state`。
- task.json 是当前事实；events 是历史，state 是 actor 的 current 索引。
- 不实现自动任务分类、knowledge、聊天保存、自动 Git 或自动 worktree。

## 文档与验证

- 当前文档入口：`docs/INDEX.md`。
- CLI 参考：`docs/HANDBOOK.md`。
- 设计边界：`docs/DESIGN.md`。
- 安装与回退：`docs/AI_INSTALL.md`。
- canonical skill：`skills/latch/SKILL.md`。
- 中文技术文档采用克制、准确、可扫读的写法；机器可读标识符保持原样。
