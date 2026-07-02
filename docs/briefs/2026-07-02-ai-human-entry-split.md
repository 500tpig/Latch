# AI 与人默认入口拆分 + 文档真源收口

Source-Task: 202607021325-重新划分-ai-与人默认入口及文档真源

## 背景

- `resume --brief` 现在半人半机：既给结构字段，也给 prose（`Recent events`、`Notes` 路径、文字 `Next action`）。AI 要从 prose 里抠字段，人要过滤结构字段。
- `context --json` 已是干净 JSON（`src/core/task-view.ts:81` 的 `taskContext`），但 AI 默认入口仍是 `resume --brief`，JSON 入口没被规则默认采用。
- 规则重复：触发列表、`zsh -ic` fallback、写命令串行、`resume --brief` 入口在 `AGENTS.md` / `HANDBOOK.md` / 两份 `SKILL.md` / `AI_INSTALL.md` 至少 4 处各抄一遍。
- `notes.md` 在 `ARTIFACTS.md:10` 标为「AI、人」双读者，口径模糊。
- pain-points brief（`docs/briefs/2026-07-02-latch-pain-points-and-fixes.md:95`）曾把 `resume --brief` / `context --json` 列为「不动的地方」，本任务反转该结论。

## 目标

- AI 默认读结构化状态：`context --json`（单 task）、`list --json`（多 task）。
- 人默认读说明文本：`resume --brief`、`resume`、`notes.md`、brief / PRD。
- 触发列表只在 `AGENTS.md` 出现一次；`HANDBOOK` / 两份 `SKILL` / `AI_INSTALL` 不再各抄。
- 两份 skill 压成薄跳转，内容真源回 `docs/`。
- `notes.md` 口径改「人主读，AI 兜底」并定义兜底触发时机。

## 不做什么

- 不改 `printResume` 的输出行为（人读短摘要已经够用，只改文档口径）。
- 不把 `notes.md` 全文塞进 JSON。
- 不改 `events.jsonl` 格式或 `recentEvents` 返回类型（先复用字符串数组，结构化留 follow-up）。
- 不加 `resume --agent` 新命令（这是文档问题，不造命令）。
- 不动 actor 隔离、阶段机、artifacts 机制。

## 方案

### 1. `taskContext` 加 `recent_events`（唯一代码改动）

- `src/core/task-view.ts:81` 的 `taskContext()` 增加 `recent_events: recentEvents(task, 5)`。
- 复用已导入的 `recentEvents`（`src/core/notes-events.ts:40`），返回 `string[]`。
- 一次改动覆盖 `context --json` / `resume --json` / `list --json` 三个面（`list` 多 task 时 payload 略变大，可接受）。
- `printResume` brief 模式的 `Recent events` 块不动（人读路径仍受益）。

### 2. AI 默认入口改 `context --json`

- 两份 `SKILL.md` 的 bootstrap 第 2 步从 `latch resume --brief` 改成 `latch context --json`。
- `AI_INSTALL.md` 「允许执行的轻量命令」加 `latch context --json` 和 `latch context <task-id> --json`。
- `HANDBOOK.md` 命令表 `resume --brief` 行口径从「默认优先用这个」改「人读短摘要」；新增 AI 默认入口说明指向 `context --json`。
- `HANDBOOK.md` 「低 token 用法」段：AI 默认 `context --json`，人默认 `resume --brief`。
- `resume --brief` 不死：AI 读指定 task 现场仍可用 `resume --brief --task <id>` 或 `context <id>`。

### 3. `notes.md` 读 / 写边界

- `ARTIFACTS.md:10` 的 `notes.md` 行从「AI、人」改「人主读；AI 写 closure / events，需追溯细节时兜底读」。
- 兜底触发时机一句话：`recent_events` 指向未展开内容、或 `progress.next_action` 卡住时，AI 读 `notes.md`。
- 写默认不变：closure scaffold 仍由 AI 通过 `latch finish` / `appendNotes` 写。

### 4. 文档真源边界（dedupe by deletion）

- **触发列表**：`AGENTS.md` 是唯一 source。`HANDBOOK.md` 删 `:10-15` 摘要，保留 `:12` 一句指针。两份 `SKILL.md` 触发段只留「硬触发（Latch 自身反馈）」一条，其余改「见 `AGENTS.md`」。`AI_INSTALL.md:26` 保留一行硬触发 + 指针（安装场景可能未加载 `AGENTS`）。
- **流程真源**：`HANDBOOK.md`（命令清单、阶段、字段、常用流程）。
- **分层真源**：`ARTIFACTS.md`（什么时候只用 Latch / 加 brief / 加 PRD）。
- **执行规则**：`AGENTS.md`（触发、串行写、代码检索默认、新能力判断）。
- **安装**：`AI_INSTALL.md`。

### 5. 两份 skill 压成薄跳转（≤30 行）

- 保留 frontmatter（`description` 不删，AI 靠它判断何时加载）。
- 保留：一句「Latch 是什么」+ 最小 bootstrap（`git status`、`latch context --json`）+ 何时进 Latch（只留硬触发）+ 指针（流程见 `HANDBOOK`、触发见 `AGENTS`、安装见 `AI_INSTALL`）。
- 删掉完整阶段流程、命令清单、收尾细节——这些回 `HANDBOOK` 看。

## 验收

- `taskContext()` 返回 `recent_events: string[]`（最近 5 条）。
- `context --json` / `resume --json` / `list --json` 均带 `recent_events`。
- `pnpm test` 全绿；`tests/cli-query.test.mjs` 补一条断言锁定 `recent_events` 字段存在且为数组。
- `HANDBOOK.md` 命令表 `resume --brief` 行口径为「人读短摘要」；AI 默认入口写 `context --json`。
- `ARTIFACTS.md` `notes.md` 行口径为「人主读 AI 兜底」+ 兜底时机一句话。
- 两份 `SKILL.md` 行数 ≤30，无完整触发列表、无完整命令清单。
- `rg -l "完整触发规则见 AGENTS.md" docs/ .opencode/ .agents/` 命中 `HANDBOOK`；触发完整列表 `rg "风险域"` 仅命中 `AGENTS.md`。

## 风险

- **`list --json` payload 变大**：多 open task 时每张带 5 条 event。open task 通常 ≤5 张，可接受；若未来量大再加 `--no-events` 选项（本任务不做）。
- **dedupe 删错口径**：`HANDBOOK` / `SKILL` 某段可能有 `AGENTS` 没有的独特口径。改前逐段比对此风险可控，已在方案里按文件列出留删项。
- **未覆盖**：`recent_events` 用字符串数组而非结构化对象，AI 解析稍多一步。留 follow-up，不在本任务改格式。
- **未覆盖**：pain-points brief 第 95 行「不动」结论被反转，需在本任务 closure 里注明反转原因，避免归档时口径冲突。
