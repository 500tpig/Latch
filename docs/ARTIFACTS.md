# Latch 文档分层

本文件只回答一件事：什么时候只用 Latch 记录，什么时候要额外产出给人看的正式文档。

## 四层产物

| 层级 | 位置 | 用途 | 谁来读 |
| --- | --- | --- | --- |
| 任务状态 | `.latch/tasks/<id>/task.json` | 当前阶段、目标、验收、知识记忆状态、artifacts 指针 | CLI、AI |
| 过程记录 | `.latch/tasks/<id>/notes.md` | 取舍、验证、closure、临时上下文 | AI、人 |
| 知识沉淀 | `.latch/knowledge/tasks/*.md` | 可复用做法、规则、引用 | AI、人 |
| 正式方案 | `docs/briefs/` 或 `docs/prd/` | 面向人阅读的需求、方案、边界 | 人 |

前两层是运行时内存，不追求好看。后两层才是正式产物。

## 什么时候只用 Latch

满足任一情况时，只用 `task.json + notes.md` 就够：

- 单点修复
- 小范围重构
- 文档整理
- 一次性内部流程调整
- 没有新增业务规则或跨页面流程

这类任务如有复用价值，再额外生成知识卡；没有就停在 Latch。

## 什么时候加 Brief

满足任一情况时，额外写一份一页式 brief，放到 `docs/briefs/`：

- 新增或修改一个中等功能
- 涉及一个页面里的多块交互联动
- 需要先说明范围、验收和不做什么
- 需要给后续实现、测试或复盘一个稳定参照

brief 不是 PRD，目标是用一页把事情说清。

## 什么时候加 PRD

满足任一情况时，额外写一份 PRD，放到 `docs/prd/`：

- 跨页面或跨模块流程
- 多角色、多状态或多入口
- 需求边界复杂，容易反复返工
- 需要长期维护、对齐或交接

PRD 解决的是“大家怎么理解同一件事”，不是“CLI 当前做到哪”。

## 推荐默认

- 小任务：只用 Latch
- 中任务：Latch + brief
- 大任务：Latch + PRD

如果拿不准，先写 brief；只有确实跨边界、跨角色、跨阶段时再升级成 PRD。

## 命名约定

- `docs/briefs/YYYY-MM-DD-<slug>.md`
- `docs/prd/YYYY-MM-DD-<slug>.md`

`slug` 用功能名、改动名或业务名，避免泛泛的 `plan`、`notes`、`update`。

## task 怎么指回正式文档

task 和正式文档的连接靠 `task.json` 上的 `artifacts` 数组，不靠人脑记。每项形如 `{ kind, path }`：

```json
"artifacts": [
  { "kind": "brief", "path": "docs/briefs/2026-07-02-x.md" },
  { "kind": "knowledge_card", "path": ".latch/knowledge/tasks/xxx.md" }
]
```

- 写入：`latch save --artifact <kind>:<path>`，可重复传。
- `kind` 是开放字符串，推荐值：`brief`、`prd`、`adr`、`doc`、`knowledge_card`、`runbook`。
- `latch knowledge generate` 自动写入 `kind: "knowledge_card"` 一项，不需要手动 `--artifact`。
- `resume`/`context`/`list --json` 都会带出 `artifacts`，人读输出里也有一行 `Artifacts:`。
- brief 和 PRD 模板顶部有 `Source-Task: <task-id>` 占位行，反向指回 task；这是模板约定，不由 CLI 校验。

正式文档层和任务状态层就此显式连上，不再靠记忆。

