# Latch v2 接入状态

## 当前兼容矩阵

| 项目 | 当前状态 | 第一阶段动作 |
|---|---|---|
| Latch | v2 源码完成，等待集成验收 | 只修改本 repo |
| Latch-Board | v1 数据模型 | 不修改 |
| appearance-sec | v1 `.latch` 和项目规则 | 不修改 |
| monitoring | v1 `.latch` 和项目规则 | 不修改 |

## 第二阶段

第一阶段通过用户 review 后，按以下顺序单独授权：

1. 备份三个 repo 的 v1 `.latch`，记录全局 CLI、skill 和 Board 来源；
2. 切换全局 CLI 与 canonical skill 链接；
3. 更新 Latch-Board；
4. 分别更新 appearance-sec 和 monitoring；
5. 累计完成 10 张真实 v2 task 后再决定是否删除 v1 备份。

任何外部 repo 修改都需要单独 task 和用户授权。
