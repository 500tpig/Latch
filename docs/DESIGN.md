# Latch 设计取舍与边界

本文件只讲 Latch 为什么这样设计、边界在哪、不做什么。命令用法和阶段流程见 `docs/HANDBOOK.md`,触发规则见 `AGENTS.md`。

## 定位

Latch 是一个纯 AI coding harness:项目内的任务状态锁存器。小请求不进入;任务变长、碰风险域,或用户要求规划项目、讨论路线图时,锁住现场,之后必须经过阶段、验证和用户确认才能归档。

同一项目可以同时保留多个 open task,`state.json` 只保存一个 `current_task_id`。命令默认操作 current task,`--task <id>` 或 `latch use` 切换。

## 非目标

v0 不做这些能力,只有跑通后、且缺了会明显影响使用时才加:

- 自然语言任务分类器。
- worktree 隔离。
- 自动 commit。
- dashboard。
- workflow YAML。
- 子 agent 编排。
- 知识库、workspace journal 或长期 spec 管理。
- 默认 PRD、设计文档或实现计划文件。

## 关键取舍

- **CLI 不当裁判**:进入需要结论的阶段时只铺空模板,逼 AI 按格子填,但不解析 `notes.md` 判断填得好不好。Latch 只保证流程不被跳过,不评价内容质量。
- **`notes.md` 是给人和 AI 读的,不是 CLI 的结构化输入**:结构化状态在 `task.json`,过程记录在 `notes.md`,追溯用 `events.jsonl`。三者分开,CLI 只读结构化部分。
- **`done` 不负责 commit**:归档和版本控制分开。`git commit` / `git push` / `latch done` 都要用户明确确认,不做默认后续动作。

## 长期知识库集成边界

Latch 可以把归档任务作为外部知识库的原料,但 v0 不直接集成 MindOS 这类长期知识库,也不在 `done` 时解析 `notes.md` 判断 closure 质量。

需要把 Latch 经验沉淀进长期知识库时,由外部工具读取 `.latch/archive/` 后自行蒸馏;Latch 继续只维护项目内任务状态、事件和验证结果。
