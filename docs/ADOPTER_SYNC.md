# Latch 接入项目同步记录

本文件只记录“会影响已接入项目如何使用 Latch”的变更，不记录 Latch 内部重构。

当前只跟踪这 3 个项目：

- `appearance-sec`
- `monitoring`
- `Locus`

## 什么时候要记一笔

只有命中下面任一项才记录：

1. 命令用法变了。
2. AI 接入规则变了。
3. 项目模板变了，例如 `AGENTS.md`、项目内 `latch` skill、安装入口。
4. 本地产物目录或忽略规则变了，例如 `.latch/`。

没命中就不记，也不需要同步这 3 个项目。

## 判断句

每次改完先问一句：

```text
这次改动会不会让接入项目继续按旧规则使用时，出现用错命令、走错流程或写死本机路径？
```

- 不会：记 `接入同步：无`
- 会：记 `接入同步：需要`，并补下面的同步表

## 同步表

| 日期 | 变更 | 需要同步的项目 | 要改什么 |
| --- | --- | --- | --- |
| 2026-07-01 | 初次统一接入全局 `latch` 命令、新增“Latch 自身接入反馈”触发、明确 `verify -> finish -> 用户确认后 done` 收尾流程；`Locus` 补 `.latch/` 忽略规则 | `appearance-sec`、`monitoring`、`Locus` | 三个项目补 Latch 触发和收尾口径；`monitoring/CLAUDE.md` 去掉本机绝对路径，改用通用 `latch ...`；`Locus/.gitignore` 加 `.latch/` |
| 2026-07-02 | AI 默认续接入口改为 `latch context --json`；`command not found: latch` fallback 改为 `zsh -ic 'latch context --json'`；项目内 Latch skill 副本压成薄入口 | `appearance-sec`、`monitoring`、`Locus` | `appearance-sec/AGENTS.md` 和 `.agents/skills/latch/SKILL.md` 同步入口；`monitoring/AGENTS.md`、`CLAUDE.md` 和 `.agents/skills/latch/SKILL.md` 同步入口；`Locus/AGENTS.md` 同步入口 |
| 2026-07-03 | `command not found: latch` fallback 改为 `zsh -ic 'latch --help'`，避免用 `context --json` 在未初始化目录创建 `.latch/` | `appearance-sec`、`monitoring`、`Locus` | 同步 AGENTS/CLAUDE/项目内 skill 里的 fallback 命令；AI 默认续接入口仍是 `latch context --json` |

## 每次任务收尾怎么写

任务 closure 里只补一行，不展开：

```text
接入同步：无
```

或：

```text
接入同步：需要，见 docs/ADOPTER_SYNC.md
```

## 这 3 个项目当前对齐点

### appearance-sec

- `AGENTS.md` 已包含：
  - AI 续接入口 -> `latch context --json`
  - `command not found: latch` -> `zsh -ic 'latch --help'`
  - Latch 自身接入反馈先 `checkpoint`
  - `verify -> latch next -> finish closure -> 用户确认后 done`
- `.agents/skills/latch/SKILL.md` 已压成薄入口

### monitoring

- `AGENTS.md` 已包含：
  - AI 续接入口 -> `latch context --json`
  - `command not found: latch` -> `zsh -ic 'latch --help'`
  - Latch 自身接入反馈先 `checkpoint`
  - `verify -> latch next -> finish closure -> 用户确认后 done`
- `CLAUDE.md` 已改为通用 `latch ...`，不再写本机绝对路径
- `.agents/skills/latch/SKILL.md` 已压成薄入口

### Locus

- `AGENTS.md` 已包含：
  - AI 续接入口 -> `latch context --json`
  - `command not found: latch` -> `zsh -ic 'latch --help'`
  - Latch 自身接入反馈先 `checkpoint`
- `.gitignore` 已忽略 `.latch/`
