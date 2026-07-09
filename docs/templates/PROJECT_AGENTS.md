# 项目规则模板

本模板用于把 Latch 接入目标项目。安装 AI 可以读取项目事实并生成草稿；风险判断、验证可靠性和禁改目录必须由用户确认。

## Latch 使用规则

- Latch 流程反馈（硬触发，优先于「小请求不进入 Latch」）：AI 接入 Latch、记录规则漏触发，或用户指出「这应该被记录」。一旦命中，先用 `latch list --json --brief` 查 open task；有同题任务就续接，确实没有才 `latch checkpoint`。
- 小请求不进入 Latch；需要留痕时使用 `latch log`。误判为小修后任务变长，立即 `latch checkpoint` 补记现场。
- 风险域、复现 bug、跨会话续接、方案讨论后再实现、规划/复盘/路线讨论，进入或续接 Latch。
- 规划问答、外部建议取舍、用户确认只要影响范围、不做项、验收或下一步，就补一段「讨论摘记」；小任务写当前 task `notes.md`，中等任务写 brief 并挂 artifact，不要求逐字记录完整对话。
- 新开 Latch 任务前先运行 `latch list --json --brief`；续接任务先运行 `latch context --json --brief`，需要完整字段时再运行 `latch context --json`。
- 如果 AI 工具报 `command not found: latch`，先试 `zsh -ic 'latch --help'`，不要写入本机绝对路径。
- 多 agent 并行时，必须显式设置稳定的 `LATCH_ACTOR`。推荐格式：`<tool>:<agent>:<session>`，至少写成 `<tool>:<session>`；不要只依赖默认线程 ID，也不要让多个 AI 共用 `default`。
- 验证通过 `latch verify -- <command>` 记录；默认 verify 是收尾门禁，诊断性全量检查用 `latch verify --diagnostic -- <command>`，不覆盖门禁验证；`verify` 不经过 shell，`&&`、管道、glob 和 `$VAR` 展开需要拆成多次验证。
- verify 通过后用 `latch finish --changes "..." --verified "..." --unverified "..." --followup "..."` 补 closure；用户要求收尾、提交、结束或归档时，先运行 `latch list --json --brief` 看全局 open task，只有用户确认后才执行 `latch done`。
- 任务到 `finish`/`done` 后又发现还有事：只是补 closure、验证说明或讨论摘记，继续当前 task（`latch save` 或重跑 `latch finish`，finish 阶段也能写）；属于新增实质范围（改代码、跨 repo 同步、重新验证、原验收有缺口），新开 follow-up task 并引用原 task ID，不重开已 finish/done 的任务。判断标准是 scope，不是 finish 状态。
- `git commit`、`git push` 和 `latch done` 都需要用户明确确认；没有明确说「提交」「推送」或「归档」时，AI 不得自动执行。
- 跨项目同步 Latch 规则时，每个被修改的目标项目都用 `latch log` 留痕。

阶段、模板、验证、收尾和小任务留痕流程以全局 latch skill 为准；本段只保留项目入口和边界。

## 可自动填写的事实

- 包管理器：
- `package.json` scripts：
  - 类型检查：
  - Lint：
  - 测试：
  - 构建：
- 是否已有 `.latch/`：
- 是否已有 `AGENTS.md`：

## 必须人工确认

- 本项目风险域：
  - 认证 / 登录：
  - 权限：
  - 路由：
  - 状态流：
  - 持久化存储：
  - API 契约：
  - 数据迁移：
  - 跨模块职责：
  - 难回退 UI 或交互流程：
- 验证命令是否可靠：
  - 全量类型检查：
  - 全量测试：
  - 全量构建：
  - 单文件或局部验证：
- 不要自动改动的目录或文件：
- 项目特殊收尾规则：

## Git 规则

- 不使用 `git add .`。
- 按文件暂存，避免把 `.latch/`、本地配置、无关改动混进 commit。
- `.latch/` 是否提交由用户决定；默认建议加入 `.gitignore`。
