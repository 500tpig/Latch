# Latch 本机安装

Latch 面向个人 macOS 开发环境。当前 repo package 和 CLI 版本为 `0.5.0`；新 task
使用 schema 5，并保存 `min_writer_version: "0.5.0"`。CLI JSON envelope 继续使用
schema 2，event 文件继续使用 `events_schema_version: 3`。产品规则以
[最终产品契约](prd/2026-07-15-latch-final-product-contract.md)为准。

## 检查源码 release

在 Latch 源码 repo 执行：

```bash
node -p "require('./package.json').version"
node dist/cli.js --help
pnpm skill:check
```

版本应为 `0.5.0`。顶层 help 应包含 `checkpoint`、`submit`、`done` 和
`patch-submission-knowledge-impact`，并满足以下 current 指令面：

- `checkpoint --help` 提供 `--profile`、`--authorize-request`、
  `--authorization-file`、`--retrospective-file` 和
  `checkpoint --print-plan-template light|standard`；
- `submit --help` 提供重复的 `--unverified-item`、
  `--knowledge-impact-none` 和 `--knowledge-impact-file`；
- `done --help` 提供 `--closeout-file`；
- 顶层 help 不提供 historical schema upgrade、downgrade 或重复 scope 输入。

接入状态与外部 adopter 阻断条件见[接入状态](ADOPTER_SYNC.md)。

## 构建 CLI

```bash
pnpm install
pnpm check
pnpm build
```

package bin 指向 `dist/cli.js`。构建只更新源码 repo 的本地产物，不代表全局安装、
npm 发布或 adopter rollout 已完成。

需要更新全局 CLI 时，先记录 `command -v latch` 和当前 package 来源。只有获得单独
安装授权后，才执行：

```bash
pnpm link --global
```

本命令不属于普通 implementation task 或 release 文档更新授权。

## 链接 canonical skill

canonical source：

```text
skills/latch/SKILL.md
```

检查现有链接：

```bash
pnpm skill:check
```

只有获得单独安装授权后，才创建或更新链接：

```bash
pnpm skill:link
```

目标为：

```text
~/.codex/skills/latch
~/.agents/skills/latch
```

链接脚本只管理符号链接，不复制文档快照。源码更新不证明外部 adopter 已完成 CLI
安装或行为验收。

## 初始化项目

初始化是显式操作。未初始化目录中的 `latch list --json --brief` 返回
`error.code: "not_initialized"`，不会创建 `.latch` 或其他项目文件。canonical
Skill 收到该错误后停止，不打印 template、不准备 plan、不调用 `checkpoint`，也不
自动执行 `latch init`。

确认需要初始化后执行：

```bash
latch init
```

初始化后的普通 `checkpoint` 创建 schema 5 Standard task，并写入
`min_writer_version: "0.5.0"` 和 `provenance: clean`。plan 必须提供
`workspace_scope.paths`；精确文件使用 repo-relative POSIX 路径，目录前缀以 `/`
结尾。

```bash
latch checkpoint --print-plan-template light
```

普通 Light request 使用：

```bash
latch checkpoint "任务标题" \
  --plan-file plan.json \
  --profile light \
  --authorize-request "用户请求完成明确修正" \
  --json
```

机器 scope 只来自 plan 的 `workspace_scope.paths`。复杂 authorization 使用
`--authorization-file`；retrospective 创建使用 `--retrospective-file`。提交未验证项
使用重复的 `--unverified-item`，结构化归档使用 `--closeout-file`。

业务项目的 `AGENTS.md` 应写入触发章 A/B/C：A 停在 grill；B 创建或续接 Light task
并以请求授权；C 创建或续接 Standard task，返回决策重点与 task ID 后等待明确
approve。纯问答、只读探索、无写入意图或明确要求「不用 Latch」时不建 task。

Grok 与 Codex 均可作为可写宿主。无法解析稳定 session ID 时保持只读，不手工设置
`LATCH_ACTOR`。跨对话或跨工具续写同一 open task 仍需针对具体 task 和 revision 的
明确 `takeover` 授权。

## Historical schema

schema 2–4 task 和 archive 保持原值。CLI `0.5.0` 可通过 `list` 和精确 ID
`context` 读取，但拒绝所有 mutation。current release 不提供 upgrade、downgrade、
双写、字符串 closeout migration 或 archive 重写。

任何历史数据迁移都需要独立产品契约、实施 task、备份方案和明确授权；不得在安装、
启动、恢复、构建或验证期间触发。

## 备份与回退

既有 CLI、skill 链接、Board 基线和业务 repo 的 `.latch` 备份继续保留。删除备份、
切换全局 CLI、恢复旧链接、修改 Board checkout 或改写 `.latch` 都属于独立操作，
需要明确目标、恢复方法和单独授权。

回退 release 文件时，不删除 schema 5 task 或 archive。先停止写入，记录当前 CLI 与
skill 来源，再按已验证备份恢复安装层。数据格式迁移不属于安装回退。
