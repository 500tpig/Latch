# Latch CLI 0.6 / schema 5 接入状态

本页区分 Latch repo 的 CLI `0.6.0` / JSON envelope 3 / schema 5 current release 与
外部 adopter rollout。Latch repo 已进入 current；Latch-Board 已完成独立 reader-v3
rollout，monitoring 与 appearance-sec 仍保持 `pending`。

## 当前矩阵

截至 2026 年 8 月 14 日：

| 项目 | 状态 | 当前证据 | 独立后续 |
|---|---|---|---|
| Latch | CLI `0.6.0` / envelope 3 / schema 5 current | envelope 3 producer commit `0c94c8c`；gate bounded output commit `502a489`；Agent 常驻指令与 CLI 帮助收口 commit `c754150`（当前 HEAD） | 本仓 current 不证明全局 `latch` 链接或 canonical Skill 已传播到其它 repo |
| Latch-Board | reader-v3 rollout 已完成 | 独立 task `20260814023156010-将-latch-board-一次性切换到-envelope-3-reader-v-5fb1b3` 已在 revision 15 以 `done` 归档；Git commit `b6d2476` | 107 项测试、生产构建和真实 reader-v3 流程已通过；未启动浏览器或 dev server，Browser UI 验收未执行 |
| monitoring | pending | 本次未读取或修改该 repo，也未迁移其 historical task | 独立 Standard task 核对 CLI/Skill 安装、schema 5 新 task 与 historical read-only 展示 |
| appearance-sec | pending | 本次未读取或修改该 repo，也未创建 adopter task | 独立 Standard task 核对 CLI/Skill 安装、schema 5 新 task 与空状态流程 |

本矩阵不表示全局 CLI 已重新链接、canonical Skill 已完成安装传播、Board Browser UI
已验收或全面 rollout 已完成。只读核验还发现，Board commit `b6d2476` 的 `README.md`
顶部仍有一处将 CLI envelope 写为 `schema_version: 2`；该残留文案与已交付的
reader-v3 实现、测试及同文件后文不一致，本次不修改 Board repo。

## Current schema 边界

- 当前 package / CLI 为 `0.6.0`，CLI JSON envelope 使用 `schema_version: 3`；
- 新 task 使用 `schema_version: 5` 和 `min_writer_version: "0.5.0"`，schema 5 是
  唯一 current writer；
- adopter reader-v3 将 schema 3/4 作为 historical read-only，将 schema 2 作为
  `legacy unsupported`；
- event 文件继续使用 `events_schema_version: 3`，该字段不是 writer lock；
- current reader contract 不提供 envelope fallback、双读或迁移路径，也不重写
  historical archive。

## Reader contract

Latch-Board 与其它 reader-v3 adopter 以
`tests/fixtures/context-v5-board-reader.json` 和
`tests/fixtures/envelope-v3-mismatch.json` 作为冻结读取契约。两份 fixture 与
Latch-Board commit `b6d2476` 的 SHA-256 分别一致：

- `context-v5-board-reader.json`：
  `8f1d4112337a656c6be425a13623a48ab7faaf7cad79a6edc80d7ba84c6d554e`；
- `envelope-v3-mismatch.json`：
  `3c831590bd88a8b98f19048482529a192fc5dda69ff974aacd3085aa24ff2224`。

reader-v3 只接受 CLI `0.6.x` / envelope 3，CLI `0.5.x` / envelope 2 必须 fail
closed；不得保留 envelope 2 parser、字段探测、双读或 fallback。`next_action` 只接受
以下 typed object：

- `command`：单一可执行 CLI primitive，可按契约携带 mode；
- `await_user`：标明用户输入边界与原因；
- `stop`：标明只读、阻塞或不可继续的稳定原因。

冻结契约覆盖：

- open、review 与 archived schema 5 view；
- bounded `unverified_items` 与 resolution sample，默认 sample limit 为 8；
- `reviewer_next_action`、确定性 timeline 标题、影响和下一步；
- `resolved`、`accepted_risk`、`followup` 三种 closeout outcome；
- mixed resolution、额外 follow-up 和没有 follow-up 的归档；
- schema 3/4 historical archive 的 `historical_schema: true` 与原字符串投影；
- envelope 3 writer mismatch、phase legality 与 typed `next_action` mismatch。

fixture 不包含本机绝对路径、聊天内容、凭据或外部 repo 状态。reader 不得从 event
重建 submission 或 closure，不得把 schema 2 当作兼容输入，也不得把 fixture 当作
Board 写入授权。

## Adopter 阻断条件

每个外部 repo 的 rollout 必须使用独立 task，并至少满足：

1. 明确批准该 repo 的 workspace scope、reader/UI 影响和验收路径；
2. 使用两份冻结 fixture 更新并验证 envelope、open、review、archive 与 historical
   read-only 读取；
3. schema 5 未知字段按单 task 隔离，不影响同一数据源的其它可读 task；
4. 不直接写 `.latch/tasks/*/task.json`，不迁移或重写 historical archive；
5. 需要更新全局 CLI 或 canonical Skill 链接时，取得单独安装授权；
6. 完成目标 repo 批准计划内的测试、构建和真实流程验收；未运行的 Browser UI 验收
   必须明确记录，不得写成已完成；
7. 单独完成目标 repo 的 review 与 Git delivery。

任一适用条件未满足时，该 adopter 保持 `pending`。Latch current task 不自动创建
adopter task，也不把外部验收写成已完成事实。

## 全面 rollout 完成条件

只有 Latch-Board、monitoring 与 appearance-sec 的独立 task 均完成 review acceptance
和 Git delivery，并核对安装传播状态后，才能通过新的 Latch task 将全面 rollout 状态
改为完成。当前只有 Latch-Board 满足独立 task 归档与 Git delivery；monitoring、
appearance-sec 和安装传播核验仍未完成。

## Historical evidence

schema 4 接入证据继续保留用于追溯：Latch commit `1337ad0`、Latch-Board commit
`10569dd`，以及更早的 v2 接入 commits `cd52f2d`、`d41ada8`、`9bd4272`、
`ee66345`。这些事实不证明当前全面 rollout 已完成，也不授权修改对应 repo。
