# 项目规则模板

本模板用于把 Latch 接入目标项目。安装 AI 可以读取项目事实并生成草稿；风险判断、验证可靠性和禁改目录必须由用户确认。

## Latch 使用规则

- Latch 自身反馈（硬触发，优先于「小请求不进入 Latch」）：`latch` 命令不可用、只能靠 shell fallback、AI 接入 Latch、记录规则漏触发，或用户指出「这应该被记录」。一旦命中，先 `latch checkpoint` 再排查，不得当成小修直接动手或只补 `latch log`。
- 风险域任务开始前执行 `latch checkpoint`。
- 小请求不进入 Latch；需要留痕时使用 `latch log`。
- 误判为小修后任务变长，立即执行 `latch checkpoint` 补记现场。
- 续接任务先运行 `latch context --json`。
- 如果 AI 工具报 `command not found: latch`，先试 `zsh -ic 'latch context --json'`，不要写入本机绝对路径。
- 验证必须通过 `latch verify -- <command>` 记录。
- verify 通过后进入 `finish`，补 closure，写清改动、验证、未覆盖范围和下次接什么；只有用户确认后才执行 `latch done`。
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
