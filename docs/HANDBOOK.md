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

从 CLI 版本 `0.2.0` 开始，`checkpoint` 创建 schema 3 standard task，并将当前 canonical session actor 写入 `primary_writer`。既有 schema 2 task 保持可读，但普通写入会按 `legacy_unclaimed` 拒绝；明确继续该 task 后，使用 `claim` 完成单 task 升级：

```bash
latch claim <task-id> --expect-revision 3 --reason "继续该 task"
```

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
  --unverified "未做浏览器验收" \
  --knowledge-impact-file impact.json
```

无可执行 gate 的任务使用：

```bash
latch submit <task-id> --expect-revision 4 \
  --no-verify \
  --reason "只有文档改动" \
  --changes "更新设计说明" \
  --unverified "未运行代码测试" \
  --knowledge-impact-file impact.json
```

schema 3 submission 必须通过 `impact.json` 提供 `knowledge_impact`，使用 `none` 时 reason 需说明为何不更新模块知识。submission 绑定当前 work revision，verified 摘要由结构化 gate 结果生成。

### 归档或放弃

```bash
latch done <task-id> --expect-revision 11 --followup "后续观察"
latch abandon <task-id> --expect-revision 5 --reason "用户取消"
```

`done` 只接受 review 中当前 work revision 的有效 submission。`abandon` 必须提供原因。AI 只有获得明确用户授权后才能执行这两个命令。

### Schema 3 回退

需要让 schema 3 task 重新被 v2 CLI 读写时，先明确确认 v3 专用字段和 event 细节只保留在 backup，再执行：

```bash
latch downgrade-v2 \
  --task <task-id> \
  --expect-revision 8 \
  --confirm-data-loss
```

命令支持 open 或 archived task，并在改写前将完整 task 目录复制到 `.latch/archive/v3-backup/<task-id>-<utc-ts>/`。主 `task.json` 投影为 schema 2，主 `events.jsonl` 只保留 v2 event 并将 revision 重写为 `1..n`；`state.json` 不改写。失败时保留 `.latch` 和已创建的 backup。

## 并发与文件

- task：`.latch/tasks/<task-id>/task.json`；
- event：`.latch/tasks/<task-id>/events.jsonl`；
- actor current：`.latch/state.json`；
- archive：`.latch/archive/YYYY-MM/<task-id>/`。

所有 task 更新需要 `--expect-revision`。task 使用独立短锁；需要组合锁时顺序固定为 `task -> state`。Latch 不跟踪 task 的文件归属，验证命令针对整个 worktree；需要代码隔离时由用户使用外部 Git worktree，Latch 不负责创建或合并它。

## 最终契约部分实现边界

C1–C6 已部分实现。C1–C3 的 session writer、Light 证明包与 Group 最小集已接入真实 schema 3 task；C4 提供独立于 task schema 的 Git 知识文档 freshness 只读检查；C5 提供受预算 Context pack 与 benchmark diagnostic；C6 提供 legacy claim/patch 升级与 R2 回退。

Group 只聚合 task，不增加 group phase、revision、锁或完成门禁。schema 3 task 可使用 `save --group` 或 `save --clear-group` 修改单张 task；`list --group [--include-archive]` 返回精确匹配的成员与派生计数，`context` 只附带受限的 sibling 摘要。Group 变更不会修改 plan、work basis、verification 或 submission。

知识文档使用 YAML frontmatter 的 `covers`、`status`、`last_fingerprint` 与 `last_fingerprint_algo` 判定 freshness：

```bash
latch knowledge fingerprint --path docs/modules/example.md --json
latch knowledge check --path docs/modules/example.md --json
latch knowledge check --task <task-id> --json
```

`fingerprint` 只计算 `sha256-v1`；`check --path` 返回 `fresh`、`stale`、`baseline_missing`、`error` 或 `retired`；`check --task` 只检查当前 submission 中 `knowledge_impact.updated` 引用的 artifact。三种调用都不写知识文档、task、events 或 state。baseline 只能由已授权的普通文档编辑更新，freshness 结果不增加 submit、done 或 group 门禁。

Context pack 与 benchmark 使用结构化 JSON 输入：

```bash
latch context pack --input-file context-request.json
latch benchmark context --case-file case.json --run-file run.json --json
latch benchmark context --case-file case.json --run-file run.json \
  --baseline-run-file broad.json --json
```

`context-request.json` 可包含 `task_id`、`knowledge_paths`、map/excerpt/expand `sources` 和上次返回的 orientation 计数。CLI 按 task、knowledge、map、sibling、excerpt、expand 排序，默认限制 task 4000、知识/地图/兄弟累计 6000、单包 24000、扩读单批 8000、同 orientation 累计 48000 Unicode code points；`meta.char_count` 统计最终 JSON 和尾部换行。orientation 只由调用方回传，不写 `.latch`；换 task、开始实施或结束 orientation 时丢弃旧计数。

`benchmark context` 只校验 case/run 并计算主成功和 30% 次目标，不执行检索、CodeGraph 或模型判断，也不成为 task gate。

schema 3 event 文件允许可选的首行 `events_meta`；未知 v3 event 会被跳过并以 `warnings` 返回，schema 2 reader 仍对未知 event fail closed。schema 3 的 `min_cli_version` 为 `0.2.0`。

全面 current 切换仍未发布；`docs/INDEX.md`、显式 Latch 入口和本手册其余 v2 基础契约保持不变。
