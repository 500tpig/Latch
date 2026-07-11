# Latch v2 本机安装

Latch v2 面向个人 macOS 开发环境。当前第一阶段不执行本页命令；只有用户明确批准第二阶段切换后才操作全局环境。

## 前置记录

切换前记录：

- 当前全局 `latch` 的实际路径和链接目标；
- 可恢复的 v1 commit 或构建目录；
- 两个全局 skill 路径和目标；
- Latch-Board 当前 commit；
- 各接入项目 `.latch` 的备份位置与校验结果。

任一来源或恢复步骤不明确时停止切换。

## 构建 CLI

```bash
pnpm install
pnpm check
pnpm build
```

package bin 指向 `dist/cli.js`。本机可以使用 pnpm link，但应先确认现有全局命令是否已经链接到当前 repo；repo 构建会立即影响这种链接。

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

v2 不迁移 v1。已有 `.latch` 时先备份并确认恢复方法，再删除或移动旧目录，最后执行：

```bash
latch init
```

业务项目的 AGENTS 只保留显式 Latch 入口、全局 skill 使用方式和项目自身验证规则。

## 回退

按切换的相反顺序恢复：

1. 业务项目 `.latch`；
2. Latch-Board；
3. 全局 skill 链接；
4. 全局 CLI。

回退不依赖 v2 migration。
