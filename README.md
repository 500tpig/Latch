# Latch

Latch 是面向个人 macOS 开发环境的本地任务记录 CLI。它保存明确创建的 coding task、实施计划、批准、验证结果和 review 状态，也支持 project-local Record 保存显式轻量记录。

Latch 不自动创建 task 或 Record。task 按 A/B/C 规则进入相应流程；Record 只有在用户明确表达保存或召回意图时才会读写。

## 当前状态

仓库源码使用 Latch v2 task schema，并提供独立的 Record store schema 1。全局 CLI、Latch-Board 和业务项目同步需要单独授权。

文档入口见 [`docs/INDEX.md`](docs/INDEX.md)，产品契约见 [`docs/prd/2026-07-15-latch-final-product-contract.md`](docs/prd/2026-07-15-latch-final-product-contract.md)。

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
