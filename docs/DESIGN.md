# Latch v2 设计边界

## 定位

Latch 是个人 macOS 开发环境中的本地任务状态记录器。它帮助 AI 保存明确 task 的当前计划、实施批准、验证和 review 状态，不替代项目管理系统或 Git。

## 当前事实

- `task.json` 保存当前状态；
- `events.jsonl` 保存可追溯历史；
- `state.json` 只保存各 actor 的 current task；
- 项目正式文档通过 artifact 关联，并从 `docs/INDEX.md` 发现。

## 关键取舍

- 创建 task 不等于批准实施；
- 每张 implementation task 单独获得 direct approval；
- plan 和 work revision 使旧结果明确失效；
- 不同 task 可以在同一 workspace 独立推进；共享 worktree 风险通过 warning 提示；
- 原子写和短锁保护当前事实，不引入通用事务框架；
- archive 使用目录 rename 作为提交点。

## 非目标

Latch 不提供：

- 自动任务分类、创建或查重；
- 任务树、依赖图、排期或百分比；
- 聊天、日志或 knowledge 存储；
- 向量检索、RAG 或跨 repo 搜索；
- 自动 Git、hook 或 worktree 管理；
- Board 写操作；
- 多用户、远程同步或公共 npm 发布；
- v1 migration 或兼容层。

新能力在 v2 完成真实使用观察后单独评估。
