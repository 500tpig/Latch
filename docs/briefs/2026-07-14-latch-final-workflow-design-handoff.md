# Latch 最终任务与知识流程设计交接

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

状态：工作交接，不是当前产品契约，不表示 plan 已批准。

## 新窗口提示词

```text
在 `/Users/johnsmith/Project/Study/Latch` 继续 Latch task
`20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1`。

先按仓库 `AGENTS.md` 执行 `git status --short`、`latch list --json --brief` 和
`latch context 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1 --json --brief`，
再读取 task artifacts、`docs/INDEX.md`、
`docs/briefs/2026-07-14-latch-final-workflow-design-handoff.md` 和当前 v2 PRD。

使用 `grill-with-docs`。当前目标不是维护现有 v2 的最小边界，而是反驳并重新设计一套最终可用的
Latch 流程。一次只讨论一个薄弱点；已在交接文档中标为稳定的决定不要重复询问，除非 repo 证据与其冲突。

task 当前处于 `plan`。不要 approve，不要修改产品代码，不要升级 CodeGraph，不要写入外部 repo，
不要执行 Git add、commit、push、merge、rebase 或 worktree 清理。工作区已有
`docs/HANDBOOK.md`、`src/core/task-view.ts` 和 `tests/cli-base.test.mjs` 的用户改动，必须保留。

使用者的真实工作方式是：bug 通常逐个发送给 AI，有时为不同 bug 打开多个独立对话，并可能把最终改动
拆成多个 Git commit。因此不能默认多个小 bug 会在同一对话一次性出现，也不能让多个对话无约束地共同
修改一张 task。

先读本文「最终流程总览（一页串起来）」恢复全局图，再按「总图上仍虚」清单逐项质询；
已标稳定的决定不要重复问。一次只问一个问题。保持 plan，不 approve、不改产品代码。
```

## 目标

Latch 的目标是提供一套个人使用的任务流程，同时满足以下要求：

- 保存需求、计划、批准、验证、反馈和修改理由，能够追溯当时为何这样改；
- 保存当前仍有效的模块知识，减少 AI 面对大型模块时重复阅读源码；
- 需求变化后能够识别旧决定和旧知识，不让历史事实覆盖当前事实；
- 日常操作足够轻，bookkeeping 主要由 AI 和 CLI 完成；
- 通过明确的上下文预算、来源和 freshness 检查减少 token，而不是承诺不读源码；
- 最终用户体验一次设计完整，不保留长期存在的临时版流程。

这里的「一步到位」指完整定义最终用户流程、数据边界、失败处理和验收标准。实施仍可分批验证，但每批都
服务同一份最终契约，不形成需要再次推翻的过渡产品。

## 用户补回的原始问题

用户补回的大段对话明确了以下问题来源：

> 目标是一个可追踪、能溯源，并且像 Trellis 一样的任务流程，但需要去掉不需要的繁重流程。

> `/Users/johnsmith/Project/work/appearance-sec/src/components/DataTableV2` 包含数万行代码，人工无法完整
> 阅读；AI 即使选择性阅读，也需要解释如何降低遗漏风险。

> 需求经常变化，同一功能可能先要求时间粒度，后来又取消；出现 bug 并重复排查后，容易失去「之前改了
> 什么、为什么这样改、为什么修改后出现 bug」的依据。

对话还提出了三个直接问题：

1. v2 为什么删除知识总结；
2. 知识总结能否降低 token，以及应如何生成和更新；
3. Withy、Aider repo map、QMD、GitNexus、Graphiti 等现有方案是否适合个人工具。

## 当前文档暴露的矛盾

### 长期知识只有存放位置，没有执行责任

`docs/ARTIFACTS.md` 规定长期资料进入 Git 文档，task 通过 artifact 引用文档；但当前 PRD 同时删除
knowledge、自动总结、文档生成和检索能力。现有规则没有回答以下问题：

- 谁判断一张 task 是否产生长期知识；
- 在 `submit`、`review` 还是 `done` 时更新；
- 文档过期后如何标记和恢复；
- 新会话如何快速找到正确章节；
- 没有更新知识时如何区分「确实没有影响」和「AI 漏做」。

### `.latch` 的删除语义写错

当前 PRD 的「`.latch` 可删除」不能作为日常规则。用户已经明确纠正：备份后删除重建只适用于已经发生
的 v1 到 v2 全量切换。日常 `.latch` 保存 task、events、actor current 和 archive，是持久历史真源。

### 显式创建规则把判断成本交给使用者

现有设计只有明确提到 Latch 才创建 task。该规则减少误创建，却造成反复询问「这次为什么没建 task」或
「这个任务应不应该创建」。单纯改全局提示词只能提醒 AI 询问，不能消除判断成本。

### 完整生命周期不适合每个小 bug

为每个一行修复重复执行 plan、approve、verify、review 和 done 会产生明显摩擦。但只依靠代码注释和 Git
commit 又无法保存实施前的需求、根因、失败验证和范围变化。

## 已确认的设计决定

以下决定来自补回对话和压缩前的逐项确认，可作为后续设计约束。

### 历史与当前知识

- task archive 是历史真源，回答「当时发生了什么、为什么这样改」；
- Git 跟踪的模块文档是当前知识真源，回答「现在如何工作、修改时必须遵守什么」；
- 源码和测试负责最终验证，知识文档只负责导航、解释 contract 和缩小阅读范围；
- 暂不恢复 v1 的独立 knowledge 数据库、knowledge card、module card 或另一套知识状态机。

### Knowledge impact

- `submit` 必须声明 knowledge impact；
- `done` 前必须满足 `none + reason`，或者已经更新并关联对应知识文档；
- 总结对象是本次 task 产生的 knowledge delta，不是重新总结整个模块；
- 可复用内容包括 contract、invariant、当前决定、bug 根因、known failure mode 和验证入口；
- 只对本次任务有效的信息保留在 task history，不进入模块知识。

### 模块知识与过期

- 默认每个复杂模块或子系统维护一页 Markdown 知识文档；
- 文档使用 frontmatter 记录 `id`、`summary`、`covers` 和 provenance；
- 主要章节包括 responsibilities、public contracts、invariants、current decisions、known failure modes、
  verification 和 provenance；
- 持久状态为 `current`、`stale`、`retired`；`review_needed` 是根据证据派生的状态；
- freshness 主要根据 `covers` 范围内文件内容 fingerprint 判断；task ID 保存验证来源，commit SHA 仅作可选证据；
- 大重构使用知识迁移表，明确 split、merge、retire 和 superseded links；
- `.latch` 不能因为模块重构而删除。

### 上下文与检索

- 使用渐进读取：先读取 task、短模块知识和结构地图，证据不足时再读源码与测试；
- 单次 context pack 必须具有硬预算、来源、截断标记和扩读原因；
- 只能保证单次注入受预算限制，不能保证永远低 token 且绝不遗漏；
- 自动扩读只读材料不需要逐次询问，但必须有批次预算、累计预算和原因记录；
- 外部检索工具必须可降级，失败或 stale 时回到 `rg` 和直接读取；
- semantic understanding 由 AI 完成，CLI 负责确定性校验、裁剪、freshness 和可重建索引管理。

### 决策、反馈与事后建档

- 重要 decision 保存 `before`、`after`、`reason`、`source`、`evidence` 和 `affected` 等结构化事实；
- 只保留短证据和来源指针，不保存完整聊天；
- 支持 retrospective 事后记录，但不能伪造「先有 plan、后批准实施」的历史；
- 用户明确给出的精确变化可以使用 delta approval；AI 推导、公共 API、认证、迁移和明显扩范围仍需确认；
- 用户负面反馈形成短记录并回显，可撤销；CLI 自动记录客观 fallback 和 override。

### Worktree 与并发

- 路径不重叠的 task 可以共用 worktree；
- 路径重叠时由 AI 建议新 worktree、等待或明确 override；
- override 标记 `provenance: mixed`；
- 项目可以预先授权创建 worktree；merge、rebase、push、移除 worktree 和删除 branch 始终单独授权。

### 小修改、代码注释和 Git commit

- 小修改不默认添加代码注释；
- 代码注释只解释当前实现无法自行表达的约束、反直觉原因和外部 contract；
- Latch history 保存问题、根因、方案和验证，Git commit 保存可独立回退的实现变化；
- 一张 task 可以对应多个 commit，commit 数量和代码行数都不直接决定 task 边界；
- 用户可以自行拆分 Git commit，Latch 不自动执行 Git 操作。

## 已撤回或不采纳的方案

- 不恢复 v1 的 knowledge card、module card、自动 scaffold 和知识门禁；
- 不把完整聊天作为长期真源；
- 不把 Graphiti、图数据库、LLM 抽取和 embedding 作为个人工具默认依赖；
- 不在没有实测收益时强制安装 QMD、向量模型、RAG 或 GitNexus；
- 不让 Latch core CLI 判断代码语义；
- 不把 `.latch` 当作日常可删除缓存；
- 不采用「所有写入请求都自动创建 task」作为最终规则，该方案会让一行修改也重复完整流程；
- 不采用「每个独立根因都必须单独建 task」作为固定规则，该方案忽略共同审批和共同 review 的实际工作方式；
- 不用代码注释记录 bug 历史。

## 外部方案研究结论

### Withy

可参考 Markdown wiki、frontmatter、`covers`、索引注入与完整注入分离、lint 和章节级检索。仓库仍为
`0.0.0`，且此前检查未发现明确 license。只参考公开设计，不复制实现。

### Aider repository map

可参考 AST symbol map、依赖排序和 token budget。约 1,000 token 的 repo map 适合作为大型模块入口地图，
但不能替代相关源码和测试。

### QMD

提供本地 BM25、vector 和 rerank。知识文档数量较少时先使用词法检索；只有出现真实漏召回并通过 benchmark
证明收益后再考虑 vector。完整模型组合的本地资源成本较高，不作为默认依赖。

### GitNexus 与 CodeGraph

适合调用关系和影响面查询，但只作为可替换后端。GitNexus 较重，并有原生依赖和 PolyForm
Noncommercial 许可约束。当前环境已有 CodeGraph，优先修复和实测 CodeGraph。

### Graphiti

时态事实和 provenance 与问题相符，但需要 Python、graph database、LLM、embedding 和实体抽取。Latch 已有
task events 保存历史，引入 Graphiti 会重复建设，不建议采用。

## CodeGraph 已知状态

压缩前诊断记录了以下证据，执行任何升级前需要在新窗口重新核验：

- 已安装版本为 `1.1.2`，当时发现最新版本为 `1.4.1`；
- `lastIndexed` 为 `2026-07-02T10:17:55.987Z`，索引文件数为 18；
- 索引仍包含已经删除的 v1 文件，例如 `src/core/knowledge.ts`、`src/core/ownership.ts`、
  `tests/cli-knowledge.test.mjs` 和 `tests/cli-query.test.mjs`；
- 当前源码已经出现 `src/core/actor.ts`、`tests/cli-base.test.mjs`、`tests/lifecycle.test.mjs`、
  `tests/review.test.mjs` 和 `tests/store.test.mjs`；
- 旧版 `codegraph status --json` 只报告 `added: 1`、`modified: 1`、`removed: 0`，没有发现已提交删除；
- 旧索引曾让 `codegraph explore` 返回不存在的 `src/core/knowledge.ts`。

由此得到的契约要求：任何 CodeGraph adapter 都必须检查工具版本、索引根目录、索引时间、文件存在性和
freshness；检查失败时不得把结果作为当前源码事实。修复顺序应为升级工具、完整执行 `codegraph index .`、
确认旧文件消失、使用当前 symbol 做 smoke query，再检查新版本的 status 与 branch/worktree freshness。

当前 task 没有授权升级 CodeGraph 或重建索引。

## 新增的真实工作方式

用户对上一轮 batch task 建议补充了以下事实：

- bug 通常逐个发送给 AI，不一定一次提供完整列表；
- 不同 bug 可能分别在多个 Codex 对话中处理；
- 多个对话可能对应同一批工作，也可能互相独立；
- 最终代码可能由用户拆分成多个 Git commit；
- 希望流程自动提供建议，不希望反复回答「是否创建 task」。

这使「一张 batch task 包含多个 bug item」只能覆盖同一对话、共同批准和共同 review 的情况。多个对话直接
共用一张 task 会出现以下风险：

- 两个 AI 基于相同 revision 更新 task，产生 revision conflict；
- 一个对话修改 plan，使另一个对话已有 approval 或 verification 失效；
- 不同 bug 的源码上下文和验证结果混在同一 submission；
- 某个 bug 被阻塞时，整张 batch task 无法清楚提交或归档；
- 不同 worktree 或 commit 的 provenance 难以区分。

因此，上一轮「一次提供的多个小 bug 默认合成 batch task」只能标记为有条件接受，不能直接成为全局规则。

## 已确认：多对话小 bug 的默认模型

以下决定来自本轮质询，可作为后续设计约束（仍非产品实现授权）。

### 默认写单元

- 默认写单元是**独立 task**，不是共享 batch 的可写 item，也不是第二套 change receipt 对象。
- 跨对话不得共写一张 task；`group` 只做读侧聚合，不持有共享 `plan_revision`、共享锁或共享 verification 集合。
- 同对话、一次给出多个小 bug、且共同批准与共同 review 时，batch item 仍可作为**有条件**路径保留。

### Light profile（验证门）

- `light` 是同一 task 模型上的 profile，不是新类型。
- Light 强制「证明包」：`intent`、`authorization`、至少一次 named `proof`（verify）、以及 submit/done 时的 `knowledge_impact`。
- Light 默认可省：多轮 plan 打磨、冗长 approve 往返、为聚合而等待其它 bug。
- Light **不可省**：`submit` 之后的 **`review` 停顿**，以及用户**明确授权**后的 `done`。不得 submit 后自动归档。
- 命中 open_questions、公共 API/认证/迁移、AI 自拟方案、范围扩大或多 gate 设计取舍时，升级为 `standard`。

### Review 不可折叠（light 与 standard 相同）

- `submit` 的语义是进入 **`review`**，不是归档。
- light 可以压缩 plan 展示与 approve 往返，**不能**压缩掉用户验收与明确 `done` 授权。
- 若 submit 后自动 done：正常「验收不满意再改」会被误判成已归档复现，错误地新建 task。
- 未归档返工 = 同 task；已归档复现 = 新 task 软关联。分界线就是 **是否已经用户授权 done**。

### Authorization（请求即授权）

- 在 delta 条件满足时（用户给出精确低风险改动、无 open_questions、未碰高风险面、AI 不扩 scope），创建 light task 时可把该请求记为 delta approval（`source=user_request`），不强制第二次「批准 plan」往返。
- approval 必须钉死 scope 摘要；越界或改方案后不得继续沿用该授权。
- 不满足 delta 时，退回一句话确认或完整 approve。

### Writer affinity

- task 记录主写 actor；其它 actor 默认只读，抢写需显式 takeover 事件。
- 用于防止两个对话误 `use` 同一 task 后互相覆盖 revision。

#### 成立前提：会话级 actor（fail closed）+ 责任拆分

**问题（现行 v2 与新设计不兼容）：**

- 现实现 `actor.ts`：Codex 可用 `CODEX_THREAD_ID` 区分对话；Claude / OpenCode 退化为 `claude:default`、`opencode:default`；否则 `unknown:default`。
- 现行 PRD 允许客户端级退化并只给 warning。
- 两个 Claude 对话会被当成同一 writer → **「跨对话不得共写」被穿透**。
- 本设计 task 的 events 亦曾记为 `claude:default`。

**锁定：拿不到会话声明级 actor，就禁止写 task（fail closed）。**

**再锁定：Core 只验证 actor 声明与写权限，不能证明 opaque-id 来自唯一真实会话。**  
`session-id != default` 不够：`claude:foo` 仍可能被两窗口复用；格式混用也无法从字符串推导真实性。

##### 规范 actor 与责任

```text
canonical actor: <tool>:session:<opaque-id>

adapter / skill：
  保证同一会话稳定、不同会话不同
  设置 LATCH_ACTOR 为上式
  声明 session scope（可写）
  身份真实性与唯一性由 adapter/skill 保证，不由 Core 证明

Core：
  校验 actor 形态与 scope 声明（可写要求 scope=session）
  拒绝 client / default / unknown 及不可会话声明的写操作
  强制 primary writer / takeover
  不宣称能验证 opaque-id 的物理真实性或防恶意伪造
```

| 角色 | 做什么 | 不做什么 |
|---|---|---|
| **adapter / skill** | 为每个会话生成/绑定稳定 `opaque-id`；写入前设置 canonical `LATCH_ACTOR`；保证本工具内「同会话同 id、异会话异 id」 | 不把「防恶意伪造 actor」推给 Core |
| **Core** | 解析并校验声明：可写必须是 session scope；拒绝 default/client/unknown 写；执行 affinity 与 takeover | **不**证明 id 来自唯一真人会话；**不**当认证/安全边界 |
| **writer affinity** | **防误写的协作门禁**（两窗口不小心共写） | **不是**安全认证、不是多租户隔离 |

##### 可写 / 只读门禁

| 规则 | 内容 |
|---|---|
| 可写 actor | 必须为 canonical：`<tool>:session:<opaque-id>`（`opaque-id` 非空，且不得为 `default`）。由 adapter 保证唯一性。 |
| 禁止可写 | `claude:default`、`opencode:default`、`unknown:default`、`<tool>:default`、client 级 scope、缺 session 段的任意退化 id。 |
| 无会话 actor 只读 | 仅允许 **`list`** 与 **显式 `context <task-id>`**。 |
| 禁止无会话 | 无参数 `context`（依赖共享 current，跨会话串味）以及一切写命令。 |
| 平台合成 | 仅当 adapter 能提供稳定会话 opaque-id 时合成 canonical actor（例如从 `CODEX_THREAD_ID` 映射为 `codex:session:<id>`）。旧示例 `codex:default:<THREAD_ID>` **不作为最终规范**，实施时归一到 canonical。 |
| takeover | 仅 session-scope writer 之间；双方 id 均可被 Core 识别为可写形态。 |
| 与 v2 PRD | 废止「客户端级退化 + warning 后继续写」；最终以 fail closed + 责任拆分为准。 |

**取舍：** fail closed 暴露配置错误；affinity 防的是误用不是攻击。恶意共享同一 `LATCH_ACTOR` 超出本工具威胁模型。

##### primary_writer 与旧 task 迁移（S0 必含，禁止静默占有）

**缺口：** 现行 `TaskV2` 无 writer 字段；历史事件多为不可写的 `claude:default` 等。仅「新字段可选、补默认值」不够——补错默认会卡死或被抢占。

**两种错误直觉（明确否决）：**

| 做法 | 为何错 |
|---|---|
| 继承事件里的 `claude:default` 为 primary_writer | fail closed 后**没有任何合法 actor 能写** |
| 第一位出现的 canonical actor **静默**成为 primary | 任意新对话可抢先接管旧 open task（first-writer-wins） |

**锁定：旧 open task 必须「用户明确授权的 claim」设置首任 writer；禁止静默 first-writer-wins。**

```text
新 task：
  checkpoint 时把当前 canonical session actor 写入 primary_writer
  此后 affinity / takeover 按常规则

旧 open task（无 primary_writer 或等价缺失）：
  状态语义 = legacy_unclaimed
  普通写命令全部拒绝（save/approve/verify/submit/done/abandon/…）
  仅用户明确授权的 claim 可设置首任 primary_writer
  记录 writer_claimed 事件并增加 revision
  claim 发起方必须已是合法 session-scope actor

旧 archive：
  保持只读，无需补 primary_writer

历史事件中的 *:default / 旧 actor 字符串：
  仅作 provenance 追溯，不转换成新身份，不自动映射为 primary_writer

旧 state.json 的 actors.*.current_task_id：
  不得自动映射到新 session actor 的 current
  迁移后由各会话显式 use / claim 后再建立 current 索引
```

**claim 形态（契约级，命令名实施可定）：**

- **不是**与 `done` 同级的终局操作：claim 只给 `legacy_unclaimed` 绑定首任 `primary_writer`，之后仍可 takeover；**不**改变 plan approval，**不**等于实施授权，后续仍受原 phase 与门禁约束。
- **禁止**静默 first-writer-wins；**不要求**用户必须说出「claim / 认领」等内部术语。

**算作 claim 授权（B 收紧版）：**

```text
以下算 claim 授权：
- 用户明确要求继续、接手或处理某张【具体的】legacy_unclaimed task
- 当前调用方已有合法 session-scope actor

以下不算：
- 只要求查看、读取或报告状态
- 无法确定具体 task 的「继续 Latch」
- AI 自行从 open task 中挑选

执行时：
- Skill 先回显「将按本次继续请求绑定到当前会话」
- 不追加一次确认往返
- 写 writer_claimed + revision
- 不视为 implementation approval
```

- 与现有「继续/接手指定 task = 恢复该任务」协议对齐；迁移 bookkeeping 由 skill/CLI 完成，不把术语推回用户。
- **批量 claim** 必须用户明确说批量接管/认领一批；单张「继续这张」不得被 skill 扩大为全仓库 claim。
- claim 后该 actor 为 primary；其它 session 要写须走 **takeover**（见下节，非静默、规则已定）。
- 本设计 task `20260714084358411-…` 在 S0 验收中必须作为 **legacy_unclaimed → 用户「继续该 task」触发 claim** 样本（events 含 `claude:default`）。

**独立判断：** 「继续指定旧 task」作为 claim 授权合理——比 done 轻、比静默占有重，且符合已有继续语义。否决「必须说认领」以免迁移摩擦回到用户。

##### takeover（非对称规则，产品语义，不得留到实施再发明）

claim 面对「无人拥有」的 `legacy_unclaimed`；takeover 会撤掉**可能仍活跃**的 primary writer。Core **没有** session liveness，用户意图是唯一保护，故模糊「继续」不得直接替换现任 writer。

**锁定：明确接手直接转移；普通继续先确认一次（非对称）。**

```text
同一 primary writer 继续：
  直接继续，无 takeover 事件

不同 session 明确说：
  「接手 task X」
  「把 task X 切到当前对话」
  → 直接 takeover，不二次确认

不同 session 只说：
  「继续 task X」
  → 先只读恢复 context
  → 告知当前 primary writer
  → 询问一次是否转到当前会话
  → 用户明确同意后再 takeover

只要求查看状态：
  不 takeover
```

**成功 takeover 必须：**

| 项 | 要求 |
|---|---|
| 调用方 | 合法 canonical session actor |
| 并发 | 携带 `expect_revision`（或等价乐观并发） |
| 事件 | `writer_taken_over`，记录 `from`、`to`、reason，revision +1 |
| 不改变 | phase、approval、gate、submission；**不等于**实施批准 |
| 旧 writer | 此后对该 task 的写入明确失败 |
| 回显 | 提示旧会话可能仍在改共享 worktree；Core **只能**阻止 Latch 写入，不能停另一进程改文件 |

**与 claim 对比：**

| | claim | takeover |
|---|---|---|
| 对象 | `legacy_unclaimed` | 已有 primary_writer |
| 「继续指定 task」 | 可直接 claim（B 收紧） | **不可**直接转；须确认或明确「接手」 |
| 静默占有 | 禁止 | 禁止 |

**独立判断：** 非对称合理——接手话术意图清晰；「继续」在已有主写时更像恢复阅读，直接抢写会误伤另一窗口。不把 takeover 留到实施阶段临场发明。



### 不采用

- 默认的 batch + item 级独立 revision/锁/submission（近似隐藏版 task tree）。
- 无生命周期的独立 change receipt 类型（证明包字段落在 light task 上）。

## 操作模式：Bug Wave（不是第三套生命周期）

用户一开始就知道「今天要改很多 bug」时，**不需要**新的 phase 机或父 task 批准链。

推荐的特殊模式只有一种操作约定：**Bug Wave**。

1. 先建立或复用一个 `group_id`（例如 `wave:2026-07-14-ui-polish`），只作标签与列表过滤。
2. 每个 bug 仍落成一张独立 light task（可跨多个对话），写入时挂上同一 `group_id`。
3. 单张 light task 可独立 verify / submit；`submit` 后停在 review；仅用户明确认可归档后 `done`。一张 blocked 不拖死同组其它 task。
4. 组视图只提供派生计数与只读兄弟摘要（标题、phase、路径），不合并 plan 与验证细节。
5. 用户自行按可回退改动拆 Git commit；Latch 不因 group 自动 commit。

### 同模块 vs 不同模块

不为此再拆产品模式；同一套 light + group 规则，skill 按模块关系调整建议：

| 情况 | 建议 |
|---|---|
| 不同模块、路径不重叠 | 最适合多对话并行；group 只服务「这批活」的人读视图 |
| 同模块、路径可能重叠 | 仍各自 light task；启动前做路径重叠检查，冲突则串行、换 worktree 或显式 override（沿用已确认 worktree 规则） |
| 多个「bug」其实同一根因/同一修复面 | **合并为一张 task**，不要为了凑 wave 数量拆成多张 light |
| 同模块大量只改实现、不改 contract | 各 task 的 knowledge impact 多数为 `none + reason`；模块文档可在 wave 末可选补一次，而不是每张都重写 |

结论：同模块不会让共享一张可写 batch 变得更合理；它只让 **group + 路径冲突检查 + 可选波次末知识补记** 更有价值。跨模块则并行更干净。

### Wave 启动时已知 bug 列表

默认 **A：group 先行，task 随做随建**。

- 开局「今天要改很多 bug」→ 建/复用 `group_id`，未开工条目不必先建成 task。
- 精确条目已可开工时，可立刻建对应 light task（进阶用法，不强制一次展开全部清单）。
- 不默认把整份清单一次性展开为 N 张空 task，避免清单变更带来弃置噪音。

### 信息不足时先质询（用户既有流程，明确保留）

用户原有流程：**给的信息不够时，应 grill / 追问，而不是自己一路做下去，做出不是用户想要的结果。**

本最终设计**保留并升为硬规则**：

| 情况 | 必须怎么做 |
|---|---|
| 目标、范围、成功标准或关键取舍不清 | **停下质询**，写入 `open_questions` 或等价阻塞项 |
| 仅有模糊意向（「优化一下」「修修看」） | **不得**当作 delta 授权；不得直接实施完整方案 |
| AI 需要自拟方案、猜根因、猜产品偏好 | **先确认**；确认前不改用户可见行为 |
| light 路径中发现其实不清 | **升级 standard 或保持 plan/阻塞**，不得假装已请求即授权 |
| 用户已给出精确、可验证改法且低风险 | 才允许请求即授权并往下做 |

与其它规则：

- 可先建 task 记录「已知 / 未知」，但**未知未清前不实施**。
- 信息已够时不硬 grill；信息不够时禁止靠猜推进。
- Core：未关闭 `open_questions` 不得 approve 进入实施；无有效 authorization 则 light 的 submit/done 硬拒绝。
- Skill：宁可多一轮确认，不可交付「看了才发现不是这个意思」的实现。

#### 「够不够做」判定表（可操作）

先判 **能否实施**；再判 **light 还是 standard**。默认偏保守： borderline → 问一句。

**A. 必须停下 grill（不得实施）——命中任一条：**

| 信号 | 例子 |
|---|---|
| 目标不清 | 「优化一下表格」「弄好一点」 |
| 成功标准不清 | 不知道怎样算修好 |
| 范围可大可小 | 「搜索有问题」未说哪种搜索/哪种表现 |
| 要猜产品偏好 | 交互文案、默认行为、是否保留旧兼容 |
| 根因未收敛且改法未指定 | 只描述现象，AI 要在多种修法里猜 |
| 涉及取舍 | 性能 vs 正确性、两处行为冲突选边 |
| 高风险面且无明确改法 | 认证、权限、迁移、公共 API、数据删除 |

**B. 可以 light + 请求即授权——须同时满足：**

| 条件 | 说明 |
|---|---|
| 改法可复述 | 用户话能钉成「改什么行为/哪个点」 |
| scope 可钉死 | 文件、组件或行为边界说得清，或可由症状唯一收敛到小面 |
| 低风险 | 不碰认证/迁移/公共 API 契约/数据销毁；不改跨模块协议 |
| 无未决 open_questions | 或本轮问题已答完 |
| AI 不扩 scope | 实施计划不超出用户原话 |

**C. 走 standard（展示 plan，明确 approve）——未进 B，但目标已够做方案：**

- 需要多步设计、多 gate、或 AI 提出完整方案供选；
- 用户目标清楚，但路径需要确认。

**D. 实施中途变不够：**

- 一旦发现要猜 → **立刻停**，补问或升级 standard；
- 已发生的 authorization 作废，需新授权；不得「先做完再问」。

**E. 问法约束：**

- 优先一次一个关键阻塞问题（或极少必要问题清单）；
- 问题要带可选方向，避免空泛「你想怎样」；
- 用户说「你定/按你推荐」→ 记录为用户授权的选取，仍须写明选了什么与 scope。

### 灵活运用原则（默认建议，不是死板仪式）

设计给出**硬底线**与**情境建议**两层；用户可按舒服程度调整用法，AI 选当下最好路径，用户不舒服时直接改口即可。

**硬底线（不可为图省事打破）：**

- 多个对话不得共写一张可写 task；
- **信息不足时先质询，不靠猜测实施**；
- **`submit` 后必须停在 `review`，仅用户明确授权后才 `done`**（light 与 standard 相同）；
- **无 session-scope actor 禁止写 task**；Core 只验声明，真实性由 adapter；无会话时只读限 `list` 与显式 `context <id>`；
- 小 bug 至少留下 light 证明包（intent / authorization / proof / knowledge_impact）；
- delta 授权必须钉死 scope，越界要重新授权；
- group 只读聚合，不承担批准与验证门禁；
- 不伪造「先 plan 后批准」的历史。

**情境建议（可灵活选更好者）：**

| 情境 | 优先建议 | 也可接受 |
|---|---|---|
| 预知一批、条目尚不稳 | Bug Wave：先 group，随做随建 light | 用户坚持时再预建部分 task |
| 同一对话连续修多个独立小 bug | 同 group 下多张 light，做完一张再下一张 | 一次列出且要共同批准时，用有条件 batch item |
| 同一对话、多个 bug 实为同一根因 | 合并一张 task | — |
| 多对话并行、路径不重叠 | 每对话各自 light + 同或不同 group | 各自独立、不挂 group |
| 同模块路径可能重叠 | 串行 light，或分 worktree | 用户明确要并行时警告并标记 provenance |
| 需要设计取舍 / 高风险面 | standard 全流程 | — |

原则：优先选**当下冲突最少、证明成本够用**的方式，而不是无论场景都走同一条仪式链。

## 当前需要继续质询的问题

### 1. 多对话 bug 的记录单元

默认模型、Bug Wave、请求即授权、灵活运用原则已确认。剩余：light/standard 中途升级是否可逆，以及同对话多 bug 在「多 light」与「batch item」之间的自动选择信号。

### 2. 自动创建与批准

已确认默认 **A：客观写入信号即建 light**（将改代码 / 修 bug / 补测并收尾类请求）。

- 高风险、范围不清或 AI 自拟方案 → 升级 standard 并展示 plan。
- 用户说「这次不用 Latch」→ 本轮不建。
- 「先改后记」仅在用户明确要求时走 retrospective，且不得伪造先批准历史。

#### 使用者需要注意什么（简表）

**通常不必说的：**

- 不必每次宣布「有多个 bug」；一条条丢给 AI 即可，AI 按条建 light。
- 不必每次问「要不要建 task」；默认会建 light。
- 不必为聚合强行开父 task。

**值得说清的（一说就更好）：**

| 你想表达的 | 示例说法 | 系统怎么用 |
|---|---|---|
| 这是一批活，想一起看进度 | 「今天这批 UI 小修」「挂到 wave:xxx」 | 建/复用 group |
| 这轮不要记账 | 「这次不用 Latch」 | 本轮不建 task |
| 几个现象同一根因 | 「其实是同一个问题，一起改」 | 合并一张 task |
| 精确修法（触发请求即授权） | 「把 submit 前按钮 disable，防双击」 | light + 钉死 scope 的 authorization |
| 还没修好 / 再改一版 | 「还是复现，再改」 | 见下方重开规则 |
| 扩大范围 | 「顺便把列表空态也修了」 | 新授权或新 light / 升级 standard |

#### 没改好再改：未归档 vs 已归档

**未归档**（仍在 plan / dev / check / review）：

- 默认**继续同一张 task**，不新建平行 task。
- 用户负面反馈记短记录并回显（沿用已确认反馈规则）。
- 若修法仍在原 scope 内：补实现 → **重新跑 proof（verify）** → 再 submit。
- 若换方案或扩大 scope：需要**新 authorization**（一句话确认或 approve），不得继续吃第一次请求授权。
- 不把失败尝试从历史上抹掉；保留根因/失败验证，便于以后追溯「为什么改了又改」。

**已归档**（已 `done` / archive）：

- 默认**新建一张 light task**，不要改写旧 archive 假装第一次就成功。
- 关联强度默认 **A：软关联**：新 intent / 字段写旧 task id +「回归/未彻底」；**不**继承旧批准与旧 verify。
- 不做默认 `supersedes` 状态机，也不默认 reopen。
- 旧 archive 仍是历史真源：当时改了什么、当时为什么以为好了。
- 仅当用户明确要求「把旧 task 拉回来改结论」时才讨论 reopen。

**同一对话里连续多个 bug 的重试：**

- bug A 未归档且未修好 → 一直留在 task A 上迭代。
- 用户已经切换到 bug B → task A 若仍 open，可先 block/waiting 或继续；不要把 B 的改动写进 A。
- 不要因为「又改一次」就自动新开 task（未归档时）；也不要因为「同模块」就把回归写进无关的新 bug task。

### Light ↔ Standard 切换（推荐默认，待一句确认）

- **light → standard**：命中高风险面、open_questions、扩 scope、AI 自拟方案、需要多 gate 或设计取舍时，**必须升级**；记事件，后续按 standard 门禁。
- **升级默认单向**：已进入 standard 且已产生 authorization 后，**不静默降回 light**。
- **降级例外**：仅在尚无 authorization，或用户明确要求缩小为 light 并重写 intent/证明包时允许；须新事件，不删旧历史。
- 一张 task 生命周期内允许 light 开工、中途升级；不鼓励 standard 做完再改标 light 来「补省事」。

### 3. Core、skill、文档与 adapter 边界

已确认默认分工：

| 职责 | 归属 | 理由 |
|---|---|---|
| revision / phase / approve / verify / submit / done 状态机 | Core | 确定性，防乱序 |
| light 证明包结构门禁 | Core **硬拒绝** | 缺 authorization 事件、缺 named verify、或缺 knowledge_impact 声明时，`submit`/`done` 失败并指出缺项；`none` 必须带非空 reason |
| 是否该建 task、light vs standard、delta 是否合格、scope 语义是否越界 | Skill | 语义判断 |
| group 存 id、list 过滤、只读兄弟摘要 | Core 数据 + 查询 | 无 group 状态机 |
| writer affinity / takeover | Core 强制声明与权限（fail closed）；真实性由 adapter | 协作防误写，非认证 |
| 模块知识 Markdown 内容 | Git 文档 + Skill 撰写 | 真源在 Git |
| covers fingerprint / stale 标记 | Core 或小 helper 确定性计算；Skill 决定读不读、如何扩读 | 计算与解释分离 |
| CodeGraph / 词法检索 | 可选 adapter；失败降级 rg + 读文件 | 不进核心硬依赖 |
| 自动「建议挂哪个 group」 | Skill | 启发式 |
| 用户 bookkeeping（手动填卡片、手动分类） | 不作为默认负担 | AI + CLI 承担 |

补充：

- **不**把「证明包软警告仍成功」作为默认（已否决 C）。
- 急诊 override **不**作为 v1 默认能力；若将来加，必须显式、记事件、默认关闭（曾讨论的 B 窄口）。
- Core 不判断代码语义、不决定 bug 是否修好、不写知识正文。

### Light ↔ Standard 切换

此前「推荐默认」现与用户确认方向一致，记为已确认：

- light → standard 遇高风险 / 扩 scope / 自拟方案等必须升级；
- 已 authorization 后不静默降回 light；
- 无授权或用户明确要求缩小时才允许降级并记事件。

### 4. Context benchmark

已确认方向：benchmark 服务「多节点 / 多功能」真实任务，灵活组合工具，尽快找到代码、问题根因或正确文档；不是只刷单一 token 百分比。

用户原话较粗，下面是在不增加重流程前提下的**够用标准**扩展；现有主/次分层仍然成立，无需再加复杂评分系统。

#### 什么叫「还可以」（实用版）

一次 context 辅助算够用，当且仅当在多节点题上同时大致满足：

1. **找对地方**：先到正确模块文档或正确代码入口，而不是在无关目录里广读。
2. **找全关键点**：gold set 里标成 critical 的路径/符号/文档 **0 遗漏**（允许「已点名、下一步再读」，不允许 silently 漏掉）。
3. **找得够快**：在有限工具步数内出现第一份可行动证据（相关文件、失败模式或 contract），而不是读完半个模块才定位。
4. **用得灵活**：同一题允许不同工具顺序（知识 → 地图 → `rg` → 选读源码；或 task → `rg` → 源码）；某一工具 stale/失败时能降级，不卡死。
5. **少读冤枉书**：相对「从入口整树广读」，读取量和估算 token 更低；**约 30% 降幅作参考目标**，不是唯一否决项。

直接失败（一票否决）：

- critical 遗漏 > 0；
- 把过期/错误文档当当前事实且未标 stale；
- token 很低但答错影响面（假省 token）。

不必做成的东西：

- 不搞百分制综合分、不设排行榜；
- 不要求每次都跑满四条对照路径才许开发（设计验收时对照；日常用一条灵活路径即可）；
- 不承诺「永远低 token 且零遗漏」——只保证单次 pack 有预算、有来源、可降级、可对照。

#### 题型扩展（多节点 / 多功能）

至少覆盖三类，而不是只测「打开一个大文件」：

| 题型 | 要证明什么 |
|---|---|
| 跨文件行为 | 改 A 行为时必须看到 B/C 调用或 contract |
| 文档路由 | 能落到正确模块知识页，或正确报告无文档/stale |
| 回归/根因 | 能从症状落到已知 failure mode 或历史 task 指针，再进源码 |

每题事先写短 gold set（critical 路径/符号/文档 id）+ 可选 nice-to-have。人审一次即可，不靠模型自评。

#### 指标怎么记（轻量）

| 指标 | 用途 |
|---|---|
| critical 遗漏数 | 主 gate |
| 是否找对文档/入口 | 主 gate |
| 首次可行动证据的工具步数 | 主体验（快） |
| 读取字符 / 估算 token vs 广读 | 次对照（省） |
| 扩读轮数、降级次数、freshness 失败 | 诊断 |
| 找错文档次数 | 失败模式 |

**主成功 = 对 + 全 + 够快 + 可降级；次成功 = 更省。**  
30% token 降幅：达到更好；没达到但主成功仍算「还可以」，记优化项。

#### 对照路径（设计验收用）

1. 直接广读入口文件；
2. `rg` 定向；
3. fresh CodeGraph（**仅**另授权升级/重建后）；
4. context pack（task + 短知识 + 地图 + 按需扩读）。

### 5. 外部读取与工具升级授权

已确认本 task plan 阶段授权：

- **允许**：对 `/Users/johnsmith/Project/work/appearance-sec/src/components/DataTableV2` 做**只读** benchmark / 结构勘察 / gold set 草稿（读文件、`rg`、列目录）。
- **仍不允许**：升级 CodeGraph；完整重建 Latch 或 appearance-sec 的 CodeGraph 索引；写入 appearance-sec；把只读勘察当作产品实现。

执行顺序（用户确认按推荐后，已做一轮轻量只读勘察）：

- 只读勘察定位为设计打样，**不是** Latch 产品自动化测试，也不是改 appearance-sec。
- 未升级 CodeGraph，未写外部 repo，未通读全部源码。

#### DataTableV2 轻量只读结论（2026-07-14）

路径：`/Users/johnsmith/Project/work/appearance-sec/src/components/DataTableV2`

| 事实 | 数值 |
|---|---|
| 文件数 | 约 33（含 `__tests__`） |
| 目录体积 | 约 384K |
| 源码字符合计（ts/vue/js/css/md） | 约 **316k 字符** |
| 源码行数合计 | 约 **10.5k 行** |
| 最大单文件 | `index.vue` ≈ 77k 字符 / 2569 行 |
| 其它大文件 | `StreamRestoreDialog.vue` ≈ 43k 字符；`TableToolbar.vue` ≈ 26k；多个 `use*.ts` 10k–16k 字符 |

结构：扁平底层 + 组合式拆分（`useTableInit`、`useExportDownloadActions`、`useDigdownActions`、`useContextMenuActions` 等）+ 子组件（Toolbar / 流还原 / 分页等）。  
调用方不只在目录内：`networkLink`、`transactionCenter`、`AlarmInfoTab` 等引用；视图侧有 `ARCHITECTURE.md` 提到 DataTableV2 导出/流还原等，**未见**独立的 DataTableV2 模块知识页。

对 context pack 的校准（白话）：

1. **整模块一次塞进对话不现实**：约 316k 字符，远超任何合理单包。
2. **连「只读一个大文件」也不该作为默认**：仅 `index.vue` 就约 77k 字符，已接近或超过曾讨论的单包量级。
3. **正确默认是「按功能节点摘录」**：例如导出问题 → `useExportDownloadActions.ts` + `types` + 必要时父级 `TrackingDrawer` 透传，而不是整目录。
4. **多节点题成立**：工具栏 / 导出下载 / 下钻 / 流还原 / 面包屑 / 初始化，天然是多文件功能面。
5. **短知识 + 地图有价值**：目录本身可当地图；contract 分散在 `types` 与视图 ARCHITECTURE；缺统一模块知识页时，helper 应落到这些入口而不是装全读。

### 6. Context pack 硬预算

#### 先分清两个「上下文」（给使用者的白话）

我们讨论的**不是**：

- 你每发一句话，AI 都要先算上下文再决定听不听；
- 对话超过 64k/128k 你就要手动做什么；
- 把整个聊天硬限制在 24k/64k。

我们讨论的**是**（给未来 context helper / skill 的规则）：

- AI 为了少重复读大模块，会**偶尔**组装一包材料：当前 task 摘要 + 短知识 + 结构地图 + 几段关键代码；
- 这一包叫 **context pack**；
- 这包要有体积上限：到顶就截断并标记「还有啥没塞进」，需要再读就下一轮，而不是一次把 DataTable 整棵塞进对话。

| 概念 | 是什么 | 你要不要管 |
|---|---|---|
| **对话总上下文** | 整段聊天累计（你看到的 68k、128k 多半是这个） | 一般不用管；客户端自己涨 |
| **单次 context pack** | Latch/AI **一次**打包的那份开工材料 | 你不用算；工具按默认上限截断 |

用户一度反馈会话常到 64k–128k token，曾讨论把单包提到 ~64k 字符。结合 DataTableV2 只读体量与「64k 是否偏大」的判断后，**默认收回约 24k 字符**。

#### 已确认默认（用户确认回收 24k）

| 层 | 内容 | 默认 |
|---|---|---|
| L0 任务 | 当前 task 短视图 | ~4k 字符 |
| L1 知识 | 模块知识摘要 + 结构地图 | ~6k 字符 |
| L2 证据 | 源码/测试**摘录**（非整大文件） | 计入单次合计 |
| **单次 pack 合计** | L0+L1+L2 | **~24k 字符**硬顶 |
| 自动扩读 | 只读材料 | 每批 ≤8k，累计 ≤48k 字符，必须记原因 |
| 宽裕档（可选配置） | 同机制 | 单包可调到 ~64k；**不作默认** |

约束：

- Core 校验「有上限且超限截断」；项目可配置。
- 门禁主单位用**字符**；与客户端 token 不可直接等同。
- **大文件必须摘录**：DataTableV2 的 `index.vue` 约 77k 字符，默认 24k **故意**装不下整文件，逼出按符号/区段摘录。
- 中等 composable（约 10k–16k 字符）可接近单包 L2 预算，但仍优先相关函数段，而不是无脑整文件。
- 会话总上下文涨到 68k/128k 是多轮累计；用多轮小包 + 精准摘录，比单包 64k 更符合「别一次塞太厚」。

#### 为何 24k 默认、64k 偏大（结合实测）

| 观察 | 对默认的含义 |
|---|---|
| 整模块 ~316k 字符 | 任何默认都只能渐进读 |
| `index.vue` ~77k | 64k 仍装不下整入口，却容易诱使「多塞一点垃圾」；24k 更明确是摘录 |
| 功能 composable 10k–16k | 24k 单包 ≈ task+地图+**一个功能面的核心摘录**，符合 light 修 bug |
| 用户觉得 64k 大 | 默认从俭；需要时再配置宽裕档 |

**永久契约锁机制；24k/4k/6k/8k/48k 为默认起点，可配置，可被 benchmark 微调。**

## 最终流程总览（一页串起来）

状态：设计总图草稿，供人审与继续质询；**不是**已批准产品契约，**不是**实施授权。

### 你日常怎么用（人视角）

```text
你说话（修 bug / 改功能 / 「今天这批」/ 「不用 Latch」）
    │
    ├─ 不用 Latch ─────────────────────────────► 普通改代码，不建 task
    │
    ├─ 「今天这批…」───────────────────────────► 建/复用 group（wave 标签）
    │
    └─ 有写入/修复意图 ────────────────────────► 可建 task 记录意图
                                                   │
                                         信息够不够？
                                          │         │
                         不够 / 要猜方案 ◄┘         └► 够且精确低风险
                                │                         │
                                ▼                         ▼
                     grill / open_questions          light + 请求即授权
                     不实施用户可见改动              （scope 钉死）
                                │                         │
                     高风险或需设计取舍 ──► standard：展示 plan → approve
                                │                         │
                                └────────────┬────────────┘
                                             ▼
                                  读 context pack → 改代码 → verify
                                             │
                              submit → review（必须停）
                                ├─ 不满意 → 同 task 回 dev
                                └─ 用户明确认可归档 → done
                              已归档回归 → 新 light 软关联旧 id
```

### 三种「东西」各管什么

| 东西 | 是什么 | 不管什么 |
|---|---|---|
| **task** | 可写工作单元；有 revision、证明包、生命周期 | 不负责「这批活的总批准」 |
| **group / wave** | 只读标签，列表过滤、数进度 | 无锁、无 approve、无 verify 集合 |
| **模块知识文档** | Git 里「现在怎么工作」 | 不替代源码/测试；不替代 task 历史 |
| **context pack** | AI 偶尔打的一箱开工材料（默认 ~24k 字符） | 不是聊天总上限；你不用每条消息先算 |

### 一条 light 小 bug 最小路径

1. 你说清修什么（最好带精确改法）。  
2. AI 建 light task；delta 合格则 **请求即授权**（scope 钉死）。信息不够则 grill，不实施。  
3. 打一包 context（task + 地图/短知识 + 相关摘录），不够再扩读。  
4. 改代码 → **至少一次 named verify**（check）。  
5. `submit`：声明 knowledge impact（多数小修 `none + reason`）→ **进入 `review`，必须停下**。  
6. 你不满意 → **同一 task** 回 dev 再改（不是新开归档回归 task）。  
7. 你**明确说可以归档 / done** → 才 `done`。AI **不得** submit 后自动 done。  
8. Core 缺证明包字段会硬拒绝 submit/done；缺明确归档授权不得 done。

```text
请求即授权 → dev → named verify/check → submit/review
                                      ├─ 不满意 → 同 task 回 dev
                                      └─ 明确认可归档 → done
```

你通常**不必**说：要不要建 task、有没有多个 bug。  
你**值得说**：这批挂 wave、这次不用 Latch、同一根因、还是复现、顺便扩 scope。

### 多 bug / 多对话怎么走

| 场景 | 怎么走 |
|---|---|
| 一条条丢给不同对话 | 每对话各自 light；可挂同一 group |
| 一个对话连续多个独立 bug | 多张 light 顺次做；或同对话共同批准时用有条件 batch item |
| 其实同一根因 | 合并一张 task |
| 同模块可能撞文件 | 仍各 task；建议串行或 worktree；override 标 mixed |
| 预知一批但清单不稳 | 先 group，做到哪建到哪 |

**硬底线：** 多对话不共写一张 task。

### 知识怎么进出

```text
实施中/submit
    → 声明 knowledge_impact
         ├─ none + 非空 reason（只影响本次、不改 contract）
         └─ 更新 Git 模块文档（delta，不是重写全书）并关联 task

读代码前
    → 短知识（若有）+ 结构地图 + 按功能摘录源码
    → 文档 stale / 无文档：标明，不装成当前事实
    → 检索工具挂了：rg + 直接读
```

历史（当时为何改）在 **archive**；当前约定在 **Git 文档**；对错最终靠 **源码和测试**。

### 谁强制、谁判断（一句话）

- **Core：** phase/revision、证明包齐不齐、writer affinity、截断预算、有没有 knowledge 声明。  
- **Skill：** 建不建、light 还是 standard、delta 是否合格、挂哪个 group、读哪些文件。  
- **Git 文档：** 模块知识正文。  
- **可选 adapter：** CodeGraph 等；失败降级。

### 和现有 v2 的关系（总图级）

- 保留：task、events、四 phase 骨架、approve/verify/submit/done、`.latch` 持久真源。  
- 增强（设计中）：light profile、group、证明包硬门禁、请求即授权、knowledge impact、context pack、writer affinity。  
- 不恢复：v1 knowledge DB、默认向量/RAG、日常删 `.latch` 重建。  
- 迁移：**原地兼容演进**（见模糊点收口）；禁止日常删 `.latch` 重建。

### 模糊点收口（一步到位契约，不靠以后修修补补改产品模型）

用户取向：**最终用户体验与产品模型一次设计完整**；实施可分批，但每批服务同一契约，避免「用着用着发现模型不对再打补丁」。  
诚实边界：对不对只能靠长期使用验证；契约要写清**失败时怎么降级**，不能假装已经证明最优。

#### 原 7 点 → 收口决定

| # | 原模糊点 | 收口 |
|---|---|---|
| 1 | 精确/低风险 / 够不够做 | **已写判定表**（上节 A–E）。borderline 默认问一句。 |
| 2 | 自动建 light 太碎 | **收缩触发面**：仅当请求将导致**仓库写入或明确修 bug/改行为**时自动建；纯问答、只读探索、格式讨论**不建**。用户说「不用 Latch」本轮跳过。一行无关紧要的本地实验可 retrospective，但不得伪造先批准。 |
| 3 | light 与四 phase | **同一四 phase；light 可压缩 plan/approve 往返，不可折叠 review**。create 可带 intent+authorization 快进 dev/check；`submit` **必须**进入 `review` 并等待用户；仅用户明确归档授权后 `done`。禁止「gates 绿就自动 done」。与 v2 PRD「用户反馈是主流程」及 HANDBOOK submit→review 一致。 |
| 4 | group UX | **最小可用即最终最小集**：`group_id` 字符串 + `list --group` + context 只读兄弟摘要（标题/phase/路径）。不建 group 状态机、不建依赖图、不做 group approve。创建：用户口头 batch 名或 AI 建议 `wave:日期-主题`，写入各 task 字段。 |
| 5 | 两 task 同文件 | **不引入跨 task 文件锁**（避免核心膨胀）。强制：skill 在开工前做路径重叠提示；冲突时建议串行/worktree/override；override → `provenance: mixed`。两 task 同文件并行是**允许但脏**，不是静默正常路径。 |
| 6 | none+reason 废话 | **reason 最低质量**：必须回答「为何不进模块文档」且**具体**（例如「仅改按钮 disable，contract 未变」）。Core 只校验非空；Skill/审查拒绝纯套话（「无」「n/a」「小改」单独一词）。同一 wave 内多张 none 可在 wave 末可选补模块文档一次。 |
| 7 | batch vs 多 light | **默认多 light**。仅当**同一对话、同一条消息或紧邻确认中，用户一次给出多项且要求一起做/一起批**时用有条件 batch item。跨对话或条目分开发送 → 禁止 batch，只用 group。 |

#### 迁移（一并钉死）

- **原地兼容演进**：保留 `.latch` task/events/archive；新字段可选；失败则停，**不删** `.latch`。  
- **primary_writer 不得用错误默认「补齐」**：不可继承 `*:default`；不可静默 first-writer-wins。  
- 旧 open task → `legacy_unclaimed`；**禁止静默 first-writer-wins**；「继续/接手指定 task」+ 合法 session actor 即为 claim 授权（回显绑定、不二次确认、非实施批准）；批量须明示批量。  
- 旧 archive 只读，不补 writer。  
- 旧事件 actor 字符串只作历史 provenance。  
- 旧 `state.json` current **不**自动映射到新 session actor。  
- 导出清空重建仅灾难恢复，非日常。

#### 功能延伸 vs 收缩（最终模型边界）

**纳入最终契约（做）：**

- light profile + 证明包硬门禁  
- 请求即授权 + 判定表 + 信息不足 grill  
- group/wave 只读聚合  
- writer affinity（**会话级 actor fail closed**）  
- knowledge impact + Git 模块知识 + freshness 机制  
- context pack 预算与渐进读取  
- CodeGraph 等可选 adapter + 强制 freshness/降级  
- worktree 重叠建议与 mixed provenance  
- retrospective 但不伪造批准史  

**明确不纳入默认产品（收缩/永不作为默认）：**

- v1 knowledge DB / card / 自动 scaffold 门禁  
- 独立 change receipt 类型  
- batch item 级独立 revision 作为默认  
- group 级批准/验证状态机、task 依赖图  
- 默认向量 RAG / Graphiti / 重型 GitNexus 必装  
- 跨 task 分布式文件锁  
- 完整聊天存档为真源  
- 日常删除 `.latch` 重建  

**实施分批，模型不分叉：**

- Slice 可按：证明包与 light → group → knowledge impact → context pack → adapter。  
- 禁止「先做一个临时模型，以后再推翻」的过渡契约。

#### 如何知道「对不对」

| 能提前证明的 | 只能长期用才知道的 |
|---|---|
| 结构门禁（缺字段就失败） | 自动建是否仍烦 |
| 多对话不共写（revision 冲突可测） | 判定表松紧是否合手 |
| pack 截断与字符预算 | 24k 是否常不够/太紧 |
| 文档与 CLI 契约一致 | 知识页愿不愿意维护 |

验收策略：契约一次定全 → 分 slice 实现 → **观察期真实 task** 收集摩擦 → 只允许**参数/文案/启发式**微调，不允许悄悄换产品模型；若必须换模型，开新设计 task，不打补丁式扭曲旧语义。

### 建议你怎么审收口结果

- 判定表 A/B/C 有没有哪条会逼你烦或仍会放跑瞎做。  
- 收缩清单有没有你其实想要的能力被砍掉。  
- 延伸清单有没有你觉得一步到位里不该承诺的。  


## 最终契约目录与实施 slice（草案）

状态：在 actor 责任拆分锁定后进入整理；**仍非 approve / 非实施**。

### 契约文档建议结构（一步到位模型）

1. **目标与非目标** — 可追溯、轻 bookkeeping、知识/历史分真源；不承诺零遗漏低 token。
2. **对象模型** — task、events、group、模块知识文档、context pack、actor 声明。
3. **生命周期** — 四 phase；light 压缩 plan/approve；**submit→review 必停**；done 仅明确归档。
4. **授权与质询** — 判定表 A–E；请求即授权；open_questions 阻塞实施。
5. **多对话与并发** — 独立写单元；group 只读；writer affinity + fail closed actor；claim / 非对称 takeover；worktree 重叠规则。
6. **证明包与验证** — intent/authorization/proof/knowledge_impact；Core 硬拒绝。
7. **知识** — impact、Git 文档、freshness、迁移表；不恢复 v1 knowledge DB。
8. **上下文与检索** — 渐进读、24k 默认 pack、adapter 可降级、benchmark 够用标准。
9. **Core / skill / 文档 / adapter** — 含 actor：adapter 保真、Core 验声明。
10. **CLI 与 skill 命令面** — 写路径前提、takeover、list --group 等。
11. **迁移与回退** — 原地兼容；禁止日常删 `.latch`；**legacy_unclaimed +「继续指定 task」claim（B 收紧）**；state current 不自动映射。
12. **验收与观察期** — 结构可测项 vs 长期合用手感；只调参数不换模型。

### 实施 slice 顺序（模型不变，交付分批）

| 顺序 | Slice | 交付要点 | 依赖 |
|---|---|---|---|
| S0 | Actor session fail closed + legacy claim + takeover | canonical 解析；写拒绝 default/client；只读收紧；skill 设 `LATCH_ACTOR`；primary_writer；legacy claim（继续指定）；**非对称 takeover**（明确接手直接转，普通继续先确认）；archive/state 迁移规则 | 无 |
| S1 | Light 证明包 + review 必停 | profile/字段；submit→review；done 需明确授权；证明包硬拒绝 | S0 |
| S2 | 判定表与请求即授权 | skill 规则 + open_questions 与 approve 门禁对齐 | S1 |
| S3 | Group 最小集 | `group_id`、list 过滤、兄弟只读摘要 | S1 |
| S4 | Knowledge impact | submit/done 声明；none reason；文档关联 | S1 |
| S5 | Context pack helper | 预算截断、来源、扩读；先 rg，CodeGraph 可选且 freshness | S1 |
| S6 | 模块知识约定与 freshness | frontmatter/covers；stale 标记；迁移表模板 | S4–S5 |
| S7 | 文档与 PRD 替换 | 最终 PRD 取代 v2 冲突条款；HANDBOOK/skill 同步 | 前置 slice 稳定后 |
| S8 | 观察期 | 真实 task 摩擦日志；仅参数/启发式微调 | S7 |

禁止：先做「临时可写 default」再指望 S0 补救。S0 与 light 语义应尽早落地，否则多对话硬底线仍是空的。

### 已产出：Actor PRD 草案节

- 路径：`docs/prd/2026-07-15-latch-actor-writer-affinity-draft.md`
- 状态：**Revision 2 已接受为最终 PRD 的 Actor 章底稿**（design-accepted；仍非产品 approve / 非实施授权）
- 覆盖：canonical actor、fail closed、primary_writer、legacy_unclaimed（仅字段缺失）、claim、非对称 takeover、task.json 提交点非事务、use 须 session actor 且不授写权、批量 claim 逐 task 部分成功、迁移与 v2 废止点
- 复审：提交点与 v2 非事务一致；非法 primary 报 schema error；无 default state 污染路径

### 已产出：Light / 证明包 PRD 草案节

- 路径：`docs/prd/2026-07-15-latch-light-proof-package-draft.md`
- 状态：**Revision 5 design-accepted**（最终 PRD 本章底稿；**非**产品 approve / 非实施 / 非最终 PRD 全文批准）
- 覆盖：light/retrospective 生命周期、revision 分流、proof 矩阵、legacy patch、blocked/review/done、knowledge_impact 硬门禁



### 加速收口产出（2026-07-15）

**跨章 P1 核验：通过**（2026-07-15）。**用户确认完整设计 OK**（2026-07-15）：最终契约候选 **design-accepted**。暂不切换 INDEX/current，不改产品代码；升 current 另行授权；代码实施另开 task 并单独 approve。后续仅从迁移章 §7 C1–C8 派实施 checklist，不再新增产品设计。本设计 task 仍在 plan：用户说归档/done 仅为授权意图，须先 approve→verify→submit→review 后才能 latch done；等待正式文档或实施授权时保持 plan 正确。



跨章审阅 **7 个 P1** 修复（r2 轮）：触发章新建；知识 freshness 基线；Context 可计数/可复现；迁移回退 R1/R2；发布边界；措辞「同时仅 primary」；v2 为基础+覆盖。



- 知识：`docs/prd/2026-07-15-latch-knowledge-freshness-draft.md`（candidate r1）
- Context：`docs/prd/2026-07-15-latch-context-benchmark-draft.md`（candidate r1）
- 迁移/CLI：`docs/prd/2026-07-15-latch-migration-cli-draft.md`（candidate r1）
- 最终入口：`docs/prd/2026-07-15-latch-final-product-contract-draft.md`（拼装 + 完成标准；**非** current）
- Actor/Light/Group：design-accepted，跨章审阅不重开除非硬冲突
- 完成标准：完整 PRD 入口+分章、无悬空契约、open_questions 已清已决、v2 替换明确；**非** 70% 体感
- 下一步：一次跨章一致性审阅 → 用户确认完整设计 → 另授升 current / 实施 task

### 已产出：Group 最小集 PRD 草案节

- 路径：`docs/prd/2026-07-15-latch-group-minimal-draft.md`
- 状态：**Revision 1 design-accepted**（**非**产品 approve / 非实施）
- 覆盖：group_id、list 过滤、只读兄弟摘要、无 group 门禁


### 仍不在本目录展开的内容

- 产品代码实现（需单独 approve）
- CodeGraph 升级/重建（需单独授权）
- 最终 PRD 其余章（知识 freshness、context pack、迁移与 CLI 总表等）

## 当前仓库状态

- 当前 task：`20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1`；
- 当前 phase：`plan`；
- 当前 task 尚未 approve；
- 另有两张 open task，分别处于 `review` 和 `check`，不得合并或清理；
- 工作区已有 `docs/HANDBOOK.md`、`src/core/task-view.ts` 和 `tests/cli-base.test.mjs` 的用户改动；
- 本 task 当前只允许设计讨论、task 记录和交接文档，不允许产品实现、外部 repo 写入、工具升级或 Git 操作。

## 交接完成标准

新窗口能够仅通过当前 task、artifact、本文和当前产品文档恢复以下内容：

- 产品目标和用户痛点；
- 已确认决定及其理由；
- 已撤回方案和反例；
- CodeGraph stale 的证据与未授权边界；
- 多对话处理 bug 的真实工作方式；
- **最终流程总览**（人路径、light/standard、group、知识、context pack、Core/Skill）；
- 总图上仍虚的点与下一项质询焦点。
