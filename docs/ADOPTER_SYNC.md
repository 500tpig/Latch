# Latch 接入项目同步记录

本文件只记录“会影响已接入项目如何使用 Latch”的变更，不记录 Latch 内部重构。

当前只跟踪这 2 个项目：

- `appearance-sec`
- `monitoring`

## 什么时候要记一笔

只有命中下面任一项才记录：

1. 命令用法变了。
2. AI 接入规则变了。
3. 项目模板变了，例如 `AGENTS.md`、项目内 `latch` skill、安装入口。
4. 本地产物目录或忽略规则变了，例如 `.latch/`。

没命中就不记，也不需要同步这 2 个项目。

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
| 2026-07-03 | `command not found: latch` fallback 改为 `zsh -ic 'latch --help'`，避免用 `context --json` 在未初始化目录创建 `.latch/`；Latch 流程反馈和收尾前先用 `latch list --json` 查 open task | `appearance-sec`、`monitoring` | 同步 AGENTS/CLAUDE/项目内 skill 里的 fallback、查重和收尾前全局查看 open task 规则；AI 默认续接入口仍是 `latch context --json` |
| 2026-07-03 | `latch finish` 可在 `check` 且 verify pass 时直接进入 `finish`；`--followup` 同步 `next`；knowledge 默认 skip | `appearance-sec`、`monitoring` | 同步收尾路径为 `verify -> latch finish closure -> 用户确认后 done`；需要知识沉淀时再显式 `--knowledge generate` |
| 2026-07-04 | 新增 `latch list --json --brief` 和 `latch context --json --brief`；AI 默认入口改为 brief JSON；full JSON 保留完整字段 | `appearance-sec`、`monitoring` | 同步 AGENTS/CLAUDE/项目内 skill 里的默认入口；需要完整字段时再使用不带 `--brief` 的 JSON |
| 2026-07-04 | 文档明确 `verify` 不经过 shell；多 agent 并行时必须设置稳定 `LATCH_ACTOR`；`done` 的 closure 质量属于使用约定，不由 CLI 解析 | `appearance-sec`、`monitoring` | 同步 AGENTS/CLAUDE/项目内 skill 里的 verify 限制、`LATCH_ACTOR` 要求和收尾口径 |
| 2026-07-06 | 规划/复盘/路线讨论先完整探索问题面，再给最小下一步；全面梳理改为分层取证，避免默认读取完整 patch 或长文档；Claude Code 入口用 `CLAUDE.md` 导入 `AGENTS.md` | `appearance-sec`、`monitoring` | 同步 AGENTS/CLAUDE/项目内入口里的规划边界和分层取证规则；如目标项目使用 Claude Code，补 `CLAUDE.md` 薄入口 |
| 2026-07-07 | 全局 latch skill 补齐 docs 快照并移除不存在的 `docs/SPEC_V0.md` 引用；业务项目 Latch 段压成薄入口，完整流程回到全局 skill 和 Latch repo docs | `appearance-sec`、`monitoring` | 同步 AGENTS/CLAUDE 中的 Latch 入口；以后只有旧规则会导致用错命令、走错流程或写死路径时，才同步业务项目 |
| 2026-07-08 | 规划问答、外部建议取舍、用户确认只要影响范围、不做项、验收或下一步，就要补「讨论摘记」；小任务写 notes，中等任务写 brief 并挂 artifact | `appearance-sec`、`monitoring` | 同步 AGENTS 里的 Latch 入口说明；CLAUDE 继续通过 `@AGENTS.md` 继承，不单独加重复规则 |

## 每次任务收尾怎么写

任务 closure 里只补一行，不展开：

```text
接入同步：无
```

或：

```text
接入同步：需要，见 docs/ADOPTER_SYNC.md
```

## 这 2 个项目当前对齐点

### appearance-sec

- `AGENTS.md` 已包含：
  - AI 续接入口 -> `latch context --json --brief`
  - `command not found: latch` -> `zsh -ic 'latch --help'`
  - Latch 流程反馈先 `latch list --json --brief` 查重，再续接或 `checkpoint`
  - 多 AI 并行时设置稳定 `LATCH_ACTOR`
  - `latch verify -- <command>` 不经过 shell，复合命令拆成多次验证
  - 规划/复盘/路线讨论先完整探索问题面，再给最小下一步；全面梳理先分层取证
  - 关键规划问答和取舍要补「讨论摘记」；小任务写 notes，中等任务写 brief
  - `verify -> latch finish closure -> 用户确认后 done`
- `CLAUDE.md` 已用 `@AGENTS.md` 导入项目规则
- `.agents/skills/latch/SKILL.md` 已压成薄入口

### monitoring

- `AGENTS.md` 已包含：
  - AI 续接入口 -> `latch context --json --brief`
  - `command not found: latch` -> `zsh -ic 'latch --help'`
  - Latch 流程反馈先 `latch list --json --brief` 查重，再续接或 `checkpoint`
  - 多 AI 并行时设置稳定 `LATCH_ACTOR`
  - `latch verify -- <command>` 不经过 shell，复合命令拆成多次验证
  - 规划/复盘/路线讨论先完整探索问题面，再给最小下一步；全面梳理先分层取证
  - 关键规划问答和取舍要补「讨论摘记」；小任务写 notes，中等任务写 brief
  - `verify -> latch finish closure -> 用户确认后 done`
- `CLAUDE.md` 已改为通用 `latch ...`，不再写本机绝对路径，并已用 `@AGENTS.md` 导入项目规则
