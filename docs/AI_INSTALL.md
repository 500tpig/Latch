# Latch 本机安装

Latch 面向个人 macOS 开发环境。当前 repo package 和 CLI 版本为 `0.6.1`；新 task
使用 schema 5，并保存 `min_writer_version: "0.5.0"`。CLI JSON envelope 使用
schema 3，event 文件继续使用 `events_schema_version: 3`。产品规则以
[最终产品契约](prd/2026-07-15-latch-final-product-contract.md)为准。

## 检查源码 release

在 Latch 源码 repo 执行：

```bash
node -p "require('./package.json').version"
node dist/cli.js --help
pnpm skill:check
```

版本应为 `0.6.1`。顶层 help 应包含 `checkpoint`、`submit`、`done` 和
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

需要更新全局 CLI 时，先记录 `command -v latch` 和当前 package 来源。pnpm 11 使用
`pnpm add -g .` 将当前本地 package 的 bin 注册到全局。只有获得单独安装授权后，
才在待发布的源码 repo 执行：

```bash
pnpm add -g .
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

canonical 目标为：

```text
~/.agents/skills/latch
```

`~/.codex/skills` 由 cc-switch 等 Codex 专属 skill manager 管理，Latch 不再向该目录
安装自己的链接。链接脚本会删除仍精确指向本仓 canonical source 的旧
`~/.codex/skills/latch`；不同 target 的 symlink、普通文件或目录均视为其他管理器所有，
必须保留。

用户级可发现不等于对所有 repo 自动生效。canonical Skill 只在项目 `AGENTS.md`
明确接入、repo root 已存在 `.latch`、对话正在继续已知 Latch task，或用户显式请求
Latch 时进入支持范围。`.latch` 只表示项目支持 Latch，不单独创建 task。普通仓库仅因
请求会写文件或改变行为，不运行 Latch startup，也不询问是否初始化。

链接脚本只管理上述符号链接，不复制文档快照，不修改 cc-switch 数据库或
`~/.cc-switch/skills`。源码更新不证明外部 adopter 已完成 CLI 安装或行为验收。

## 初始化项目

初始化是显式操作。Latch 已被有效激活后，未初始化目录中的
`latch list --json --brief` 返回
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

所有结构化 JSON file option 可将路径写为 `-`，从 stdin 读取一个完整 JSON value；
同一命令最多一个 option 使用 `-`。stdin 不对应 workspace path，也不会进入 workspace
evidence。真实文件继续使用既有 evidence 语义；`record --body-file` 等文本输入不适用。

业务项目的 `AGENTS.md` 应先写清：`.latch` 或接入只表示支持 Latch，普通写入不单独建
task；命中 enable 条件后才按触发章 A/B/C 选择 Light 或 Standard。A 停在 grill；B
创建或续接 Light task 并以请求授权；C 创建或续接 Standard task，返回决策重点与
task ID 后等待明确 approve。纯问答、只读探索不建 task。明确要求「不用 Latch」时，
仅在无已知 continuation 或 closeout 责任时按请求执行。减少的是 task bookkeeping，
不是必要验证。

### Adopter AGENTS 规则模板

以下有界区块可直接复制到 adopter repo 的 `AGENTS.md`。项目专属规则放在区块外，避免
修改模板中的 runner、启动读取和连续 mutation 契约。

```markdown
<!-- LATCH:BEGIN -->
## Latch task 规则

- `.latch` 或本区块只表示项目支持 Latch，普通写入不单独建 task。低风险、局部、单会话请求直接修改、运行最窄权威验证并检查 diff。命中已知 task 续接、多个独立验收面、需要确认、公共契约、认证权限、持久化或并发语义、不可逆外部副作用、跨会话或需要 workspace proof 时，才创建或续接 task。纯问答、只读探索不建 task。明确「不用 Latch」仅在无已知 continuation 或 closeout 责任时按请求执行。减少的是 task bookkeeping，不是必要验证。风险不得只按代码行数或文件数判断。
- 开始时先运行 `latch --version`，版本必须为 `0.6.1`；版本不匹配或无法确定 runner 时停止。新 task 使用 schema 5，`min_writer_version` 固定为 `0.5.0`，schema 2–4 只读且不得 mutation。
- 冷启动、compaction 或恢复时依次读取 `git status --short`、`latch list --json --brief`。已知 task ID 时读取 `latch context <task-id> --json --status`；否则只为 list 返回的 `current_task_id` 读取 status；两者都没有时不得调用无 task ID 的 context。
- 先读 task artifact；status 不足时只展开一张 task 的 bounded brief。普通启动和恢复不读取 Record、其他会话或无关 task。
- 命中 enable 条件后执行 A/B/C 判断：目标、成功标准、范围、根因或高风险改法不明确时停在 grill；范围固定、低风险且 `open_questions` 为空时使用 Light；涉及方案确认、多个独立验收面、产品选择、公共契约或高风险面时使用 Standard，并在创建后等待明确批准。
- 同一线程连续 mutation 直接复用成功 JSON 返回的 task ID、`revision` 与 `next_action`，不重复启动读取；仅在信息失效、revision conflict、warning 需要判断或 task 语义变化时刷新 status，不为 `revision` 或 `next_action` 重读 context，也不自动重试 conflict。
- Standard 明确批准后默认执行 `approve <task-id> --expect-revision <revision> --reason <text>`；`takeover`、`done`、`abandon` 和 Git 操作分别遵守明确授权边界，task 授权不包含 Git add、commit、push、branch、checkout、reset 或 clean。
<!-- LATCH:END -->
```

Grok 与 Codex 均可作为可写宿主。无法解析稳定 session ID 时保持只读，不手工设置
`LATCH_ACTOR`。跨对话或跨工具续写同一 open task 仍需针对具体 task 和 revision 的
明确 `takeover` 授权。

## Historical schema

schema 2–4 task 和 archive 保持原值。CLI `0.6.1` 可通过 `list` 和精确 ID
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
