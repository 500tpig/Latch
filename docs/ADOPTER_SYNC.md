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
| 2026-07-01 | 接入规则统一改为优先使用全局 `latch` 命令；`command not found: latch` 时先试 `zsh -ic 'latch resume --brief'`；新增“Latch 自身接入反馈”触发；`verify` 通过后先 `latch next` 进入 `finish`，补 closure，再等用户确认 `latch done`；`Locus` 补 `.latch/` 忽略规则 | `appearance-sec`、`monitoring`、`Locus` | `appearance-sec/AGENTS.md` 补触发和收尾口径；`monitoring/AGENTS.md` 补触发和收尾口径；`monitoring/CLAUDE.md` 去掉 `/Users/.../dist/cli.js` 绝对路径，改用 `latch ...`；`Locus/AGENTS.md` 补 `resume --brief`、fallback 和“先 checkpoint 再排查”；`Locus/.gitignore` 加 `.latch/` |

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
  - `command not found: latch` -> `zsh -ic 'latch resume --brief'`
  - Latch 自身接入反馈先 `checkpoint`
  - `verify -> latch next -> finish closure -> 用户确认后 done`

### monitoring

- `AGENTS.md` 已包含：
  - `command not found: latch` -> `zsh -ic 'latch resume --brief'`
  - Latch 自身接入反馈先 `checkpoint`
  - `verify -> latch next -> finish closure -> 用户确认后 done`
- `CLAUDE.md` 已改为通用 `latch ...`，不再写本机绝对路径

### Locus

- `AGENTS.md` 已包含：
  - `latch resume --brief`
  - `command not found: latch` -> `zsh -ic 'latch resume --brief'`
  - Latch 自身接入反馈先 `checkpoint`
- `.gitignore` 已忽略 `.latch/`
