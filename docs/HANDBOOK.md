# Latch v2 使用手册

Latch v2 记录显式创建的本地 coding task。每张 task 保存 plan、批准、工作轮次、验证、submission 和 archive outcome。

## 基本流程

```text
plan -> dev -> check -> review -> done
                    └──────────> dev
plan/dev/check/review -> abandoned
```

blocked 不改变 phase。其他处于 dev、check、review 的 task 不阻止批准；共享 worktree 风险仍会作为 warning 返回。

## 命令

### 初始化

```bash
latch init
```

v2 不迁移或覆盖 v1 `.latch`。

### 创建与选择

```bash
latch checkpoint "任务标题" --plan-file plan.json
latch use <task-id>
latch list --json --brief
latch context [task-id] --json --brief
```

`checkpoint` 必须读取完整 plan 文件。同标题 task 不覆盖。`use` 只修改当前 actor 的索引。

`context --json --brief` 不返回完整 `plan`，但 `task.verification_plan` 会列出每项计划验证的 `name`、`command`、`kind` 和 `status`。`status` 为 `pending`、`stale`、`pass` 或 `fail`；`task.verification` 继续保留执行结果的完整记录。

### 更新计划和状态

```bash
latch save <task-id> --expect-revision 3 --plan-file plan.json
latch save <task-id> --expect-revision 4 --decision "采用本地 JSON"
latch save <task-id> --expect-revision 5 --block-reason "等待接口" --waiting-for "后端确认"
latch save <task-id> --expect-revision 6 --unblock
```

plan 任一持久化值变化都会增加 `plan_revision`，phase 回到 plan，并使旧批准、gate 和 submission 失效。

### 批准实施

```bash
latch approve <task-id> --expect-revision 7 --reason "用户批准当前 plan"
latch approve <task-id> --expect-revision 12 --feedback "修正实现细节"
```

首次批准绑定当前 plan revision。review 中的明确实现修正保留 plan approval，增加 `work_revision` 并回到 dev。发现其他活动 task 时，批准仍会成功，并提示共享 worktree 风险。

### 验证

```bash
latch verify <task-id> --expect-revision 8 --name typecheck
latch verify <task-id> --expect-revision 9 --diagnostic --name exploratory -- pnpm typecheck
```

普通 gate 执行 plan 保存的 argv，不接受调用方替换命令。diagnostic 可以使用 plan 命令或 `--` 后的临时 argv，不参与 submit 门禁。验证进程不经过 shell。

### 提交 review

```bash
latch submit <task-id> --expect-revision 10 \
  --changes "完成实现" \
  --unverified "未做浏览器验收"
```

无可执行 gate 的任务使用：

```bash
latch submit <task-id> --expect-revision 4 \
  --no-verify \
  --reason "只有文档改动" \
  --changes "更新设计说明" \
  --unverified "未运行代码测试"
```

submission 绑定当前 work revision。verified 摘要由结构化 gate 结果生成。

### 归档或放弃

```bash
latch done <task-id> --expect-revision 11 --followup "后续观察"
latch abandon <task-id> --expect-revision 5 --reason "用户取消"
```

`done` 只接受 review 中当前 work revision 的有效 submission。`abandon` 必须提供原因。AI 只有获得明确用户授权后才能执行这两个命令。

## 并发与文件

- task：`.latch/tasks/<task-id>/task.json`；
- event：`.latch/tasks/<task-id>/events.jsonl`；
- actor current：`.latch/state.json`；
- archive：`.latch/archive/YYYY-MM/<task-id>/`。

所有 task 更新需要 `--expect-revision`。task 使用独立短锁；需要组合锁时顺序固定为 `task -> state`。Latch 不跟踪 task 的文件归属，验证命令针对整个 worktree；需要代码隔离时由用户使用外部 Git worktree，Latch 不负责创建或合并它。

## 最终契约部分实现边界

C1–C4 已部分实现。C1–C3 在临时 fixture 中提供 session writer、Light 证明包与 Group 最小集的 schema 3 读取、校验和生命周期行为；C4 提供独立于 task schema 的 Git 知识文档 freshness 只读检查。

Group 只聚合 task，不增加 group phase、revision、锁或完成门禁。schema 3 fixture 可使用 `save --group` 或 `save --clear-group` 修改单张 task；`list --group [--include-archive]` 返回精确匹配的成员与派生计数，`context` 只附带受限的 sibling 摘要。Group 变更不会修改 plan、work basis、verification 或 submission。

知识文档使用 YAML frontmatter 的 `covers`、`status`、`last_fingerprint` 与 `last_fingerprint_algo` 判定 freshness：

```bash
latch knowledge fingerprint --path docs/modules/example.md --json
latch knowledge check --path docs/modules/example.md --json
latch knowledge check --task <task-id> --json
```

`fingerprint` 只计算 `sha256-v1`；`check --path` 返回 `fresh`、`stale`、`baseline_missing`、`error` 或 `retired`；`check --task` 只检查当前 submission 中 `knowledge_impact.updated` 引用的 artifact。三种调用都不写知识文档、task、events 或 state。baseline 只能由已授权的普通文档编辑更新，freshness 结果不增加 submit、done 或 group 门禁。

默认 `latch checkpoint` 仍创建 schema 2 task，不接受 `--group`。真实 `.latch` 不写 schema 3 或 v3-only event。C5 Context pack、schema 2→3 迁移、R2 `downgrade-v2` 和全面 current 切换仍未发布；本手册其余命令继续以 v2 为准。
