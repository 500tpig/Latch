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

如果 `latch` 报 `command not found`，先判断是不是 AI 工具使用了非交互 shell。可以尝试：

```bash
zsh -ic 'latch --help'
```

请求本身是在排查 `latch` 命令可用性、fallback 或 AI 接入时，这属于 Latch 自身反馈：先 `latch checkpoint` 再动手改环境或文档，不要当成小环境修直接改 shell 配置。

如果交互 zsh 能找到 `latch`，说明是当前执行环境没有加载用户的 PATH，不要误判为 Latch 未安装。如果仍不可用，停止安装流程，提示用户先完成全局安装或链接。不要把本机绝对路径写进目标项目文档、`AGENTS.md` 或 skill。

确认命令可用后，在已接入项目中允许执行的轻量命令：

```bash
git status --short
latch --help
latch context --json
latch context <task-id> --json
latch resume --brief
latch resume --brief --task <task-id>
```

如果 `context --json` 显示已有 current task，AI 必须先判断是不是同一件事：

- 同一件事续接：继续用 `save`、`next`、`verify`，或不带标题的 `checkpoint` 补字段。
- 另一件新事：必须用 `latch checkpoint --new "<title>" ...`，不能在有 current task 时带标题直接跑 `checkpoint`。

旧任务一旦被误记污染，先把新问题切到新的 task；旧任务只补污染说明和新 task ID，不继续混写。

如果用户已经明确指定 task ID，先用 `latch context <task-id> --json` 或 `latch resume --brief --task <task-id>` 读取现场；`<task-id>` 可以是完整 ID，也可以是唯一前缀。不要因为当前 actor 没有 current task，就先新开 `checkpoint`。

进入 `finish` 后，推荐用一条命令补收尾：`latch finish --changes "..." --verified "..." --unverified "..." --followup "..." --knowledge skip --knowledge-reason "..."`。只有用户确认后才执行 `latch done`。

Latch 的写命令（`checkpoint`、`save`、`finish`、`next`、`verify`、`done`、`abandon`、`use --force`）按串行调用设计。不要并行执行多个写命令，否则会撞 `.latch/.lock`。

多 agent 场景下，接入方应给每个 agent 提供稳定的 `LATCH_ACTOR`。如果没显式设置，Latch 会退回到当前线程 ID（例如 Codex 的 `CODEX_THREAD_ID`）。不要让多个并发 agent 共用同一个 `LATCH_ACTOR`。

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
是否需要为当前项目生成 AGENTS.md 规则草稿？我只读取项目事实，推断项留空并等用户确认。
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

优先使用全局 skill，例如：

```text
~/.codex/skills/latch/SKILL.md
~/.agents/skills/latch/SKILL.md
```

全局 skill 适合个人多项目共用，更新一次即可影响后续会话。项目内 skill 副本只在需要把某个项目固定在特定 Latch 规则版本时使用。

安装最后询问用户是否需要写入目标项目的 skill 副本，例如：

```text
是否需要写入 .agents/skills/latch/SKILL.md 或 .opencode/skills/latch/SKILL.md？
```

不默认创建项目内 skill 副本。用户确认后，只写用户当前使用的工具对应目录。

## 禁止事项

- 不写入本机绝对路径。
- 不自动扫描项目并推断风险域。
- 不自动总结项目规则。
- 不自动生成项目专属 skill。
- 不运行重型验证命令。
- 不使用 `git add .`。
