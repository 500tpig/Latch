# Latch 项目规则

## Latch 入口

只有请求明确提到 Latch 时，才创建或继续 task。分析建议、普通问答和小修不自动进入 Latch。

开始前按顺序执行：

1. `git status --short`；
2. `latch list --json --brief`；
3. 用户点名 task 时执行 `latch context <task-id> --json --brief`，否则读取当前 task；
4. 从 `docs/INDEX.md` 选择与当前任务直接相关的 1–3 份文档。

不得读取其他 Codex 会话或跨会话材料。需要扩大范围时，先说明当前 repo 内证据为何不足。

## 用户授权

- 创建 task 前必须有明确的 Latch 请求。
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
- 验证强度与风险匹配；完成前至少运行相关测试和 `git diff --check`。
- 不自动执行 Git add、commit、push。

## v2 边界

- phase 只有 `plan`、`dev`、`check`、`review`。
- blocked 是附加状态，不是 phase。
- 同一 workspace 同时只允许一张 task 处于 `dev`、`check` 或 `review`。
- 锁顺序固定为 `workspace -> task -> state`。
- task.json 是当前事实；events 是历史，state 是 actor 的 current 索引。
- 不实现自动任务分类、knowledge、聊天保存、自动 Git 或自动 worktree。

## 文档与验证

- 当前文档入口：`docs/INDEX.md`。
- CLI 参考：`docs/HANDBOOK.md`。
- 设计边界：`docs/DESIGN.md`。
- 安装与回退：`docs/AI_INSTALL.md`。
- canonical skill：`skills/latch/SKILL.md`。
- 中文技术文档采用克制、准确、可扫读的写法；机器可读标识符保持原样。
