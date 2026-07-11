# Latch v2 使用手册

Latch v2 记录显式创建的本地 coding task。每张 task 保存 plan、批准、工作轮次、验证、submission 和 archive outcome。

## 基本流程

```text
plan -> dev -> check -> review -> done
                    └──────────> dev
plan/dev/check/review -> abandoned
```

blocked 不改变 phase。处于 dev、check、review 的 blocked task 继续占用当前 workspace。

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

首次批准绑定当前 plan revision。review 中的明确实现修正保留 plan approval，增加 `work_revision` 并回到 dev。

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

所有 task 更新需要 `--expect-revision`。锁顺序固定为 `workspace -> task -> state`。真正并行实现需要外部 Git worktree；Latch 不负责创建或合并 worktree。
