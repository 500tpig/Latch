# Latch 使用场景

本页给 AI 判断是否进入 Latch。它不新增命令，只把常见请求映射到阶段和最小记录方式。

## 判断原则

- 小请求不进入 Latch：解释代码、单点文案、简单样式、低风险单点修复。
- 需要跨会话续接、真实验证、用户确认或碰到风险域时，进入 Latch。
- 规划类请求由 AI 自动进入 Latch，不要求用户手动敲命令。
- 默认先用 `checkpoint` 锁住现场；阶段推进交给 `next`。

## 场景速查

| 用户请求 | 是否进入 | 初始阶段 | 关键判断 |
| --- | --- | --- | --- |
| 「规划项目后续」「完善项目」「怎么推进更好」 | 是 | `brainstorm` | 先讨论方向，不急着实现。 |
| 「latch 不可用」「没按 Latch 流程走」「这应该被记录」 | 是 | `grill` | 硬触发，优先于小请求；先 `checkpoint` 再排查。 |
| 「要不要改 CLI / 规则 / 安装方式 / 多项目同步」 | 是 | `grill` | 涉及难回退取舍，先确认目标、范围和验收。 |
| 「修复这个反复出现的 bug」 | 是 | `grill` | 先复现和确认根因，不用 workaround 盖过去。 |
| 「做一个跨 API / 状态 / 路由 / 权限的功能」 | 是 | `grill` | 先确认契约和验收，再写代码。 |
| 「重构这个老模块」 | 是 | `grill` | 先确认不变行为、调用方和验证命令。 |
| 「把这次小修改记一笔」 | 否 | 无 | 用 `latch log`，不创建任务。 |

## 1. 项目后续规划

触发语：

```text
现在想规划项目后续要继续推进的事情，或者完善项目让它更好用。需要怎么讨论？
```

AI 应自动执行：

```bash
latch checkpoint "规划项目后续推进" \
  --goal "基于现有文档和代码讨论后续方向" \
  --scope "当前 repo 文档、代码、真实使用路径" \
  --acceptance "给出有证据、不过度扩大职责的下一步" \
  --next "读取项目文档和代码后进入 brainstorm"
latch next --to brainstorm --reason "用户要求先讨论项目后续"
```

讨论中如果开始决定是否改 CLI、安装方式、项目规则、发布 npm 包、同步多个项目，转入：

```bash
latch next --to grill --reason "规划讨论进入难回退取舍"
```

完成标准：

- 已读当前 repo 的最小相关证据。
- 列出下一步 1-3 件事。
- 明确不做什么。
- 需要实现时再进入 `plan`，不在 `brainstorm` 里直接改代码。

## 2. 复杂 bug

触发语：

```text
这个问题又出现了，之前修过但没彻底解决。
```

AI 应自动 checkpoint，并进入 `grill`：

```bash
latch checkpoint "修复反复出现的 bug" \
  --goal "复现问题并修复根因" \
  --scope "报错路径、相关调用方、最小回归验证" \
  --acceptance "能复现；修复后同一验证通过" \
  --next "收集报错、复现步骤和相关调用链"
latch next --to grill --reason "需要确认复现、范围和验收"
```

完成标准：

- 记录复现步骤或说明为什么无法复现。
- 找到根因位置，不只修报告里的单一路径。
- 用 `latch verify -- <command>` 记录验证结果。
- 如发现项目规则缺口，补到 `AGENTS.md`、项目文档或 skill。

## 3. 跨模块功能

触发语：

```text
做一个功能，涉及权限、接口、状态和页面。
```

进入 `grill`，先确认：

- 目标用户行为。
- API 或数据结构是否变化。
- 权限和错误状态。
- 验证命令或手动验收路径。
- 明确不做的范围。

示例：

```bash
latch checkpoint "实现跨模块功能" \
  --goal "交付一个可验证的最小功能" \
  --scope "页面、状态、API 契约、权限边界" \
  --acceptance "类型检查和关键路径验收通过" \
  --next "确认 scope、接口和验收"
latch next --to grill --reason "涉及跨模块职责和接口契约"
```

完成标准：

- `grill` 里有目标、范围、不做、验收和未确认问题。
- `plan` 只包含当前任务需要的最小步骤。
- `check` 使用最小相关验证。

## 4. 行为保持型重构

触发语：

```text
这个模块太乱了，想重构一下，但不要改行为。
```

进入 `grill`，先确认不变量：

- 哪些外部行为必须保持不变。
- 谁调用这个模块。
- 有哪些副作用、缓存、持久化或事件。
- 当前验证能覆盖什么，不能覆盖什么。

完成标准：

- 先有不变行为清单，再动代码。
- 一次只抽取一个职责。
- 每轮改动后用同一类验证确认行为没变。

## 5. 规则或 skill 更新

触发语：

```text
AI 总是不知道怎么用这个项目规则，要不要改 skill 或 AGENTS？
```

如果只改措辞或补触发例子，可以从 `brainstorm` 进入；如果涉及全局 skill、多个项目同步、安装方式或发布包，进入 `grill`。

每个建议至少说明：

- 依据来自代码、文档、真实使用，还是推测。
- 是否扩大 Latch 职责。
- 判断错了的回退成本。
- 是否有更小替代方案。

完成标准：

- 优先改文档、模板或 skill 描述。
- 不因为一次失败就新增 CLI 能力。
- 多项目同步只改 Latch 相关段落，不整理其它改动。
- 跨项目同步规则时，每个被修改的目标项目都用 `latch log` 记录同步原因和文件；不需要为每个项目创建正式任务。
- 同步全局和项目内 skill 副本时，源头文档和副本规则要一致；不能只改其中一份。

## 6. Latch 自身反馈

触发语：

```text
非交互 shell 找不到 latch。
是不是要改环境配置？
你为什么没按 Latch 流程走？
这应该被记录。
```

命中即属于硬触发，优先于「小请求不进入 Latch」。先 `latch checkpoint` 锁现场，再排查：

```bash
latch checkpoint "处理 latch 命令或流程反馈" \
  --goal "先记录 AI 漏走流程或 latch 不可用问题，再判断根因和改动范围" \
  --scope "当前 repo 的 skill、文档、接入说明" \
  --acceptance "明确根因、记录决策、只做最小修复" \
  --next "进入 grill 确认是不是规则问题"
latch next --to grill --reason "Latch 自身反馈属于规则判断问题"
```

完成标准：

- 先 checkpoint，再排查；不当成小环境修直接改 shell 配置。
- `latch` 不可用时先用 `zsh -ic 'latch resume --brief'` 恢复命令；这一步只为让命令先跑起来，不代表要续接旧任务。恢复后如果命中本场景，第一步仍是 checkpoint。
- 改动只动 Latch 相关段落，不整理无关内容。
- 跨 skill 副本同步改，源头和副本保持一致。

## 7. 小任务留痕

触发语：

```text
这个小修不用走完整流程，记一下就行。
```

使用：

```bash
latch log "<summary>" --files a.ts,b.ts
```

`log` 不创建任务、不推进阶段、不要求 verify。已经用 `checkpoint` 或 `start` 进入 Latch 的同一件事，不再补 `log`。

用户指出「这应该被记录」时，先判断是否已经有 active task；有就补 `save` 或继续当前任务，没有才用 `log` 或 `checkpoint`。

## AI 默认动作

新会话或新请求开始时：

1. 先运行 `git status --short`。
2. 如果 `.latch/state.json` 有 current task，运行 `latch resume --brief`。
3. 根据本页判断是否进入 Latch。
4. 进入后先 `checkpoint`，再决定 `brainstorm`、`grill` 或 `plan`。
5. 不要求用户手动执行 Latch 命令；用户明确拒绝时除外。

如果 `latch` 报 `command not found`，先试：

```bash
zsh -ic 'latch resume --brief'
```

不要把本机绝对路径写入项目规则或 skill。
