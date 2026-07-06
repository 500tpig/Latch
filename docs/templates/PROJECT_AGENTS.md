# 项目规则模板

本模板用于把 Latch 接入目标项目。安装 AI 可以读取项目事实并生成草稿；风险判断、验证可靠性和禁改目录必须由用户确认。

## Latch 使用规则

- Latch 流程反馈（硬触发，优先于「小请求不进入 Latch」）：AI 接入 Latch、记录规则漏触发，或用户指出「这应该被记录」。一旦命中，先用 `latch list --json --brief` 查 open task；有同题任务就续接，确实没有才 `latch checkpoint`，不得当成小修直接动手或只补 `latch log`。
- 风险域任务开始前执行 `latch checkpoint`。
- 小请求不进入 Latch；需要留痕时使用 `latch log`。
- 误判为小修后任务变长，立即执行 `latch checkpoint` 补记现场。
- 新开 Latch 任务前先运行 `latch list --json --brief`，避免同题重复 task。
- 续接任务先运行 `latch context --json --brief`；需要完整字段时再运行 `latch context --json`。
- 规划、复盘、路线讨论和后续判断先完整探索问题面、选项、风险和长期影响，再给出最小可执行下一步；最小改动只约束实现 diff，不压缩规划思考。
- 全面梳理先分层取证：先看提交统计、文件名、目录、标题和已有 brief；摘要不足时再读完整 patch、长文档或宽范围搜索输出。
- 如果 AI 工具报 `command not found: latch`，先试 `zsh -ic 'latch --help'`，不要写入本机绝对路径。
- 多 AI 并行时，每个 agent 必须使用稳定且不同的 `LATCH_ACTOR`；没有线程 ID 的环境不要共用默认 `default` actor。
- 验证必须通过 `latch verify -- <command>` 记录；`verify` 不经过 shell，`&&`、管道、glob 和 `$VAR` 展开需要拆成多次验证。
- verify 通过后进入 `finish`，补 closure，写清改动、验证、未覆盖范围和下次接什么；用户要求收尾、提交、结束或归档时先运行 `latch list --json --brief` 看全局 open task，只有用户确认后才执行 `latch done`。
- 不要把 `task.json` 或 `notes.md` 当成正式需求文档；中等功能额外写 `docs/briefs/`，大需求额外写 `docs/prd/`。
- `git commit`、`git push` 和 `latch done` 都需要用户明确确认；没有明确说「提交」「推送」或「归档」时，AI 不得自动执行。
- 跨项目同步 Latch 规则时，每个被修改的目标项目都用 `latch log` 留痕。

详细流程见 Latch 手册：`docs/HANDBOOK.md`。

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
