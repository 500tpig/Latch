# Latch 工作流改进计划与对话交接

Source-Task: `20260731061812532-规划-latch-v5-工作流-current-contract-8de6da`

Source-Brief: `docs/briefs/2026-07-31-latch-v5-workflow-contract.md`

Plan-Revision: `5`

Document-Status: `proposed`

## 用途

本目录记录 Latch 工作流改进的当前基线、唯一待决定试点和暂停的 candidate backlog。
完整背景、产品边界和候选项关系见 Source Brief。

这些文件不构成 implementation authorization。S2 只有在对应完整 Standard plan
获得明确批准后才能创建 implementation task。

## 当前状态

| 类型 | 项目 | 文件 | 状态 |
|---|---|---|---|
| 已完成基线 | S1 未初始化停止边界 | `01-not-initialized-boundary.json` | 已完成、验收并通过 commit `d83fe11` 交付 |
| 唯一待决定试点 | S2 schema 4 Light plan authoring | `02-light-plan-authoring-pilot.json` | proposed，尚未授权实施 |
| 暂停候选 | schema 5 与后续发布设计 | `backlog/` | candidate backlog |

S1 不再进入规划、批准或实施流程。`01-not-initialized-boundary.json` 仅保留为设计和
实施范围的追溯 artifact。

S2 是唯一待决定的主动切片。S2 不由 S1 的后续决策触发，也不会自动触发 backlog。

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
closeout 或 event/view。相关设计保存在 `backlog/`。

## 推荐交接流程

1. 主规划对话冻结 S2 plan 文件；
2. 用户完成规划 artifact 的 review acceptance 和 Git delivery，并记录 commit；
3. 新实现对话读取 S2 plan、规划基线 commit 和实时 workspace 状态；
4. 新实现对话使用 current CLI `0.4.0` 创建自己的 Standard task，成为
   `primary_writer`；
5. 新实现对话展示完整 Standard plan，等待明确批准；
6. 批准后实施、执行全部 named gate，并 submit 到 review；
7. 新实现对话返回 task ID、revision 和未验证事项后停止；
8. 主规划对话只读复核实施 task，并等待用户决定是否验收。

主规划对话不预建 implementation task，不要求实现对话读取旧聊天或 Record。

## 新切片：两步启动

S2 尚未批准实施时，先发送：

```text
仓库：<repo-path>

读取 docs/plans/latch-v5/02-light-plan-authoring-pilot.json，按 canonical Latch Skill 创建新的 Standard task，并展示绑定精确 revision 的完整计划。不要 approve、不要实施、不要操作 Git，等待确认。
```

task 创建后发送：

```text
批准 <task-id> Revision <revision> 的完整计划。按计划实施、执行全部 named gates，并 submit 到 review 后停止。不要实施 backlog，不要操作 Git。
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

暂停项见 [candidate backlog](backlog/README.md)。重新激活任一候选项前，需要取得
S2 真实使用证据、重新确认优先级，并创建新的完整 Standard plan。

S2 完成不会自动启动 schema 5、结构化 closeout、event/view、current release 或
外部 adopter 工作。
