# Latch 项目规则

Latch 是任务状态锁存器。小请求不走 Latch；任务变长或碰风险域时进入，跨会话能续上。

## 何时进入 Latch

先查这条硬触发，优先于下面的「小请求不走 Latch」：当前项目接了 Latch，且请求涉及 AI 接入 Latch、记录缺失或 Latch 流程没走起来——属于 Latch 流程反馈。一旦命中，先用 `latch list --json --brief` 查 open task；有同题任务就续接，确实没有才 `latch checkpoint`，不得当成小修直接动手。

小请求不走 Latch：单点文案、简单样式、只读解释、低风险单点修复。

出现以下任一情况，先调用 Latch skill，并进入或续接 Latch 任务：

1. 风险域：登录、权限、路由、认证、状态流、持久化存储、接口契约、跨模块职责、数据迁移、难回退 UI 或交互流程。
2. 任务形态（可自查）：需要复现 bug、需要跨会话续接、方案讨论后再实现。
3. 规划类请求：规划项目后续、完善项目、讨论路线图、先讨论怎么推进。
4. 用户显式要求：走 Latch、记录任务、可追溯、收尾归档。
5. Latch 流程反馈：AI 接入 Latch、记录规则漏触发，或用户指出「这应该被记录」。

Latch 的阶段、模板、验证和收尾流程以 Latch skill 与 CLI 为准。本文件只负责触发，不承载流程。

## 新能力判断

提出新 CLI 能力、项目规则生成、扫描项目、自动写文件或接入外部系统前，必须先给出判断依据，不允许只顺着外部建议或上轮说法改口。

每个建议至少回答四件事：

1. 依据来自代码、文档、真实使用，还是推测。
2. 是否扩大 Latch 的职责；如果扩大，为什么必须由 Latch 做。
3. 如果判断错了，回退成本是什么。
4. 有没有更小的替代方案，例如只改文档、模板或手册。

证据不足时，默认只做低风险文档或模板；`doctor`、`init-agent`、项目扫描、规则生成、skill 生成等能力不得直接排期。

新增 CLI 命令、数据目录、真源格式、生成时机或职责边界后，收尾前必须检查 `docs/`、`README.md`、`AGENTS.md` 和技能文档里是否还有旧口径；至少用一次 `rg` 搜相关关键词，只改命中的相关段落，不全文重写。

## 代码检索默认

- 明确标识符、函数名、事件名、文件名片段、配置 key、路由 path、API 名称：先用 `rg` / `rg --files`。
- 业务语义、跨模块概念、字段配置、状态恢复、搜索条件构建、中文自然语言描述：用 `semble search "<query>" . --top-k 8`。
- 调用链、影响面、依赖关系、谁调用谁、symbol source：仓库有 `.codegraph/` 时用 `codegraph explore "<query>"`。
- 不默认用 MCP 做代码检索。
- 先搜，再只读 Top 1-3 个相关文件或符号范围；不要先翻大目录或长文件。

新开 Latch 任务前，先用 `latch list --json --brief` 查 open task，避免同题重复记录。续接已有 Latch 任务时，再用 `latch context --json --brief` 判断当前 task 是否同一件事；需要完整字段时再用 `latch context --json`。同题续接才继续当前 task；换题必须 `latch checkpoint --new "<标题>" ...`。有 current task 时，带标题的 `checkpoint` 不能当作补记旧任务使用。旧任务若已被误记污染，只补污染说明和新 task ID，不继续混写。

如果用户已经明确点名某张 task，先用 `latch context <id> --json --brief` 或 `latch resume --brief --task <id>` 读取，不要因为当前 actor 没有 current task 就先新开任务。`latch` 的写命令按串行使用，不并行跑多个 `checkpoint`、`save`、`next`、`verify`、`done`、`abandon` 或 `use --force`。

用户要求收尾、提交、结束或归档时，先用 `latch list --json --brief` 看全局 open task：当前 actor 已满足门禁的 `finish` task 等用户确认后归档；非当前 owner 已满足门禁的 `finish` task 先提示用户决定是否 `--force` 归档；非 `finish` 的 open task 先提示保留或 `abandon`。验证通过后优先用 `latch finish --changes "..." --verified "..." --unverified "..." --followup "..."` 补 closure；knowledge 默认 skip，需要沉淀规则时显式加 `--knowledge generate --knowledge-reason "..."`。只有判断为 `generate` 的任务，才要求真正执行 `latch knowledge generate` 后再 `done`。

不要把 `task.json`、`notes.md` 或知识卡当成 PRD。中等功能额外写 `docs/briefs/YYYY-MM-DD-<slug>.md`，大需求额外写 `docs/prd/YYYY-MM-DD-<slug>.md`；小任务只用 `latch log` 或 Latch 任务记录，不写 brief/PRD。
