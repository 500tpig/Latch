# Latch AI 安装说明

本文件给安装 Latch 的 AI 使用。目标是在新项目中接入 Latch，并在用户确认后生成项目规则草稿。

## 前置检查

首次安装或本机开发安装：

```bash
pnpm build
pnpm add --global .
```

先确认全局命令可用：

```bash
latch
```

如果 `latch` 不可用，停止安装流程，提示用户先完成全局安装或链接。不要把本机绝对路径写进目标项目文档、`AGENTS.md` 或 skill。

允许执行的轻量命令：

```bash
git status --short
latch resume --brief
```

安装阶段不要自动执行目标项目的 `typecheck`、`test` 或 `build`。这些命令可能很慢、已有失败，或产生副作用。

## 更新全局命令

修改 Latch CLI 后，需要重新构建并更新本机全局命令：

```bash
pnpm build
pnpm add --global .
```

只修改文档、模板或 skill 时，不需要更新全局命令。

## 初始化 Latch

目标项目没有 `.latch/` 时，运行：

```bash
latch init
```

检查 `.latch/` 的提交策略。默认建议把 `.latch/` 加入 `.gitignore`，是否提交由用户决定。

## 生成项目规则草稿

安装结束前询问用户：

```text
是否需要为当前项目生成 AGENTS.md 规则草稿？我只读取项目事实，推断项留空并等你确认。
```

生成草稿时，使用 `docs/templates/PROJECT_AGENTS.md` 作为模板。

可以自动填写的事实：

- 包管理器。
- `package.json` scripts。
- 是否已有 `.latch/`。
- 是否已有 `AGENTS.md`。

必须留给用户确认的判断：

- 项目风险域。
- 验证命令是否可靠。
- 不要自动改动的目录或文件。
- 项目特殊收尾规则。

如果目标项目没有 `AGENTS.md`，可以在用户确认后创建草稿。

如果目标项目已有 `AGENTS.md`，不要直接覆盖或自动合并。给出完整 Markdown 段落作为 patch 建议，等待用户确认。

## Skill 副本

安装最后询问用户是否需要写入目标项目的 skill 副本，例如：

```text
是否需要写入 .agents/skills/latch/SKILL.md 或 .opencode/skills/latch/SKILL.md？
```

不默认创建 skill 副本。用户确认后，只写用户当前使用的工具对应目录。

## 禁止事项

- 不写入本机绝对路径。
- 不自动扫描项目并推断风险域。
- 不自动总结项目规则。
- 不自动生成项目专属 skill。
- 不运行重型验证命令。
- 不使用 `git add .`。
