# Latch v2 观察期

本页定义第二阶段完成后的观察规则。观察期使用其他项目正常开发产生的归档
task，不为统计专门制造任务，也不维护第二份实时台账。

## 起点

来源 task：

```text
20260713023333141-记录-latch-v2-第二阶段完成状态与观察期-93adbb
```

该 task 归档为 `done` 后，`closure.accepted_at` 是观察起点。只有在该时间之后
完成的 task 才能成为候选样本。观察期结束前继续保留 v1 备份。

## 正常使用

- 在其他项目按真实需求开发，不改变原有工作安排；
- 只有明确要求使用 Latch 时才创建 task，小修、普通问答和只读分析不强制进入；
- task 按 `plan`、`dev`、`check`、`review` 和 `done` 的正常流程执行；
- 每张 task 的 `.latch/archive` 是原始记录，完成后不回到 Latch repo 手工登记。

## 样本规则

以下工作可以纳入：

- 功能开发；
- bug 修复；
- 有明确目标和验收条件的重构；
- 运维、迁移或配置工作；
- 有实际交付物的技术文档工作。

以下 task 不纳入：

- Latch 安装和接入迁移；
- smoke 或一次性命令试验；
- 单纯记录状态；
- 对同一改动的重复核验；
- outcome 为 `abandoned` 的 task；
- 在观察起点之前完成的 task。

## 证据来源

进度检查和最终评估只读取明确指定 repo 中的：

```text
.latch/archive/**/task.json
.latch/archive/**/events.jsonl
```

不读取 Codex 会话、聊天归档或跨会话材料。Latch-Board 可以用于发现已配置的
数据源，最终判断仍以各 repo 的归档文件为准。

`revision conflict` 通常发生在写命令失败时，未必写入 task 事件。因此只在
`task.json`、`events.jsonl`、submission 或 closure 明确记录时计数；没有记录时
标为「未知」，不能按 0 次处理。

## 检查进度

观察期不会在后台自动监控。可以在任何时间发起进度检查，不必等到估计已有
10 张 task。推荐请求格式：

```text
检查 Latch v2 观察期进度。

候选 repo：
<repo-a>
<repo-b>
<repo-c>
```

如果候选项目已经全部配置到 Latch-Board，也可以明确使用其数据源列表：

```text
检查 Latch-Board 已配置数据源中的观察期进度。
```

检查时先读取本页和来源 task 的 `closure.accepted_at`，再读取指定 repo 的归档。
结果应列出合格数量、排除项及原因。进度检查只读数据，不创建评估 task。

## 选取样本

最终评估按以下顺序选取样本：

1. 由用户明确给出候选 repo，或明确授权使用 Latch-Board 的数据源列表；
2. 读取观察起点之后 outcome 为 `done` 的归档 task；
3. 按样本规则排除不合格 task；
4. 按 `closure.accepted_at` 从早到晚排序；
5. 取最早的 10 张作为固定样本。

候选数量不足 10 张时只报告当前进度，不提前形成结论。

## 观察字段

| 字段 | 主要证据 | 判断内容 |
|---|---|---|
| Plan 变化 | `plan_revision`、`plan_updated` | 实施前后是否频繁返回 plan |
| Review 返工 | `review_feedback`、`work_revision` | review correction 的次数和原因 |
| Gate 问题 | `verification_run` | 失败 gate、重复验证和最终状态 |
| Blocked | `blocked`、`unblocked` | 等待对象、持续时间和是否影响 phase 理解 |
| Revision conflict | 明确记录的错误说明 | 是否出现；没有证据时记为「未知」 |
| 未验证范围 | submission、closure | 是否反复遗漏相同验证 |
| 最终结果 | outcome、follow-up | task 是否完成，以及是否产生后续工作 |

## 结束条件

完成 10 张固定样本后，新建「评估 Latch v2 观察期结果」task。该 task 只做
统计和判断，不直接修改 CLI、Board 或提示词。评估完成并获得单独授权后，
再决定是否删除 v1 备份或创建具体改进 task。
