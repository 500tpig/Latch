# Latch 卡点与修复清单

记录于 2026-07-02，基于用 Latch 管理自身 cli.ts 拆分（四步任务，已归档）后的真实使用体验。按严重度排，分 bug、体验卡点、设计取舍三类。修复基准是 `pnpm test` 77 个用例全绿，锁 bug 要补新测试。

## 1. 锁残留（bug，必修）

### 现象
`done --task <不存在的 ID>` 报错后，`.latch/.lock` 残留，后续所有写命令报 `Latch is busy: EEXIST`，要手动 `rm -rf .latch/.lock` 才能继续。

### 根因
`src/core/task-store.ts` 的 `readTask`、`currentTask` 找不到任务时调 `die()`，而 `die()`（`src/core/utils.ts`）是 `console.error` + `process.exit(1)`。这两个函数被 `runLocked` → `withLock` 包着调用，`withLock` 的 `finally { rmSync(lockDir) }` 碰到 `process.exit` 直接跳过，锁不清。

链路：`done --task bad-id` → `runLocked(() => targetTask({write:true}))` → `readTask(id)` → `die('Task not found')` → `process.exit(1)` → `withLock` 的 finally 不跑 → 锁残留。

### 修法
`readTask`、`currentTask` 改成 `throw new Error(...)`，让 `withLock` 的 finally 跑到，错误传到 `runLocked` 顶层 catch 后再 `die`。改完审一遍所有在 `runLocked` 内可能被调到、且用了 `die` 的路径：`withLock` 自己的 busy 分支（这个本来就是死锁该 die）、`log` 的缺 summary（在 `runLocked` 外，不受影响）、`targetTask` 间接调的 `claimTask`/`ensureTaskOwnedByActor`（这俩是 throw，没问题）。

### 验证
现有 `tests/cli-guards.test.mjs` 的 lock 测试只覆盖"锁被占时正常 busy"，没覆盖"错误后锁是否清"。补一个测试：跑 `done --task <不存在的ID>`，断言退出非零，且 `existsSync(join(cwd, '.latch/.lock'))` 为 false，且后续命令能正常跑。

### 风险
`die` → `throw` 可能改变退出码或消息格式（throw 经 runLocked 再 die，消息一致；退出码还是 1）。跑全量测试确认。

## 2. task ID 含中文 + 不支持短前缀（体验，建议修）

### 现象
归档要 `done --task "202607020904-拆分-cli-ts-第一刀-抽底座与状态机边界"`，短数字 `202607020904` 报 not found，中文还得加引号。

### 根因
ID = `时间戳-slug`，slug 来自标题（含中文）。`--task` 等命令按全 ID 精确匹配，不支持前缀。ID 生成在 `src/core/task-store.ts` 的 `createTask`，解析在 `cli.ts` 的 `targetTask` 及各 `--task` 用处。

### 修法
建议先加前缀匹配（低风险，不动数据格式）：`readTask` 等接收 ID 的地方，如果传进来的值不是完整目录名，按前缀在 `openTaskIds()` 里找唯一匹配；多个匹配报歧义错。不动 ID 格式，避免迁移已有 task 目录。

### 风险
前缀匹配要处理歧义（多个同前缀）。纯时间戳前缀（`202607020904`）通常唯一。

## 3. 多个 finish 任务无批量归档（体验）

### 现象
四步拆分留四个 finish 任务，要逐个 `done --task <全ID>`，没有批量。

### 建议
加 `done --all`：归档所有 `stage=finish && latest_verify.status=pass && knowledge_decision 齐` 的任务。为防误归档，可要求 `--all` 必须配 `--yes` 或打印清单二次确认。

### 风险
批量操作要谨慎，别归档没真正确认的。门禁条件照 `ensureDoneReady`。

## 4. checkpoint --new 心智负担（设计取舍）

### 现象
换题必须 `--new`，漏了报错。

### 取舍
这是 actor 隔离防误 append current 的代价，报错信息已提示用法。不改也能接受。若要缓解，可在 `checkpoint` 带 title 且无 current task 时自动按 new 处理（现有逻辑已类似），但有 current 时仍要 `--new`。

## 5. finish 强制 knowledge_decision（设计取舍，繁琐）

### 现象
纯重构这种明显无沉淀价值的任务，此前每次也要手动写 skip reason。

### 取舍
逼思考是否沉淀的初衷对，但对纯重构仪式化。建议保持强制，但可考虑 `--knowledge-reason` 允许更短或给个 skip 默认模板。改动小，但要想清楚别让 skip 太容易（那就等于不强制了）。

2026-07-03 更新：`latch finish` 已默认写入 knowledge skip；需要沉淀规则时显式传 `--knowledge generate --knowledge-reason "..."`。

## 6. closure 要手 edit notes.md（体验）

### 现象
finish 的 scaffold 铺了模板，但填格子要手动改 `notes.md` 文件，没有命令。

### 建议
加一个填 closure 的命令或 `save --closure` 选项，按字段传值写进 notes。否则 AI/人都得手敲文件。

### 风险
增加命令面，要设计字段格式。

## 7. brief 不自动关联（体验）

### 现象
每张 task 都要手动 `save --artifact brief:docs/briefs/...`，latch 不知道这张 task 对应哪份 brief。

### 建议
`checkpoint` 时加 `--brief <path>` 直接记进 artifacts，或 task 加专属 `brief_path` 字段。

## 优先级

1. 修锁残留 bug（硬故障，会让用户卡死）
2. task ID 前缀匹配（体验，低风险，不改数据格式）
3. 批量归档（体验）
4–7. 设计取舍/小体验，按需

## 不动的地方

- 主流程 checkpoint/next/verify/done 的阶段机合理，不动。
- actor 隔离、三层规范（task.json/notes.md/docs）合理，不动。
- `resume --brief` / `context --json` 这些给 AI 的出口实用，不动。
