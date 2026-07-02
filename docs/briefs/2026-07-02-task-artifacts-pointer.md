# 给 task 加 artifacts 字段统一外部产物指针

Source-Task: 202607020830-给-task-加-artifacts-字段统一外部产物指针

## 背景

- `task.json` 已经在用 `knowledge_card_path` 单字段指向 `.latch/` 外的知识卡（`src/cli.ts:44`），`taskContext` 把它当稳定结构输出给 AI（`src/cli.ts:421`）。这是"task 持外部产物指针"的既有模式。
- 但 brief / PRD / ADR / runbook 这类正式文档没有对应字段，只能塞进 `knowledge_reason` 自由文本，对 AI 不可见。历史上唯一产出正式文档的任务（`202607020722-定义文档分层与模板`，产出 `docs/ARTIFACTS.md`）就是这个状态。
- 继续加 `brief_path` / `prd_path` 是堆特例；改成 `artifacts: [{kind, path}]` 是把已存在的模式统一。

## 目标

- 在 `task.json` 上加 `artifacts: [{kind, path}]`，吃掉 `knowledge_card_path`。
- `save` 支持追加 artifact，`resume/context/list --json` 输出整个数组。
- `latch knowledge generate` 改成写 `artifacts` 一项（`kind: "knowledge_card"`），不再单独写 `knowledge_card_path`。
- `finish` scaffold 加一行提示记 artifact，跟知识记忆那行对称。

## 不做什么

- 不做 `latch artifact rm`：移除等真撞到再加，现在用直接编辑 `task.json` 兜底。
- 不做 manifest 文件：当前 artifact 不带元数据（标题/状态/摘要），挂 `task.json` 足够。一旦要带元数据，再拆 manifest。
- 不做反向链接的 CLI 机器：`Source-Task` header 纯模板约定，不由 CLI 写入或校验。
- 不做 `kind` 枚举校验：开放字符串，由模板和文档列推荐值（`brief`/`prd`/`adr`/`doc`/`knowledge_card`/`runbook`）。
- 不改 `--brief` 旗标：它已是 `resume`/`context` 的输出模式名，跟 `artifacts` 无关，保留原义。

## 方案

### 数据形状

```json
"artifacts": [
  { "kind": "brief",          "path": "docs/briefs/2026-07-02-xxx.md" },
  { "kind": "knowledge_card", "path": ".latch/knowledge/tasks/xxx.md" }
]
```

- `kind` 开放字符串，推荐值由文档列。
- 数组顺序为追加顺序；同一 kind 可多次出现。
- 字段 optional，老 `task.json` 不带也不报错。

### CLI

- `latch save --artifact <kind>:<path>`：追加一项。可多次传，每个追加一项。
- 解析：以第一个冒号切分，左边 kind、右边 path；path 含冒号也安全（macOS 路径不会冒号开头）。
- 不加 `--brief-path` / `--prd-path` 糖，避免跟 `--brief` 旗标语义混。

### taskContext

- 输出 `artifacts: task.artifacts ?? []`。
- 删除 `knowledge_card_path` 字段；消费方改读 `artifacts` 里 `kind === "knowledge_card"` 的一项。

### knowledge generate

- 不再写 `task.knowledge_card_path`；改成往 `task.artifacts` 追加 `{ kind: "knowledge_card", path: <卡路径> }`。
- `knowledge_decision` / `knowledge_reason` / `knowledge_decided_at` 保留不动。

### finish scaffold

- 现有"知识记忆"那行（`src/cli.ts:438`）之后加一行：
  `产出 artifact：用 latch save --artifact <kind>:<path> 记录`

### 模板

- `docs/templates/FEATURE_BRIEF.md`、`docs/templates/PRD.md` 顶部加 `Source-Task: <id>` 占位行。

## 验收

- `latch save --artifact brief:docs/briefs/x.md --artifact prd:docs/prd/y.md` 能写两项。
- `latch context --json` 输出 `artifacts` 数组，不再有 `knowledge_card_path`。
- `latch knowledge generate` 后 `task.json` 里出现 `artifacts` 一项 `kind: "knowledge_card"`，没有 `knowledge_card_path`。
- `latch resume` 的 `finish` 阶段 scaffold 里有"产出 artifact"那行。
- `pnpm check`（typecheck + test）通过。
- 本任务自己用 `latch save --artifact brief:docs/briefs/2026-07-02-task-artifacts-pointer.md` 记录自己的 brief（dogfooding）。

## 风险

- **数组挂 task.json 而非 manifest**：被"现在不要元数据"前提压住，不是证据锁死。一旦 artifact 要带标题/状态/摘要，得拆 manifest。
- **吃掉 `knowledge_card_path` 是破坏性迁移**：本 repo 在开发期、用户被告知自行调整，可接受。但 `latch knowledge generate` 的旧调用方若读 `knowledge_card_path` 会断，需要在同次改动里一起换。
- **`kind:path` 语法**：path 含冒号在 macOS 不会撞；Windows 不支持（Latch 不目标 Windows，可接受）。
- **未覆盖**：移除 artifact 的 CLI（暂时手编 `task.json`）；artifact 是否过期与 task 状态联动（不做）。
