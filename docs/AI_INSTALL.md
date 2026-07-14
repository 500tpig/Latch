# Latch v2 本机安装

Latch v2 面向个人 macOS 开发环境。当前全局 CLI 已使用 v2 构建，两个
全局 skill 均链接到本 repo 的 canonical source。v1 备份在观察期结束前继续保留。

## 检查当前安装

检查全局命令：

```bash
command -v latch
latch --help
pnpm list --global --depth -1
```

在 Latch 源码 repo 检查 canonical skill 链接：

```bash
pnpm skill:check
```

`latch --help` 应只显示 v2 命令。接入状态与来源 commit 见
[接入状态](ADOPTER_SYNC.md)。

## 构建 CLI

```bash
pnpm install
pnpm check
pnpm build
```

package bin 指向 `dist/cli.js`。当前全局 package 通过 pnpm link 指向本 repo，
因此重新构建会直接影响全局命令。重新链接前先记录现有来源；确认需要切换后，
在源码 repo 执行：

```bash
pnpm link --global
```

## 链接 canonical skill

canonical source：

```text
skills/latch/SKILL.md
```

检查目标：

```bash
pnpm skill:check
```

创建或更新链接：

```bash
pnpm skill:link
```

目标为：

```text
~/.codex/skills/latch
~/.agents/skills/latch
```

链接脚本只管理符号链接，不复制文档快照。

## 初始化项目

新项目直接执行：

```bash
latch init
```

v2 不迁移 v1。已有 `.latch` 时，先将原目录备份到 repo 外，记录来源和
checksum，确认恢复方法，再移走旧目录并执行 `latch init`。备份位置记录在
对应接入 task 中，不写入 current 文档。

业务项目的 AGENTS 只保留显式 Latch 入口、全局 skill 使用方式和项目自身验证规则。

## 备份保留

v1 CLI、skill、Board 基线和三个接入 repo 的 `.latch` 备份继续保留。满足以下
条件后，才能单独评估是否删除：

1. 第二阶段状态文档已经归档；
2. 已完成 10 张符合规则的真实 v2 task；
3. 观察期评估没有发现必须依赖 v1 恢复的问题；
4. 获得删除备份的单独明确授权。

观察规则见 [Latch v2 观察期](OBSERVATION.md)。

## 回退

回退前先停止新的 v2 task，并确认目标 repo 没有进行中的写操作。按切换的
相反顺序恢复：

1. 从已校验备份恢复业务项目 `.latch`；
2. 将 Latch-Board 恢复到记录的基线 commit；
3. 恢复两个全局 skill 的原链接或备份；
4. 恢复全局 v1 CLI 构建。

恢复后重新检查命令来源、skill 链接和项目状态。回退不依赖 v2 migration，
也不删除 v2 期间产生的归档证据。
