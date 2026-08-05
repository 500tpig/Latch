# Latch Agent 使用反馈协议

本页定义 AI Agent 使用 Latch 后的定性反馈协议。反馈只在用户明确要求时写入，
并且必须包含可核对证据。默认流程不读取、不生成、不保存此类反馈。

## 目的与非目标

本协议用于记录 AI Agent 在真实任务中使用 Latch 时遇到的具体摩擦、有效机制和改进
建议。每条反馈需要把可核对事实与产品主张分开，供后续人工汇总和产品决策使用。

本协议不用于：

- 评价单张 task 的交付质量；
- 代替 Schema 5 或 v2 观察期的定量样本；
- 保存聊天记录、情绪表达或无证据印象；
- 自动生成产品 backlog；
- 直接授权修改 CLI、Core、Board、Skill 或其它 repo。

## 与 Schema 5 / v2 观察期的边界

两类材料使用不同来源和落点，不得混表：

| 材料 | 证据来源 | 落点 | 用途 |
|---|---|---|---|
| Schema 5 / v2 观察样本 | 授权 repo 的 archive `task.json` 与 `events.jsonl` | [OBSERVATION.md](OBSERVATION.md) 定义的只读评估流程 | 固定样本的定量观察 |
| Agent 使用反馈 | 用户点名后读取的当前任务事实、命令结果或文件现象 | Project Record「Agent 使用反馈」 | 记录真实体感与改进建议 |

Agent 使用反馈不得写入 `docs/OBSERVATION.md`，也不得被描述为观察期的定量结论。
观察期检查不得反向读取反馈 Record 作为样本证据。

## 触发条件（opt-in only）

默认不执行反馈流程。以下时机均不得自动读取或写入反馈：

- `submit`、`done` 或会话结束；
- 一次 Latch 使用完成后；
- AI 总结工作、复盘任务或提出下一步时。

只有用户明确表达记录意图时才执行，例如：

- 「记一条 Latch Agent 反馈」；
- 「写使用感受」或「写使用问题」；
- 「按 Agent 反馈协议追加」；
- 「把这次摩擦记进反馈 Record」。

「Latch 还行吧」等模糊闲聊不构成写入授权。需要落盘时，先询问是否写入。用户未
点名时，应当视为不存在这项能力，不把「总结使用感受」加入默认收尾。

## 落点

所有 AI Agent 共用同一份协议和同一条 Project Record，不创建私有副本。

- Record 标题：`Agent 使用反馈`
- Record ID：`rec_cdc0b9ff-c87b-437a-a76e-563f119950d0`
- 标签：`agent-feedback`

读取前先按标题查重，再使用固定 ID 读取正文：

```bash
node dist/cli.js record list --query "Agent 使用反馈" --status active --json
node dist/cli.js record show rec_cdc0b9ff-c87b-437a-a76e-563f119950d0 --json
```

追加前，将去重并合并后的**完整正文**保存到当前项目内的临时文件，再使用 `show`
返回的当前 `revision` 整段替换：

```bash
node dist/cli.js record edit rec_cdc0b9ff-c87b-437a-a76e-563f119950d0 \
  --expect-revision <revision> \
  --body-file .latch/record-body.md \
  --json
```

不得根据过期 revision 自动重试。出现 revision conflict 时，重新读取正文、再次去重，
再等待当前写入请求内的明确判断。固定 ID 未找到、Record 已归档或出现多个同名候选时，
停止写入并报告状态，不静默新建另一条流水。

## 证据门槛与 confidence

每条反馈必须包含以下字段：

- `scenario`：发生问题或形成判断的任务场景；
- `evidence`：至少包含一种可核对证据；
  - `task_id`；或
  - `command` 与结果要点；或
  - `path` 与文件现象；
- `observation`：证据直接支持的事实，不混入建议；
- `claim`：建议增加、删除、简化或保持的机制；
- `action`：`add`、`remove`、`simplify`、`keep` 或 `unknown`；
- `confidence`：`lived`、`user_stated` 或 `inferred`；
- `severity`：`P0`、`P1` 或 `P2`；
- `agent`、`repo` 和 `date`。

`confidence` 的含义：

- `lived`：当前 AI Agent 在本会话中亲历，且能给出本会话证据；
- `user_stated`：忠实记录用户明确陈述，不把用户原话改写成 Agent 亲历；
- `inferred`：从现有证据推断，必须明确标为推断，不得补写不存在的事实。

`severity` 用于汇总排序：`P0` 表示阻断正常使用、造成数据或授权风险；`P1` 表示会
反复造成明显返工或误用；`P2` 表示局部摩擦、可理解性或便利性问题。证据不足时拒绝
写入，并说明缺少 `task_id`、命令结果或路径现象中的哪一项，不得用 `unknown` 代替证据。

## 条目 Markdown 模板

未使用的 `evidence` 子项应删除。`command` 需要同时写明结果要点，`path` 需要同时写明
可核对现象。

```markdown
### YYYY-MM-DD · <短标题>

- agent: grok | codex | …
- repo: <path or name>
- scenario: <一句话>
- confidence: lived | user_stated | inferred
- evidence:
  - task_id: …
  - command: <命令；结果要点>
  - path: <路径；可核对现象>
- observation: <可核对事实>
- claim: <应增加、删除、简化或保持什么>
- action: add | remove | simplify | keep | unknown
- severity: P0 | P1 | P2
- related_observation_sample: none
```

`related_observation_sample` 固定为 `none`。该字段用于显式声明反馈没有进入观察期样本，
不得改成 archive task 关联或统计编号。

## 去重规则

每次写入前必须读取 Record 的当前完整正文，并按以下顺序检查：

1. 比较机制、`claim` 与 `action`，确认是否属于同一问题；
2. 同一主张已有条目时，在原条目中补充新证据或收紧表述，不新增重复标题；
3. 新证据不支持原主张时，不提高 `severity` 或 `confidence`；
4. `inferred` 只有取得新的直接证据后才能改为 `lived` 或 `user_stated`；
5. 同一场景但主张不同，或同一主张涉及不同机制时，可以分别记录。

合并时保留可核对的原证据，不用概括性判断覆盖历史事实。无法判断是否重复时，先向
用户说明候选条目，不直接追加。

## 给 AI 的固定提示词

### A. 用户点名「记反馈」时

```text
用户已明确要求记录 Agent 使用反馈。
1. 读取 docs/AGENT_FEEDBACK.md 与 Record「Agent 使用反馈」。
2. 去重：已有同类 claim 则合并/更新，不重复堆。
3. 按模板追加一条；evidence 至少含 task_id 或 command 或 path；否则拒绝写入并说明缺什么。
4. confidence 仅 lived / user_stated / inferred（推断必须标明）。
5. 禁止写入 OBSERVATION.md；禁止改 CLI/Core/Board；禁止 Git commit（除非用户另授）。
6. 写完用三句话向用户复述：问题、证据、提案。
若用户未明确要求反馈：禁止执行本流程。
```

## 周期性汇总提示词

汇总不是定时任务，也不是默认维护步骤。只有用户明确点名「汇总改进」或表达同等意图
时，才运行以下提示词：

### B. 用户点名「汇总改进」时

```text
用户已明确要求汇总 Agent 反馈。
读取 Record「Agent 使用反馈」与 docs/AGENT_FEEDBACK.md。
仅使用 confidence 为 lived 或 user_stated 的条目，按 severity 输出：
删除/不做、简化、新增、需更多证据。
每条必须回指原反馈标题与 evidence；禁止引入无证据新槽点。
不要直接改代码。
```

汇总结果默认只回复当前请求，不自动写回 Record、不创建 task、不修改产品。需要保存汇总
或转成实施 task 时，必须取得对应的显式授权并分别遵守 Record 或 Latch task 规则。

## 不要做的事

- 不在用户未点名时读取、生成或写入反馈；
- 不把反馈作为 `submit`、`done`、会话结束或 Latch 使用后的默认步骤；
- 不写无证据的「体验很好」「体验不好」或「建议全面重构」；
- 不把聊天情绪写成观察期定量结论，不修改 `docs/OBSERVATION.md`；
- 不创建 CLI 子命令、后台监控、数据库、跨 repo 台账或 Board 页面；
- 不为统计制造 task，不读取其它会话或未授权 repo 作为证据；
- 不为不同 AI 创建多份协议或多条同名 Record；
- 不在反馈流程中修改 CLI、Core、Board 或 Skill；
- 不执行 Git add、commit、push、branch、checkout、reset 或 clean，除非用户另行授权。
