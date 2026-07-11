# Latch

Latch 是面向个人 macOS 开发环境的本地任务记录 CLI。它保存明确创建的 coding task、实施计划、批准、验证结果和 review 状态，便于 AI 在不同会话之间继续工作。

Latch 不自动判断或创建任务。只有请求明确提到 Latch 时，AI 才能创建或继续 task。

## 当前状态

仓库源码已切换到 Latch v2。第一阶段只修改本仓库；全局 CLI、全局 skill、Latch-Board 和业务项目将在后续获得单独授权后切换。

文档入口见 [`docs/INDEX.md`](docs/INDEX.md)，产品契约见 [`docs/prd/2026-07-10-latch-v2.md`](docs/prd/2026-07-10-latch-v2.md)。

## 开发命令

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm check
```

本地构建后的 CLI：

```bash
node dist/cli.js --help
```

不要在第一阶段执行全局链接脚本。
