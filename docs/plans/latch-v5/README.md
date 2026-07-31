# Latch 工作流改进计划与对话交接

Source-Task: `20260731093527854-冻结-s3-结构化收尾-candidate-规划-258da4`

Source-Task-Plan-Revision: `3`

Source-Brief: `docs/briefs/2026-07-31-latch-v5-workflow-contract.md`

Source-Baseline: `35e6ff0f3fedc4753c04d8a599075c1d0621f411`

Plan-Revision: `7`

Document-Status: `proposed`

## 用途

本目录记录 Latch 工作流改进的当前基线、S2 试点、已冻结的 S3 candidate 和剩余
candidate backlog。完整背景、产品边界和候选项关系见 Source Brief。

这些文件不构成 implementation authorization。S2 和 S3 只能在各自的 Standard task
获得精确 Revision 的明确批准后实施；S3 的准备阶段还需要独立授权。

## 当前状态

| 类型 | 项目 | 文件 | 状态 |
|---|---|---|---|
| 已完成基线 | S1 未初始化停止边界 | `01-not-initialized-boundary.json` | 已完成、验收并通过 commit `d83fe11` 交付 |
| 待决定试点 | S2 schema 4 Light plan authoring | `02-light-plan-authoring-pilot.json` | proposed，尚未授权实施 |
| 已冻结 candidate | S3 schema 5 结构化 closeout | `03-structured-closeout-candidate.json` | candidate，尚未授权准备或实施 |
| 历史指针 | 旧 S3 closeout candidate | `backlog/03-schema5-structured-closeout.json` | superseded |
| 暂停候选 | schema 5 其它设计与后续发布 | `backlog/` | candidate backlog |

S1 不再进入规划、批准或实施流程。`01-not-initialized-boundary.json` 仅保留为设计和
实施范围的追溯 artifact。

S2 仍是独立试点。S3 已冻结为可供后续决策的 candidate，但不由 S1、S2 或本次文档
更新自动触发。

## S2 试点边界

S2 只降低 Light plan 的填写成本：

- Light template 只展示 `goal`、`workspace_scope`、`scope`、`acceptance`、
  `approach` 和 `verification_plan`；
- 缺失的 assumptions、user flow、out-of-scope 和 open questions 在创建 task 前
  确定性补为空数组；
- 落盘 task 继续使用完整 schema 4 plan shape；
- Standard plan、CLI `0.4.0`、minimum writer、scope 参数、work basis、proof、
  submission 和 closeout 保持不变。

S2 不包含 schema 5、CLI `0.5.0`、旧 schema 拒写、单一 scope 真源、结构化
closeout 或 event/view。S3 的修正版计划保存在
[`03-structured-closeout-candidate.json`](03-structured-closeout-candidate.json)，其余设计继续保存在
`backlog/`。

## S3 candidate 边界

S3 candidate 从 source baseline
`35e6ff0f3fedc4753c04d8a599075c1d0621f411` 启动，采用隔离 worktree 和仓库外
immutable CLI `0.4.0` runner。S3 自身的 schema 4 task 只由 immutable runner 管理；
schema 5 临时 task 只由 candidate `0.5.0` repo-local CLI 管理。

source baseline 只提供代码和 current `0.4.0` 契约：它不包含新 candidate，且仍保留旧
backlog/03。实施对话只能读取 handoff manifest 指定的 Git delivery commit 中
`03-structured-closeout-candidate.json` 的精确字节，并核对文件 SHA-256、Source-Task
和 Plan Revision 3。

candidate 同时冻结以下契约：

- 最小 lifecycle、Context 投影和 schema 5 event validator；
- `accepted_risk` 的明确用户接受事实；
- 带绝对 `https:` 或 `mailto:` `account_uri` 的 external owner；
- immutable `0.4.0` 拒写 schema 5，candidate `0.5.0` 拒写 S3 schema 4 task；
- 准备阶段绑定 candidate path、SHA-256、delivery commit、Source-Task 和 Plan Revision 3，
  返回完整 handoff manifest 后停止；
- immutable runner 的核心文件 hash 必须匹配可信 source baseline clean build 或预先
  记录的主仓库 CLI `0.4.0` 基准 hash；
- Standard plan 完整内容写入 plan file 和 task store，聊天默认只返回决策重点、task ID
  与 Board/CLI 入口。

S3 使用 `tests/fixtures/context-v5-candidate.json` 固定最小 lifecycle 和 view。丰富
timeline 及独立的 Board/external-reader contract fixture 属于 S4；current 文档、安装
和发布属于 S5。S3 candidate 不修改 current 产品契约，也不授权准备或实施。

## S2 推荐交接流程

1. 主规划对话冻结 S2 plan 文件；
2. 用户完成规划 artifact 的 review acceptance 和 Git delivery，并记录 commit；
3. 新实现对话读取 S2 plan、规划基线 commit 和实时 workspace 状态；
4. 新实现对话使用 current CLI `0.4.0` 创建自己的 Standard task，成为
   `primary_writer`；
5. 新实现对话返回 Standard plan 的决策重点和 task ID，完整 plan 由 Latch-Board 或
   `latch context` 提供，并等待明确批准；
6. 批准后实施、执行全部 named gate，并 submit 到 review；
7. 新实现对话返回 task ID、revision 和未验证事项后停止；
8. 主规划对话只读复核实施 task，并等待用户决定是否验收。

主规划对话不预建 implementation task，不要求实现对话读取旧聊天或 Record。

## 新切片：两步启动

S2 尚未批准实施时，先发送：

```text
仓库：<repo-path>

读取 docs/plans/latch-v5/02-light-plan-authoring-pilot.json，按 canonical Latch Skill 创建新的 Standard task，返回绑定精确 revision 的决策重点与 task ID；完整计划保存在 task store。不要 approve、不要实施、不要操作 Git，等待确认。
```

task 创建后发送：

```text
批准 <task-id> Revision <revision> 的当前完整计划。按计划实施、执行全部 named gates，并 submit 到 review 后停止。不要实施 backlog，不要操作 Git。
```

## review 回传

实现对话只需返回：

```text
TASK=<task-id>
REV=<revision>
UNVERIFIED=<内容或 none>
```

主规划对话的复核输入：

```text
复核 TASK=<task-id> REV=<revision>
```

主规划对话从 task artifact 读取 changes、gate、submission 和 worktree 状态，不要求
复制实现聊天、完整命令输出或 diff。

## 继续同一 open task

默认不使用 takeover。确需更换 writer 时，handoff 必须包含精确 task ID、revision、
plan revision、旧 writer、未完成事项和 worktree 状态，并明确说明旧会话已停止写入。

takeover 只转移 writer，不构成 plan approval 或 implementation authorization。

## 停止条件

实现对话遇到以下情况时返回主规划对话：

- plan 文件与指定规划基线不一致；
- current CLI 不是 `0.4.0`，或 task schema 不再是 4；
- workspace scope 需要扩大；
- 需要改变 Standard、scope 参数、work basis 或 lifecycle 契约；
- 需要 schema 5、migration、双写、旧 schema 拒写或 fallback；
- 出现新的产品选择；
- named gate 修改 workspace；
- 需要 Git、Record、外部 repo 或破坏性操作；
- task writer 与当前会话不一致，且没有精确 takeover 授权。

## Candidate backlog

其余暂停项见 [candidate backlog](backlog/README.md)。旧
`backlog/03-schema5-structured-closeout.json` 仅保留 superseded 指针，唯一有效的 S3
candidate 是 [`03-structured-closeout-candidate.json`](03-structured-closeout-candidate.json)。

S2 完成、本次 S3 规划冻结或任一 review acceptance 均不会自动创建 worktree、runner、
implementation task，也不会启动 schema 5、event/view、current release 或 external
adopter 工作。
