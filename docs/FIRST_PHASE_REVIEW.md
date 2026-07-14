# Latch v2 第一阶段验收

> 本页记录第一阶段验收时的事实，不代表当前全局安装和接入状态。当前状态见
> [Latch v2 接入状态](ADOPTER_SYNC.md)。

## 结果

Latch repo 内的 v2 runtime、文档、canonical skill 和正式 CLI 入口已完成。第一阶段没有切换真实全局 CLI/skill，也没有修改外部 repo。

## 命令

```text
init checkpoint use list context save approve verify submit done abandon
```

已删除的 v1 能力包括 `start`、通用阶段推进、聊天日志、knowledge、owner/force、自动 notes scaffold 和 v1 schema fallback。

## 数据

- task 当前事实：`.latch/tasks/<id>/task.json`；
- 历史：`events.jsonl`；
- actor current：`.latch/state.json`；
- 归档：`.latch/archive/YYYY-MM/<id>/`；
- Board fixture：`tests/fixtures/context-v2.json`。

## 验收

- 完整正式 CLI 流程：批准、gate、submit、review correction、重新验证、再次提交、done；
- 并发批准、占用、blocked、revision conflict、root 发现和 warning 由契约测试覆盖；
- current 文档、canonical skill、链接脚本和 JSON fixture 由 guard 覆盖；
- `pnpm check`、集成 smoke 和 `git diff --check` 作为发布前门禁。

## 第二阶段前置条件

1. 记录并备份当前 pnpm link、v1 CLI、skill、Board 和三个项目的 `.latch`；
2. 明确回退命令；
3. 获得单独授权后切换全局 CLI 与 skill；
4. 之后分别授权 Latch-Board、appearance-sec 和 monitoring。

当前全局 `latch` 仍保持 v1 构建。
