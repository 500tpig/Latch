# 项目规则模板

本模板用于把 Latch 接入目标项目。安装 AI 可以读取项目事实并生成草稿；风险判断、验证可靠性和禁改目录必须由用户确认。

## Latch 使用规则

- 风险域任务开始前执行 `latch checkpoint`。
- 小请求不进入 Latch；需要留痕时使用 `latch log`。
- 误判为小修后任务变长，立即执行 `latch checkpoint` 补记现场。
- 续接任务先运行 `latch resume --brief`。
- 如果 AI 工具报 `command not found: latch`，先试 `zsh -ic 'latch resume --brief'`，不要写入本机绝对路径。
- 验证必须通过 `latch verify -- <command>` 记录。
- verify 通过后进入 `finish`，补 closure；只有用户确认后才执行 `latch done`。

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
