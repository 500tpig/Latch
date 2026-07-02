# Latch 设计取舍与边界

本文件只讲 Latch 为什么这样设计、边界在哪、不做什么。命令用法和阶段流程见 `docs/HANDBOOK.md`,触发规则见 `AGENTS.md`。

## 定位

Latch 是一个纯 AI coding harness:项目内的任务状态锁存器。小请求不进入;任务变长、碰风险域,或用户要求规划项目、讨论路线图时,锁住现场,之后必须经过阶段、验证和用户确认才能归档。

同一项目可以同时保留多个 open task。默认任务不再是全局唯一: `state.json` 为每个 actor 保存自己的 `current_task_id`，任务本身记录 `owner`。命令默认操作当前 actor 的 current task；`--task <id>` 可显式指定任务，`latch use <id> --force` 可接管别的 actor 任务。`checkpoint --new` 用来明确“这是另一张新任务”，不再靠是否已有 current 猜意图。

## 非目标

v0 不做这些能力,只有跑通后、且缺了会明显影响使用时才加:

- 自然语言任务分类器。
- worktree 隔离。
- 自动 commit。
- dashboard。
- workflow YAML。
- 子 agent 编排。
- 知识库、workspace journal 或长期 spec 管理。
- 默认把每个任务都升级成 PRD、设计文档或实现计划文件。

## 关键取舍

- **CLI 不当裁判**:进入需要结论的阶段时只铺空模板,逼 AI 按格子填,但不解析 `notes.md` 判断填得好不好。Latch 只保证流程不被跳过,不评价内容质量。
- **`notes.md` 是给人和 AI 读的,不是 CLI 的结构化输入**:结构化状态在 `task.json`,过程记录在 `notes.md`,追溯用 `events.jsonl`。三者分开,CLI 只读结构化部分。
- **`done` 不负责 commit**:归档和版本控制分开。`git commit` / `git push` / `latch done` 都要用户明确确认,不做默认后续动作。
- **默认任务按 actor 隔离,不是共享全局指针**:多 agent 并行时,共享一个 `current_task_id` 天然会互抢。Latch 改成 actor 各自持有默认任务,任务 owner 只在显式 `--force` 时转移,把“默认命令串任务”从模型上拿掉。

## 长期知识库集成边界

Latch 可以把归档任务和项目内知识卡作为外部长期知识库的原料,但 v1 不直接集成 MindOS 这类长期知识库,也不在 `done` 时解析 `notes.md` 判断 closure 质量。

需要把 Latch 经验沉淀进外部长期知识库时,由外部工具读取 `.latch/archive/` 和 `.latch/knowledge/` 后自行蒸馏;Latch 继续只维护项目内任务状态、事件、验证结果和项目内知识卡,不负责外部知识平台同步。

## 正式文档边界

Latch 不反对 PRD 或 brief,但它们不住在 `.latch/` 里。

- `task.json` 是运行时结构化状态
- `notes.md` 是过程记录
- `knowledge` 是复用经验
- 正式方案文档单独放在 `docs/briefs/` 或 `docs/prd/`

也就是说,任务可以额外产出 brief 或 PRD,但那是面向人读的正式文档层,不是用来替代 Latch 状态文件。

## 知识记忆 v1 边界

v1 只服务当前 repo 的 AI coding 续接,不扩成通用个人脑系统。

- 任务知识卡是真源,格式是 `md + YAML frontmatter`
- 模块卡只是派生视图,不单独当真源维护
- 正式知识卡只在 `finish` 阶段生成
- citation 最少包含 `path`、`symbol` 和 `source_task`,`line` 可选
- 默认召回顺序固定为:文件路径 -> 关键词 -> 模块卡 -> 原始任务
- 第一版直接扫描 `.latch/knowledge/tasks/*.md`,先不引入显式索引目录
