# Latch 本机安装

Latch 面向个人 macOS 开发环境。v1 备份在观察期结束前继续保留。

schema 3 task 写入与 R2 回退要求 CLI 版本不低于 `0.2.0`。该版本保留 v2 JSON envelope；产品规则以 [最终产品契约](prd/2026-07-15-latch-final-product-contract.md)为准。

## 检查当前安装

检查全局命令：

```bash
command -v latch
latch --help
pnpm list --global --depth -1
```

在 Latch 源码 repo 检查 canonical skill 链接：

```bash
pnpm skill:check
```

`latch --help` 应显示 `claim`、`patch-submission-knowledge-impact` 和 `downgrade-v2`；
`latch checkpoint --help` 应显示 `--profile`、`--authorize-request`、
`--scope-summary`、`--scope-path`、`--authorization-file` 和
`--retrospective-file`；`latch submit --help` 应显示 `--knowledge-impact-none`；
`latch save --help` 应显示 `--provenance`。接入状态与来源 commit 见
[接入状态](ADOPTER_SYNC.md)。

## 构建 CLI

```bash
pnpm install
pnpm check
pnpm build
```

package bin 指向 `dist/cli.js`。当前全局 package 通过 pnpm link 指向本 repo，
因此重新构建会直接影响全局命令。重新链接前先记录现有来源；确认需要切换后，
在源码 repo 执行：

```bash
pnpm link --global
```

## 链接 canonical skill

canonical source：

```text
skills/latch/SKILL.md
```

检查目标：

```bash
pnpm skill:check
```

创建或更新链接：

```bash
pnpm skill:link
```

目标为：

```text
~/.codex/skills/latch
~/.agents/skills/latch
```

链接脚本只管理符号链接，不复制文档快照。

## 初始化项目

新项目直接执行：

```bash
latch init
```

初始化后的普通 `checkpoint` 创建 schema 3 standard task，并写入
`provenance: clean`。普通 light request 使用 `--authorize-request <reason>`，可选
`--scope-summary` 和重复的 `--scope-path`；复杂 authorization 继续使用
`--profile light --authorization-file`。提交无知识影响时使用
`--knowledge-impact-none <reason>`，`updated` impact 继续使用
`--knowledge-impact-file`。retrospective 创建使用 `--retrospective-file`。既有 schema 2/3 task 不批量改写；
缺失 provenance 时按 `clean` 读取，明确继续具体 schema 2 task 后由 `claim` 完成升级。

v2 不迁移 v1。已有 `.latch` 时，先将原目录备份到 repo 外，记录来源和
checksum，确认恢复方法，再移走旧目录并执行 `latch init`。备份位置记录在
对应接入 task 中，不写入 current 文档。

业务项目的 `AGENTS.md` 应写入触发章 A/B/C：A 停在 grill；B 创建或续接 light task 并以请求授权；C 创建或续接 standard task，展示 plan 后等待明确 approve。纯问答、只读探索、无写入意图或明确要求「不用 Latch」时不建 task。

## Schema 3 task 回退

回退单张 task 前先停止该 task 的其它写入，并确认 v3 专用字段和 event 细节只保留在 backup：

```bash
latch downgrade-v2 \
  --task <task-id> \
  --expect-revision <revision> \
  --confirm-data-loss
```

成功后检查命令返回的 `.latch/archive/v3-backup/` 路径，并使用目标 v2 CLI 执行 `context <task-id> --json`。回退失败时不得删除 `.latch` 或已创建的 backup。

## 备份保留

v1 CLI、skill、Board 基线和三个接入 repo 的 `.latch` 备份继续保留。满足以下
条件后，才能单独评估是否删除：

1. 第二阶段状态文档已经归档；
2. 已完成 10 张符合规则的真实 v2 task；
3. 观察期评估没有发现必须依赖 v1 恢复的问题；
4. 获得删除备份的单独明确授权。

观察规则见 [Latch v2 观察期](OBSERVATION.md)。

## 回退

回退前先停止新的 v2 task，并确认目标 repo 没有进行中的写操作。按切换的
相反顺序恢复：

1. 从已校验备份恢复业务项目 `.latch`；
2. 将 Latch-Board 恢复到记录的基线 commit；
3. 恢复两个全局 skill 的原链接或备份；
4. 恢复全局 v1 CLI 构建。

恢复后重新检查命令来源、skill 链接和项目状态。回退不依赖 v2 migration，
也不删除 v2 期间产生的归档证据。
