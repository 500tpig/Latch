# Latch v0 规格

状态：开发草案  
日期：2026-06-30

## 目标

Latch 是一个纯 AI coding harness。

小请求不进入 Latch。任务变长或碰风险域时，用 `latch checkpoint` 锁住现场；之后必须经过阶段、验证和用户确认，才能归档完成。

## 非目标

v0 不做这些能力：

- 自然语言任务分类器。
- 多 active task。
- worktree 隔离。
- 自动 commit。
- dashboard。
- workflow YAML。
- 子 agent 编排。
- 知识库、workspace journal 或长期 spec 管理。
- 默认 PRD、设计文档或实现计划文件。

这些能力只有在 v0 跑通后，且没有它会明显影响使用时再加。

## 长期知识库集成边界

Latch 可以把归档任务作为外部知识库的原料，但 v0 不直接集成 MindOS 这类长期知识库，也不在 `done` 时解析 `notes.md` 判断 closure 质量。

`notes.md` 是给人和 AI 读的过程记录，不是 CLI 的结构化输入。需要把 Latch 经验沉淀进 MindOS 时，优先由 MindOS skill 读取 `.latch/archive/` 后自行蒸馏；Latch 继续只维护单任务状态、事件和验证结果。

## 目录结构

```text
.latch/
  state.json
  tasks/
    <task-id>/
      task.json
      notes.md
      events.jsonl
  archive/
    YYYY-MM/
      <task-id>/
```

`state.json` 只保存当前 active task：

```json
{
  "active_task_id": "2026-06-30-1430-auth-expiry"
}
```

`task.json` 给 CLI 读取：

```json
{
  "id": "2026-06-30-1430-auth-expiry",
  "title": "重做登录态过期跳转",
  "status": "active",
  "stage": "dev",
  "goal": "过期登录态统一跳转登录页",
  "scope": "前端路由和接口错误处理",
  "acceptance": "pnpm test 通过；过期后跳登录页",
  "next": "补登录过期跳转测试",
  "latest_verify": {
    "command": "pnpm test",
    "status": "fail",
    "exit_code": 1,
    "created_at": "2026-06-30T06:30:00.000Z"
  }
}
```

`notes.md` 给人和 AI 读取，保存阶段内容。  
`events.jsonl` 追加历史事件，用于追溯，不作为主要状态。

## 命令

### `latch init`

初始化 `.latch/`。

```bash
latch init
```

### `latch start "<title>"`

创建正式任务，进入 `triage`。

```bash
latch start "重做登录态过期跳转"
```

v0 只允许一个 active task。已有 active task 时拒绝创建。

### `latch checkpoint`

低摩擦入口。没 active task 时自动创建一个（进 `triage`）；有 active task 时只追加字段，不新建、不推进阶段。中途发现任务变长，随时补记。

```bash
latch checkpoint "重做登录态过期跳转" \
  --goal "过期登录态统一跳转登录页" \
  --scope "前端路由和接口错误处理" \
  --acceptance "pnpm test 通过；过期后跳登录页" \
  --next "补登录过期跳转测试"
```

`checkpoint` 是记账，不是过门。和 `save` 的区别：没任务时 `checkpoint` 会先开任务，`save` 不会。

### `latch save`

保存当前阶段内容，不推进阶段。

```bash
latch save \
  --goal "过期登录态统一跳转登录页" \
  --scope "前端路由和接口错误处理" \
  --acceptance "pnpm test 通过；过期后跳登录页" \
  --next "补登录过期跳转测试"
```

`save` 是记账，不是过门。

### `latch next`

检查当前阶段门禁，通过后推进阶段。

```bash
latch next
latch next --to grill --reason "验收标准不清楚"
latch next --to brainstorm --reason "用户要求先发散方案"
```

`next` 只改阶段，不替 AI 规划，也不执行验证。

### `latch verify -- <command>`

真实执行验证命令，并按退出码记录结果。

```bash
latch verify -- pnpm test
```

退出码 `0` 记录为 `pass`。非 `0` 记录为 `fail`。

### `latch resume`

输出当前 active task 的最短续接信息，包括 title、stage、goal、next、最近一次 verify，以及 `notes.md` 全文。

`notes.md` 保存了历次 `save`、阶段模板和 closure 内容。跨会话续接时，下一轮 AI 拿到 resume 就能看到上次的 grill 结论、plan 取舍和收尾交接，不用重新问一遍。

```bash
latch resume
```

没有 active task 时输出没有可续接任务。

`--brief` 砍掉 `notes.md` 全文，改输出最近 5 条 events（每条一行）和 notes 路径。任务长、notes 堆积成噪音时用；AI 想看细节自己读路径下的文件。

```bash
latch resume --brief
```

### `latch list`

列出未归档任务。

```bash
latch list
```

### `latch log "<summary>"`

小任务留痕。不创建任务、不进状态机、不要 verify，只往 `.latch/log.jsonl` 追加一行。任务已经收掉、不需要跨会话续接、只想留一笔可查时用。

```bash
latch log "限制链路弹窗条件配置为单网口单值" \
  --files src/views/.../LinkDialog.vue,src/views/.../LinkDialogConditionPanel.vue
```

`summary` 必填。`--files` 可选，按逗号分隔写数组；不传写空数组。不调用 git，不扫描 worktree。需要跨会话续接的用 `checkpoint`，不要用 `log`。有 active task 时 `log` 会被拒绝：先把任务推进（`next`）或归档（`done`），再 `log`，避免同一件事既进 `tasks/` 又进 `log.jsonl` 记两本账。

### `latch done`

归档完成任务。

```bash
latch done
```

只有满足这些条件才允许执行：

- 当前阶段是 `finish`。
- 最近一次 `latch verify` 是 `pass`。
- 用户明确要求完成、收尾或归档，或者显式调用对应命令。

`done` 不负责 commit。

## 阶段

```text
triage -> brainstorm? -> grill? -> plan -> dev -> check -> finish -> done
blocked 可从任意阶段进入
```

### `triage`

分流阶段。AI 判断任务是否需要进入 `brainstorm`、`grill`，或直接进入 `plan`。

### `brainstorm`

用户主动触发的发散讨论。常见触发包括 `/brainstorm`、明确要求先讨论方案、明确要求先不要写代码。

记录内容：

```text
目标：
保留：
不做：
风险：
下一步：
```

### `grill`

AI 自动刹车。需求、范围、验收，或数据、认证、存储等难回退决定不清楚时进入。

有文档时仍然记录为 `grill`，`grill-with-docs` 只是工作方式，不是阶段名。

记录内容：

```text
目标：
范围：
不做：
验收：
仍未确认的问题：
```

### `plan`

记录最小执行计划和下一步。

### `dev`

实现阶段。记录改动说明、相关文件和下一步。

### `check`

验证阶段。必须通过 `latch verify -- <command>` 留下真实结果。

### `finish`

验证通过后的收尾等待阶段。AI 可以整理最终说明，但不能自动归档。

### `done`

用户确认后的完成状态。任务目录移动到 `.latch/archive/YYYY-MM/`。

### `blocked`

等待用户决定、外部条件或验证环境。进入后不自动恢复，必须由后续明确操作继续推进。

## 阶段门禁

| 推进 | 条件 |
| --- | --- |
| `triage -> plan` | 已有 `goal` 或 `next` |
| `triage -> brainstorm` | 用户主动要求发散讨论 |
| `triage -> grill` | AI 说明信息缺口 |
| `brainstorm -> plan` | 已有 `goal` 和 `next` |
| `grill -> plan` | 已有 `goal`、`scope` 和 `acceptance` |
| `plan -> dev` | 已有 `next` |
| `dev -> check` | AI 已完成实现，准备验证 |
| `check -> finish` | 最近一次 `latest_verify.status` 是 `pass` |
| `finish -> done` | 用户明确要求完成、收尾或归档 |

## 阶段模板

进入需要记录结论的阶段时，`latch next` 会在 `notes.md` 自动追加一段空模板，逼 AI 按格子填，不让它自由发挥写散。Latch 只负责铺格子，不检查填没填——不当裁判，只让流程不被跳过。

| 进入阶段 | 模板字段 |
| --- | --- |
| `brainstorm` | 目标 / 保留 / 不做 / 风险 / 下一步 |
| `grill` | 目标 / 范围 / 不做 / 验收 / 仍未确认的问题 |
| `finish` | 改了什么 / 验证了什么 / 没验证什么 / 下次接什么 |

其他阶段不铺模板，记录靠 `latch save`。

## 使用例子

小请求不进入 Latch：

```text
用户：解释这个函数。
AI：直接解释。
```

任务变长时中途补记：

```bash
latch checkpoint "重做登录态过期跳转" \
  --goal "过期登录态统一跳转登录页" \
  --next "补登录过期跳转测试"
```

正式任务进入 Latch：

```bash
latch start "重做登录态过期跳转"
latch save --goal "过期登录态统一跳转登录页" --next "写最小计划"
latch next
latch save --next "补登录过期跳转测试"
latch next
latch next
latch verify -- pnpm test
latch next
```

此时任务停在 `finish`。只有用户要求收尾时才执行：

```bash
latch done
```
