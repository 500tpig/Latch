# Latch v2 接入状态

本页记录当前安装和接入事实。第一阶段的历史验收结果见
[第一阶段验收](FIRST_PHASE_REVIEW.md)。

## 当前兼容矩阵

截至 2026-07-13：

| 项目 | 当前状态 | Git 证据 |
|---|---|---|
| Latch | v2 全局 CLI 与 canonical skill 已启用 | `cd52f2d`，核心 CLI 变更为 `3b52dde` |
| Latch-Board | v2 reader、UI、fixture 和归档视图已接入 | `d41ada8` |
| appearance-sec | v2 已初始化，项目规则已切换 | `9bd4272` |
| monitoring | v2 已初始化，项目规则已切换 | `ee66345` |

## Task 证据

- Latch 全局切换：`20260711204409413-记录-latch-v2-全局-cli-与-canonical-skill-切换结-11b91e`；
- Latch-Board 接入核验：`20260712125221841-核验并完成-latch-board-v2-接入-56189c`；
- appearance-sec 接入：`20260712093857114-appearance-sec-接入-latch-v2-70e6f2`；
- monitoring 接入：`20260712100204504-monitoring-接入-latch-v2-fddadf`。

以上 task 均已归档为 `done`。Latch-Board task 归档时保留了 Git
follow-up，随后由 `d41ada8` 完成 Git 落地。

## 观察期

第二阶段接入已经完成。v1 备份继续保留，观察规则见
[Latch v2 观察期](OBSERVATION.md)。完成 10 张真实 v2 task 并单独评估前，
不删除备份，也不因预期问题扩展 CLI 或 Board。

后续外部 repo 修改仍需独立范围和明确授权。
