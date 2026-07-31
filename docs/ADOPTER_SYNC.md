# Latch schema 4 接入状态

本页记录 Latch 0.4.0、task schema 4 与现有 adopter 的当前兼容事实。
第一阶段的历史验收结果见[第一阶段验收](FIRST_PHASE_REVIEW.md)。

## 当前兼容矩阵

截至 2026 年 7 月 31 日：

| 项目 | 当前状态 | 证据 | 后续动作 |
|---|---|---|---|
| Latch | 已支持 schema 4 | 实现 commit `1337ad0`；来源 task `20260730081226422-设计-schema-4-与旧-cli-机器级拒写机制-a9df34` 已归档为 `done`，revision 10 | 当前 repo 无 Core 修改需求 |
| Latch-Board | 已兼容并完成本机 Git delivery | task `20260730103036997-适配-latch-task-schema-4-reader-与-ui-ed512e` 已归档为 `done`，revision 8；commit `10569dd` 包含 reader、UI、fixture 和文档改动；`pnpm test` 通过 92 项测试，`pnpm build` 与 `git diff --check` 通过 | 完成手工 UI 验收；按需 push，并在其他机器更新 checkout |
| appearance-sec | 当前安装兼容，无须修改或升级 task | `latch list --json --brief` 无 open task；项目 `AGENTS.md` 只引用 canonical skill，没有 schema 3 可写、CLI 0.2.0/0.3.0 或旧 claim/takeover 声明 | 无 |
| monitoring | 当前安装兼容；一张 open schema 3 task 待显式升级 | `latch list --json --brief` 返回 task `20260724092034743-04-echarts-p2-需求选择与方案定稿-37794f`，schema 3、revision 2；primary writer 为 `codex:session:019f9359-e259-7ad1-86f0-f6fd56ef4da5` | 停止旧 writer 后，由原 primary writer 显式执行单 task `upgrade-v4` |

## Schema 边界

- 新 task 使用 `schema_version: 4`，并保存
  `min_writer_version: "0.4.0"`。
- CLI 0.2.0 和 0.3.0 读取 schema 4 `task.json` 时拒绝写入，不继续
  mutation 或追加 event。
- `latch list` 和 `latch context` 的 JSON envelope 继续使用
  `schema_version: 2`。
- `events_schema_version: 3` 表示 forward-compatible event log 语法，不是
  task writer 版本；`schema_upgraded` 记录 3→4 升级。
- schema 3 已冻结为只读。普通 lifecycle mutation 不得写入 schema 3。

## Latch-Board 兼容结果

开放 task 继续只通过以下 CLI schema 2 envelope 读取：

```text
latch list --json --brief
latch context <task-id> --json --status
latch context <task-id> --json
```

Board 不读取 `.latch/tasks/*/task.json` 或开放 task 的 `events.jsonl`。commit
`10569dd` 已完成以下兼容处理：

- open task 支持 schema 3/4，并校验 schema 4 的
  `min_writer_version: "0.4.0"`；
- schema 3 的 `upgrade_required`、`schema_upgrade_required` 和原
  `primary_writer` 保持可见，不再错误归类为 status contract unsupported；
- 未知 task schema 按单 task 隔离，不影响同一数据源的其它可读 task；
- archive 直接读取 schema 3/4 `task.json`，schema 2 仍为
  `legacy unsupported`；
- `schema_upgraded` 按 event schema 3 校验和展示，不再产生伪
  `history_incomplete`；
- schema 4 open、review、archive fixture 已由测试实际读取。

使用四个指定 repo 的真实只读流程核验后：

- Latch 与 Latch-Board 的 schema 4 open task 均显示为可读；
- appearance-sec 显示为空数据源；
- monitoring 的 schema 3 task 显示 `upgrade_required: true`，且没有
  unsupported task；
- 来源 schema 4 archive 可打开，包含一条 `schema_upgraded` event，
  `history_incomplete: false`，warning 为空。

Board 未启动 dev server 或浏览器；任务卡、详情、数据源和归档的视觉与交互仍由
手工验收确认。

## Open schema 3 升级清单

当前只发现 monitoring 的一张 open schema 3 task：

```text
task_id: 20260724092034743-04-echarts-p2-需求选择与方案定稿-37794f
revision: 2
primary_writer: codex:session:019f9359-e259-7ad1-86f0-f6fd56ef4da5
phase: plan
```

当前审计 session 与 primary writer 不一致，因此保持只读。不得通过
`takeover`、`save`、`claim` 或批量迁移绕过。停止旧 writer 并由原 primary
writer 获得明确授权后，执行：

```bash
latch upgrade-v4 \
  --task 20260724092034743-04-echarts-p2-需求选择与方案定稿-37794f \
  --expect-revision 2 \
  --json
```

本次同步没有执行该命令。

## 安装与传播边界

当前机器：

- 全局 `latch@0.4.0` 通过 pnpm link 指向当前 Latch repo；
- `~/.codex/skills/latch` 和 `~/.agents/skills/latch` 通过符号链接指向
  `skills/latch/`；
- Latch-Board、appearance-sec 和 monitoring 没有项目本地 `latch`
  package 依赖，因此同一台机器上的后续 CLI 调用已经使用 0.4.0；
- canonical skill 是符号链接，不是复制快照，因此当前 repo 的 skill 更新在本机
  直接生效。

本机 Git delivery：

- Latch-Board 的 reader、UI、fixture 和文档改动已提交为 `10569dd`；
- 原有 `src/features/archive/archive.css` 和 `src/features/tasks/tasks.css`
  worktree 改动未包含在该 commit 中。

尚未传播：

- 复制安装的 CLI 或 skill 不会自动更新；
- 其他机器的独立安装需要分别更新 CLI 与 canonical skill；
- 本次同步未执行 npm 发布，也未执行 Git push、branch、checkout、reset 或
  clean。

## 历史接入证据

schema 4 之前的 v2 接入基线继续保留：

- Latch：`cd52f2d`，核心 CLI 变更为 `3b52dde`；
- Latch-Board：`d41ada8`；
- appearance-sec：`9bd4272`；
- monitoring：`ee66345`。

对应历史 task：

- Latch 全局切换：
  `20260711204409413-记录-latch-v2-全局-cli-与-canonical-skill-切换结-11b91e`；
- Latch-Board 接入：
  `20260712125221841-核验并完成-latch-board-v2-接入-56189c`；
- appearance-sec 接入：
  `20260712093857114-appearance-sec-接入-latch-v2-70e6f2`；
- monitoring 接入：
  `20260712100204504-monitoring-接入-latch-v2-fddadf`。

这些历史 commit 和 task 只证明 v2 接入，不单独证明 schema 4 兼容。
