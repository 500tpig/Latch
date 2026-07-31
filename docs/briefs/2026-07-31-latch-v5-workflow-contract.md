# Latch 工作流改进与 S3 candidate

Source-Task: `20260731093527854-冻结-s3-结构化收尾-candidate-规划-258da4`

Source-Task-Plan-Revision: `3`

Source-Baseline: `35e6ff0f3fedc4753c04d8a599075c1d0621f411`

Plan-Revision: `7`

Document-Status: `proposed`

Date: 2026-07-31

## 地位

本文件记录 Latch 工作流改进的当前基线、S2 试点、已冻结的 S3 candidate 和剩余
candidate backlog。本文件不是 current 产品契约，也不构成 S2、S3 或任一 backlog
项的 implementation authorization。

当前状态分为四层：

1. S1 未初始化停止边界已经完成、验收并通过 Git commit `d83fe11` 交付；
2. S2 schema 4 Light plan authoring 仍是独立的 proposed 试点；
3. S3 schema 5 结构化 closeout 已冻结为 candidate，但尚未授权准备或实施；
4. 其余 schema 5、event/view 和 current release 设计继续保存在 candidate backlog。

current 行为仍以 [使用手册](../HANDBOOK.md)、[设计边界](../DESIGN.md)和 canonical
Skill 为准。S3 的规划 source baseline 为
`35e6ff0f3fedc4753c04d8a599075c1d0621f411`。

## 当前基线：S1 已交付

S1 解决未初始化目录中的 Latch 流程空转问题。交付内容包括：

- root discovery 返回稳定的 typed `not_initialized` 错误；
- JSON error envelope 使用稳定 error code，不依赖 message 匹配；
- canonical Skill 收到 `not_initialized` 后立即停止 Latch 后续步骤；
- 未初始化探测不打印 template、不创建 plan、不调用 checkpoint，也不自动执行
  `latch init`；
- current 使用说明和相关测试同步更新。

S1 已完成、验收并通过 commit `d83fe11` 交付，是后续规划使用的当前基线。
`docs/plans/latch-v5/01-not-initialized-boundary.json` 只保留为设计与实施范围的追溯
artifact，不再需要新的规划、批准、实施或验收。

## 剩余问题

### Light plan authoring 负担

当前 Light 与 Standard 共用完整 `TaskPlan` shape。Light plan 文件需要填写 12 个
顶层字段，其中以下字段在小任务中经常只是空数组：

- `api_assumptions`；
- `permission_assumptions`；
- `data_assumptions`；
- `user_flow`；
- `out_of_scope`；
- `open_questions`。

这些空字段没有增加新的任务事实，却增加了编写和检查 plan 的成本。

S2 切片只处理这项 authoring 负担，不同时改动 task schema、版本、scope 真源或
review closeout。

### review closeout 事实不可靠

此前样本显示，自由文本 `submission.unverified` 和 `closure.followup` 无法稳定表达
每个未验证事项的处理结果。结构化未验证事项、resolution 和 view 投影仍有价值，
但这组改动涉及新的数据结构、CLI grammar、reader contract 和发布边界。

16 张近期归档 task 的只读评估表明，这不是个别文案问题：未验证事项与自由文本
followup 的关系容易误读，external owner 也经常停留在不可追踪的角色名称。修正版方案
A 已冻结为 S3 candidate，但尚未进入准备或实施阶段。

## 当前决策

### S2 独立试点

S2 保持原有 proposed 状态：

| 切片 | 计划文件 | 状态 |
|---|---|---|
| S2 schema 4 Light plan authoring 试点 | `docs/plans/latch-v5/02-light-plan-authoring-pilot.json` | proposed，尚未授权实施 |

S2 不以「再次决定是否实施 S1」为前置条件。S1 已经是交付基线。

### S3 已冻结 candidate

| 切片 | 计划文件 | 状态 |
|---|---|---|
| S3 schema 5 结构化 closeout | `docs/plans/latch-v5/03-structured-closeout-candidate.json` | candidate，尚未授权准备或实施 |

旧 `docs/plans/latch-v5/backlog/03-schema5-structured-closeout.json` 只保留
superseded 指针，不再是可执行 Standard plan。

### 暂停候选

| 候选项 | 计划文件 | 状态 |
|---|---|---|
| schema 5、CLI `0.5.0`、旧 schema 拒写和单一 scope 真源 | `docs/plans/latch-v5/backlog/02-schema5-plan-authoring.json` | candidate backlog |
| schema 5 丰富 timeline 和 Board/external-reader contract fixture | `docs/plans/latch-v5/backlog/04-schema5-event-view.json` | candidate backlog |
| schema 5 current 文档、安装和 adopter rollout | `docs/plans/latch-v5/backlog/05-schema5-current-release.json` | candidate backlog |

这些文件保留原规划中的产品选择、验收和影响面，但不构成 implementation
authorization，也不再组成 `S2 → S3 → S4 → S5` 的自动执行顺序。

## S3 candidate 契约

### 隔离与双 runner

S3 采用方案 A：从 source baseline
`35e6ff0f3fedc4753c04d8a599075c1d0621f411` 创建隔离 worktree，并在主仓库和 candidate
worktree 之外准备自包含、只读的 CLI `0.4.0` runner。S3 自身的 schema 4 task 只由
immutable runner 管理；schema 5 临时 task 只由 candidate `0.5.0` repo-local CLI
管理。

source baseline 只提供代码和 current `0.4.0` 契约，不包含新 candidate，且仍保留旧
backlog/03 Standard plan。S3 实施对话不得从 baseline worktree 读取该旧 plan，只能使用
handoff manifest 绑定的 planning artifact delivery。

immutable `0.4.0` 必须拒绝 schema 5 mutation，candidate `0.5.0` 必须拒绝 S3
schema 4 task mutation。candidate worktree 内不得使用裸 `latch` 执行 mutation；无法
确定 task schema 或 runner 时立即停止。

### 结构化 closeout

schema 5 为每个未验证事项生成稳定 item ID，并要求归档前逐项给出唯一 resolution：

- `resolved` 保存验收事实和观察结果；
- `accepted_risk` 保存 `accepted_by: "user"`、用户明确接受陈述和 Core 生成的
  `recorded_at`，归档授权不能替代风险接受；
- `followup` 的 external owner 必须使用指向具体账号或团队身份页的绝对 `https:` 或
  `mailto:` `account_uri`，普通角色文字不能作为 owner。

### 最小 lifecycle、Context 与 event

S3 必须跑通：

```text
checkpoint → approve → verify → status/context → submit
           → status/context → done → archived context
```

status、brief、full Context 和 human Context 只实现完成生命周期所需的最低投影，并由
`tests/fixtures/context-v5-candidate.json` 固定。schema 5 使用专用 `submitted` 与 `done`
event validator；`events_schema_version: 3` 保持不变，v2–v4 event 原值读取。丰富
timeline 和独立的 Board/external-reader contract fixture 留给 S4。

### Standard plan 展示与准备 handoff

S3 candidate 继承 source baseline 中最新的 Standard plan 展示规则：完整 12 字段写入
plan file 和 task store；聊天默认只返回 goal、关键 scope、风险或选择、blocking
`open_questions`、task ID 与 Board/CLI 入口。仅在用户要求或字段本身是决策点时展开，
不默认粘贴完整 plan JSON。

创建 worktree、immutable runner 和 candidate Latch 需要独立授权。准备阶段完成后必须
返回完整 handoff manifest 并停止。manifest 必须记录：

- `candidate_plan_path: "docs/plans/latch-v5/03-structured-closeout-candidate.json"`；
- candidate 文件完整内容的 SHA-256，以及包含相同字节的 40 位 Git delivery commit；
- Source-Task `20260731093527854-冻结-s3-结构化收尾-candidate-规划-258da4` 和 Plan Revision 3；
- 精确 source baseline、两个 repo 状态、candidate Latch 根和 runner 路由；
- runner 路径、版本、只读权限、核心文件清单与 SHA-256，以及这些文件与可信 source
  baseline clean build 或主仓库 CLI `0.4.0` 基准 hash 的比较结果；
- 全局 CLI 与 Skill realpath、主仓库 `dist/cli.js` 基准 hash、停止条件、未授权动作和
  准备会话停止写入事实。

准备阶段必须验证 delivery commit 中 candidate 文件的字节与 manifest hash 一致。delivery
commit 缺失、hash 不匹配或 runner provenance 没有可信参照时，必须停止且不得创建或继续
S3 task。

## S2 试点契约

### 目标

在现有 schema 4 契约内降低 Light plan authoring 成本。实施人员只填写六组核心字段，
CLI 在创建 task 前确定性补齐完整 `TaskPlan`，持久化数据和后续 lifecycle 保持不变。

### Light authoring input

Light template 只展示：

```json
{
  "goal": "Describe the intended outcome.",
  "workspace_scope": {
    "paths": []
  },
  "scope": [],
  "acceptance": [],
  "approach": [],
  "verification_plan": []
}
```

六组字段的现有 authorizable 规则继续生效：

- `goal` 必须是非空字符串；
- `workspace_scope.paths` 至少包含一条合法的 repo-relative POSIX path；
- `scope`、`acceptance` 和 `approach` 各自至少包含一条非空内容；
- `verification_plan` 至少包含一个真实 gate；
- instruction-only 命令不构成 gate 证据。

### 确定性补齐

Light input 通过核心字段校验后，CLI 只执行以下固定补齐：

```json
{
  "api_assumptions": [],
  "permission_assumptions": [],
  "data_assumptions": [],
  "user_flow": [],
  "out_of_scope": [],
  "open_questions": []
}
```

补齐过程不读取自然语言、环境变量、Record、旧聊天、其它 task 或隐式默认值，也不猜测
业务事实。

规范化完成后，task store 仍接收现有完整 `TaskPlan`。新 task 继续写：

- `schema_version: 4`；
- `min_writer_version: "0.4.0"`；
- 完整 12 字段 plan shape。

### 保持不变

S2 不修改：

- Standard template 和 Standard plan shape；
- Standard plan 展示与批准门禁；
- `--scope-summary` 和 `--scope-path`；
- work basis、writer、revision 和 provenance；
- gate proof、workspace evidence 和 submission；
- review、done、archive 和 Record；
- package version、CLI version 和 current schema。

### 明确不做

S2 不实现：

- schema 5 或 CLI `0.5.0`；
- current writer 只写新 schema 的 clean break；
- v4/v5 双写、upgrade、downgrade 或 fallback；
- 单一 scope 真源；
- 结构化 `unverified_items` 或 closeout resolution；
- event、Context、timeline 或 reader fixture 变化；
- 全局安装、worktree、外部 adopter 或 Git 自动化。

## S2 代码影响面

S2 的独立 implementation plan 当前限定为：

| 文件 | 责任 |
|---|---|
| `src/core/plan-schema.ts` | 区分 Light authoring input、完整 `TaskPlan` 和 Standard scaffold，并执行固定补齐 |
| `src/cli.ts` | 在读取 plan 前确定 profile，把规范化后的完整 plan 交给 task store |
| `tests/cli-base.test.mjs` | 覆盖 Light/Standard template 和 CLI 输入边界 |
| `tests/light-proof.test.mjs` | 覆盖 Light 创建、落盘 shape、gate 和 scope 行为 |
| `tests/docs-skill.test.mjs` | 固定 current instruction surface |
| `skills/latch/SKILL.md` | 说明最小 Light authoring 输入和完整落盘 shape |
| `docs/HANDBOOK.md` | 更新 current Light plan 使用说明 |

发现需要修改 task store、持久化 type、schema 常量、package version、scope 参数或
lifecycle Core 时，S2 必须停止并返回规划，不得自行扩大 scope。

## S2 验收

- Light template 只包含六组核心字段；
- 六个非核心字段不需要手工写空数组；
- Light input 缺少任一核心字段时被拒绝；
- 没有 workspace scope、真实 gate，或存在 blocking open questions 时不得授权；
- 规范化后的 task plan 保持完整 schema 4 shape；
- Standard template、plan 校验和批准流程不变；
- 既有 schema 4 task 的读取和 lifecycle 不变；
- `--scope-summary` 与 `--scope-path` 语义不变；
- 不增加 schema 5、migration、双写或 fallback；
- `pnpm check` 与 `git diff --check` 通过。

## 观察与后续决策

S2 implementation task 只证明功能和契约符合计划。真实使用观察由后续独立评估处理。

本规划不预设：

- 样本数；
- 观察周期；
- go/no-go 阈值；
- backlog 自动启动条件。

S2 完成后，仍需依据真实使用证据决定是否继续。S3 已根据独立 closeout 样本和明确
产品决策冻结为 candidate，但没有准备或实施授权；其余 candidate backlog 保持暂停。

## 其余 backlog 重新激活条件

除已冻结 S3 candidate 外，其余候选项重新进入规划前至少需要：

1. S2 试点已经完成；
2. 已取得真实 Light task 使用证据；
3. 用户重新确认问题优先级和产品方向；
4. 新规划重新读取 current 实现和测试；
5. 新的完整 Standard plan 已写入 task store，聊天返回决策重点和 task ID，并获得
   精确 Revision 的明确批准。

重新激活不复用本目录中旧 plan 的 implementation authorization，也不自动恢复原
`S2 → S3 → S4 → S5` 顺序。

## 对话与 task 分工

### 主规划对话

主规划对话负责：

- 维护本 Brief、S2 plan、S3 candidate 和 backlog 状态；
- 读取对应 implementation task 的 status、brief 和 submission；
- 保存真实观察后的规划决策；
- 在范围或产品选择变化时生成新的完整 Standard plan 并写入 task store。

主规划对话不负责：

- 重新规划或实施 S1；
- 预建 S2 或 S3 implementation task；
- 创建 S3 worktree、runner 或 candidate Latch；
- 代替实现对话运行 gate；
- 读取实现聊天全文或 Record 正文；
- 执行 Git。

### S2 实现对话

S2 实现对话：

1. 读取 `02-light-plan-authoring-pilot.json`；
2. 读取实时 `git status --short`、Latch list、current 实现和相关测试；
3. 从 plan 创建自己的 Standard task；
4. 返回 plan 的决策重点和 task ID，由 Latch-Board 或 `latch context` 提供完整 plan，
   并等待明确批准；
5. 只实施 S2；
6. 运行全部 named gate；
7. submit 到 review；
8. 返回 task ID、revision 和未验证事项后停止。

实现对话不读取旧聊天或 Record，不实施 backlog，不执行 done 或 Git。

## 验收

- S1 在本 Brief、plans README 和索引中均被记录为 commit `d83fe11` 已交付基线；
- 文档不再要求用户决定、批准或实施 S1；
- S2 schema 4 Light plan authoring 保持独立 proposed 试点；
- S2 的 authoring input、规范化、持久化边界和不变项均可直接实现和验证；
- S3 结构化 closeout 的修正版方案 A 已冻结为唯一 candidate，旧 backlog/03 仅保留
  superseded 指针；
- S3 candidate 固定 source baseline、隔离 worktree、immutable runner、双 runner 拒写、
  最小 lifecycle、Context、event validator、accepted risk、external owner 和 handoff
  manifest；
- handoff manifest 将 candidate plan 的 path、SHA-256、delivery commit、Source-Task 和
  Plan Revision 3 与 runner provenance 一并绑定；
- S3 最小 fixture 与 S4 Board/external-reader contract fixture 使用不同路径和用途；
- S4 丰富展示和 S5 current 发布继续保持独立 candidate backlog；
- proposed 规划不修改 current 产品契约，也不提前宣称 S2、S3 或 backlog 已交付；
- 对话交接只依赖 repo artifact、精确 task 状态和实时 workspace；
- `node --test tests/docs-skill.test.mjs` 与 `git diff --check` 通过。

## 风险

- S2 的输入规范化必须发生在 task store 之前，避免形成第二种持久化 plan shape；
- 如果实现需要修改 task store 或 schema，说明试点边界不足，必须返回规划；
- Light 省略字段只适用于没有这些事实的小任务，存在真实假设或用户流程时应改用
  Standard；
- S3 的准备阶段若不能证明 candidate delivery、精确 baseline、runner 来源与 immutable
  状态或全局链接未变，必须停止；
- 双 runner 选择不明确时不得尝试 fallback 或 mutation；
- candidate 长期保存时必须继续标明未实施状态和 superseded 关系，避免被误作 current
  契约。
