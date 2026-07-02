# 梳理 Latch 当前流程与拆分计划

Source-Task: 202607020836-梳理-latch-当前流程并规划拆分

## 背景

- Latch 现在已经不是只管 `start/save/next/done` 的小 CLI 了。它同时管任务状态、actor 隔离、阶段门禁、验证记录、知识卡、artifacts 指针，以及给 AI 看的续接输出。
- 对用户来说，这些能力已经能串成完整流程；但实现上大多还压在 `src/cli.ts` 一个文件里，测试也主要堆在 `tests/cli.test.mjs` 一个文件里。
- 现在 `src/cli.ts` 和 `tests/cli.test.mjs` 都已经 1200+ 行。继续加功能当然还能跑，但会越来越难回答三个问题：现在主流程到底是什么、哪段逻辑归谁管、改一处会不会连带别处一起抖。

## 目标

- 用大白话梳理 Latch 当前对用户的完整流程和规范。
- 把当前实现按职责拆开，说明每一块现在是怎么工作的。
- 判断当前设计和实现哪些地方是合理的，哪些地方已经开始挤。
- 给出一个能落地的拆分顺序，减少“只是把大文件搬成多个小文件”的假拆分。

## 不做什么

- 不在这份 brief 里直接改代码。
- 不设计新能力，比如 dashboard、全局知识库、自动 commit 或项目扫描。
- 不一次性重写 CLI 参数解析或状态机。
- 不同时拆 `cli.ts` 和测试文件。

## 方案

### 1. 用户视角：现在 Latch 的主流程怎么走

可以把 Latch 理解成“给 AI 任务上轨道”的东西。

主流程只有一条：

1. 任务够小，只记 `log`
2. 任务一旦进入 Latch，就先 `checkpoint` 或 `start`
3. 之后按阶段往前推：`triage -> plan -> dev -> check -> finish`
4. 到 `check` 必须用 `verify` 记真实验证结果
5. 到 `finish` 只等用户确认
6. 用户明确说收尾或归档，才 `done`

如果用一个生活里的比方：

- `checkpoint` 像“先把现场拍照留底”
- `save` 像“补充这次任务卡片上的字段”
- `next` 像“把任务从一个工位推到下一个工位”
- `verify` 像“质检盖章”
- `done` 像“归档入库”

### 2. 现在的规范是什么

Latch 现在实际有三层规范，而且分工是清楚的：

1. **状态文件**
   - `.latch/tasks/<id>/task.json`
   - 放结构化状态：阶段、目标、验收、knowledge 决策、artifacts、latest_verify

2. **过程记录**
   - `.latch/tasks/<id>/notes.md`
   - 放人和 AI 要读的过程文字，比如 brainstorm、grill、finish closure

3. **正式文档**
   - `docs/briefs/` / `docs/prd/`
   - 放给人读的稳定说明，不塞回 `.latch/`

这套分层是合理的。它解决的是一个很实际的问题：  
**运行时状态、聊天过程、正式方案，不是同一种东西。**

### 3. 当前项目里到底是怎么实现的

现在的实现基本可以分成六块，只是还都挤在 `src/cli.ts`：

#### A. 状态和文件系统

- `ensureInit`
- `state`
- `currentTaskId` / `writeCurrentTaskId`
- `readTask` / `saveTask` / `createTask`
- `archiveTask`

这块负责把 `.latch/` 当成一个很小的本地数据库来用。

大白话说，就是：

- `state.json` 管“谁现在手上拿着哪张任务卡”
- `task.json` 管“这张任务卡本身写了什么”
- `notes.md` 和 `events.jsonl` 管“过程里发生过什么”

#### B. actor 和所有权

- `actorId`
- `claimTask`
- `ensureTaskOwnedByActor`
- `targetTask`（物理留 cli.ts：它依赖 `option('--task')` 和 args，跟 store/ownership 都不纯靠近）

这块是 Latch 比一般单机小工具更像“给 AI 用”的地方。

它解决的问题是：  
**同一个项目里，不同 agent 不能抢同一张 current task。**

所以现在的规则是：

- 每个 actor 有自己的 current task
- task 自己还会记录 owner
- 想接手别人的任务，要显式 `--force`

这个设计是合理的，而且是 Latch 现在最有辨识度的一部分。

#### C. 阶段门禁

- `advanceBlockers`
- `defaultNext`
- `canAdvance`
- `ensureDoneReady`
- `scaffoldForStage`

这块是 Latch 的“交通灯”。`progressSummary` 属输出组装，归 D / task-view，不在这里。

比如：

- `triage -> plan` 至少要有 `goal` 或 `next`
- `plan -> dev` 要有 `next`
- `check -> finish` 必须最近一次 verify 是 `pass`
- 文档类任务可以从前面阶段直接 `--to finish`

这套门禁总体是合理的，因为它不是追求完美流程，而是在关键处拦一下，防止 AI 跳步。

#### D. 命令参数和人读输出

- `option` / `optionAll`
- `checkpointTitleArg`
- `formatArtifacts`
- `progressSummary`
- `taskContext`
- `commandUsage`
- `knowledgeUsage`

这块负责两件事：

1. 从命令行里把值抠出来
2. 把任务状态压成适合人和 AI 读的输出

`resume --brief`、`context --json`、`list --json` 这些能力，都是这里撑起来的。`formatEvent` 跟 `event`/`recentEvents` 一伙，已归 notes-events，不在这里。

它很重要，但现在和业务逻辑混在一起，后面最容易越改越缠。

这里其实还混了两种东西：

- 一种是参数解析和任务输出
- 另一种是 help/usage 和子进程环境

后面真拆的时候，不该再把它们继续揉成一团。

#### E. knowledge / artifacts

- `buildKnowledgeMeta`
- `readKnowledgeCard` / `writeKnowledgeCard`
- `recallKnowledge`
- `verifyKnowledgeCards`
- `writeModuleCards`

这块现在已经不是小尾巴了，而是独立子系统。

它做的事包括：

- 记录 knowledge 决策
- 生成知识卡
- 从任务里回写 `knowledge_card` artifact
- 按文件 / 关键词 / 模块召回
- 校验知识卡引用是否还有效

换句话说，Latch 现在已经有：

- “任务状态机”
- “项目内知识卡系统”

这也是 `cli.ts` 变胖的主要原因之一。

#### F. 顶层命令分发

`switch (command)` 这一大段，负责把所有能力接起来。

现在的问题不是它“写错了”，而是它同时承担了：

- 路由
- 参数解释
- 业务规则
- 文件读写
- 输出格式化

所以一旦命令再变多，`switch` 会越来越像总控室，什么线都往这里接。

### 4. 当前设计和实现是否合理

#### 合理的地方

1. **产品边界是清楚的**
   - 不做 dashboard
   - 不做自动 commit
   - 不做外部知识库同步
   - 不把 notes 当结构化输入

2. **状态和文档分层是对的**
   - `task.json` 管机器读
   - `notes.md` 管过程
   - brief / PRD 管正式说明

3. **actor 隔离是对的**
   - 这直接解决多 agent 最容易互抢的问题

4. **`verify` 和 `done` 分开是对的**
   - 先证明做完，再等用户确认归档
   - 不把“验证通过”“提交代码”“归档任务”混成一步

5. **`resume --brief` / `context --json` 很实用**
   - 这不是花活，是 AI 续接真的会用到的稳定出口

#### 已经开始挤的地方

1. **`cli.ts` 职责太多**
   - 既是入口
   - 又是状态层
   - 又是阶段机
   - 又是 knowledge 子系统
   - 还是输出层

2. **测试文件不是“长”，而是“混”**
   - 文档护栏
   - help 副作用
   - 主流程
   - actor
   - lock
   - knowledge
   - log
   - grill / finish scaffold
   - context/list/resume JSON
   - checkpoint 回归  
   全都在一个文件里。

3. **参数解析还是偏手工**
   - 现在靠 `option`、`optionAll`、`firstPositionalArg`
   - 这对当前规模还能扛
   - 但命令继续长下去，新增 flag 会越来越容易互相踩

4. **阶段规则本身在代码里算是集中，但例外路径开始变多**
   - 真正规则主干其实集中在 `advanceBlockers`
   - 文档是在解释口径，测试是在兜住行为
   - 现在的问题不是“散了”，而是以后继续加例外时，得守住这份集中度

5. **锁模型很简单，但对 AI 并行操作不够友好**
   - 对人手敲足够
   - 对 agent 来说容易撞 `.lock`

### 5. 应该怎么拆，才不是假拆分

我建议先拆 `src/cli.ts`，而且按“职责”拆，不按“命令名”拆。

#### 第一阶段：先抽底座，不改行为

先抽这些最稳定的基础块：

- `src/core/task-store.ts`
  - `ensureInit`
  - `state`
  - `currentTaskId`
  - `writeCurrentTaskId`
  - `readTask`
  - `saveTask`
  - `createTask`
  - `archiveTask`
  - `currentTask`
  - `targetTask`（如果拆出来后不造成 ownership 倒挂；不稳就先留在 `cli.ts`）

- `src/core/ownership.ts`
  - `actorId`
  - `claimTask`
  - `ensureTaskOwnedByActor`

- `src/core/notes-events.ts`
  - `event`
  - `formatEvent`
  - `recentEvents`
  - `appendNotes`

这一阶段的目标不是“更优雅”，只是先把最容易复用的底座从 `cli.ts` 抽出来。

#### 第二阶段：抽状态机

- `src/core/progress.ts`
  - `advanceBlockers`
  - `defaultNext`
  - `canAdvance`
  - `ensureDoneReady`
  - `scaffoldForStage`（它本质上是“进入某阶段时写什么模板”，别过早塞进 notes-events）

这一步很关键，因为它把“阶段规则”从命令分发里挪出来了。

#### 第二阶段补一层：任务视图 / 输出组装

- `src/core/task-view.ts` 或同类名字
  - `taskContext`
  - `progressSummary`
  - `formatArtifacts`
  - `commandUsage`
  - `knowledgeUsage`
  - `commandEnv`

这层专门负责“把状态拼成给人和 AI 读的东西”，别和纯规则函数继续缠在一起。

#### 第三阶段：把 knowledge 独立成子系统

- `src/core/knowledge.ts`
  - frontmatter 解析
  - 知识卡读写
  - recall
  - verify
  - module cards

`applyFieldOptions` 不放进这里。它本质上是 task 字段写入入口，knowledge 只是它处理的一部分；而且它依赖 `option`/`args`，留在 cli.ts 参数层，待后续随参数解析一起处理。

原因很简单：  
**knowledge 现在已经是一套子系统，不该继续像附属功能一样夹在主流程里。**

#### 第四阶段：最后再瘦身命令分发

到这一步，再把 `switch (command)` 收成薄入口。

理想状态是：

- `cli.ts` 只做参数入口和命令路由
- 业务逻辑在对应模块里

### 6. 测试怎么拆更稳

测试不要按“文件一半一半剪开”，要按关注点拆。

建议顺序：

1. `tests/cli-flow.test.mjs`
   - start / checkpoint / next / verify / done 主流程

2. `tests/cli-knowledge.test.mjs`
   - generate / recall / refresh-modules / verify

3. `tests/cli-actors.test.mjs`
   - actor / owner / force / current task

4. `tests/cli-query.test.mjs`
   - resume / context / list / json 输出

5. `tests/cli-guards.test.mjs`
   - help 无副作用
   - lock
   - malformed 参数
   - 文档护栏

6. `tests/cli-log.test.mjs`
   - log 相关 5 个用例

另外，`grill` / `finish` scaffold 更像阶段行为，适合放进 `cli-flow.test.mjs`，不要漏掉。

这样拆的好处是：  
以后改 knowledge，不用每次在 1200 行文件里找它那一小堆测试。

## 验收

- 能用一段大白话说明 Latch 当前主流程和规范，不需要先读代码才能明白。
- 能明确指出 `cli.ts` 当前至少有 5 个职责块，而不是简单说“文件太长”。
- 给出先拆 `cli.ts`、后拆测试的顺序，并说明为什么。
- 给出具体拆分边界，而不是只说“模块化”“重构一下”。
- 这份 brief 本身能作为下一张“开始拆分”任务的输入。

## 风险

- **先写 brief 不会自动变成好结构**：如果后面拆分时只是把函数挪文件，不顺手理清依赖，复杂度还是原样搬家。
- **按职责拆会碰到循环依赖**：尤其 `targetTask`、`taskContext`、`progressSummary`、`resume/context` 之间，拆的时候要刻意让“读状态”和“拼输出”分层。
- **测试拆分容易把共享 setup 复制一遍**：可以先保留一个 `run()` 帮助函数，不急着抽测试工具层。
- **现在先不动参数解析器**：这是有意收范围，不代表它已经是长期最优。

## 进度

- 2026-07-02：抽底座和状态机。`src/core/` 下 types/paths/utils/ownership/task-store/notes-events/progress/task-view 八个模块；`claimTask` 改签名收 `force` 解 args 依赖；`targetTask` 留 cli.ts。cli.ts 1308→820 行。77 测试绿。
- 2026-07-02：抽 knowledge 子系统。`src/core/knowledge.ts`（15 个函数）；`buildKnowledgeMeta`/`recallKnowledge` 改签名收参数解 args 依赖。cli.ts 820→563 行。77 测试绿。
- 2026-07-02：抽输出函数。`printResume`/`printContext`/`printList` 进 task-view，switch 的 resume/context/list case 瘦身。start/use 等编排留 switch。cli.ts 563→463 行。77 测试绿。
- 2026-07-02：拆测试。`tests/cli.test.mjs`（1287 行）按关注点拆成 cli-guards/cli-flow/cli-knowledge/cli-actors/cli-query/cli-log 六个文件，run helper 抽到 `tests/helpers.mjs`。测试 77 个不变。拆分全部完成。
