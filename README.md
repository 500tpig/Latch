# Latch

Latch 是面向个人 macOS 开发环境的本地任务记录 CLI。它保存明确创建的 coding task、实施计划、批准、验证结果和 review 状态，也支持 project-local Record 保存显式轻量记录。

Latch 不自动创建 task 或 Record。task 按 A/B/C 规则进入相应流程；Record 只有在用户明确表达保存或召回意图时才会读写。

## 当前状态

当前 CLI 版本为 `0.4.0`。新 task 使用 schema 4，并通过
`workspace_scope.paths`、gate 前后 evidence 和 proof generation 判断验证结果是否可
参与 submit。schema 4 的最低 writer 版本为 `0.4.0`；CLI 0.2.0 和 0.3.0 会在
task 读盘时拒绝该格式。schema 3 只读并通过显式 `upgrade-v4` 单 task 升级，
schema 2 继续作为显式 R2 回退格式。Record 使用独立的 store schema 1。
全局 CLI、Latch-Board 和业务项目同步需要单独授权。

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
