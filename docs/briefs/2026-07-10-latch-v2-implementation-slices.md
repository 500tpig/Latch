# Latch v2 分窗口实施计划

Source-Task: 202607090959-根治-latch-漏触发与重复修补

Source-PRD: docs/prd/2026-07-10-latch-v2.md

Status: approved

Date: 2026-07-10

Revision: 2

Revised: 2026-07-11

Approved: 2026-07-12

Review-Task: 202607101647-修订-latch-v2-契约并补强-slice-1-故障恢复

## 1. 目的

本文件把 Latch v2 拆成可由多个新窗口顺序接手的实施 slice。

约束：

- 同一个 Latch repo worktree 同时只允许一个 implementation task；
- slice 必须顺序执行，不并行修改同一 worktree；
- 当前只实施 Latch repo；
- 未经用户后续明确确认，不修改全局 CLI/skill、Latch-Board、appearance-sec、monitoring；
- 不删除当前 v1 `.latch`；
- 不创建 v1 migration 或兼容层；
- 每个新窗口先读取 PRD 和本 slice，再读取相关代码；
- 不顺手实现后续 slice；
- 每个 slice 完成后停在 review，等待用户反馈。

## 2. 执行前固定规则

### 2.1 当前阶段

Revision 2 已于 2026-07-12 获用户确认。原 Slice 1 task 与故障恢复 follow-up 已归档。

Slice 2 task `202607111802-实现-latch-v2-基础-cli-与-json-契约` 已经用户确认并归档。

Slice 3 task `202607111838-实现-latch-v2-批准-开发占用与反馈返工` 已经用户确认并归档。

Slice 4 task `202607111853-实现-latch-v2-验证-提交与归档流程` 已经用户确认并归档。

Slice 5 task `202607111910-删除-latch-v1-runtime-并切换正式入口` 已完成实现与完整回归，当前停在 review：

- 正式 `src/cli.ts` 和 `dist/cli.js` 已切换为 v2；
- v1 CLI、stage、owner/force、notes/knowledge runtime 和旧测试已删除；
- lifecycle 与 view 使用最终文件名，actor 识别保留为独立模块；
- TypeScript 已启用 `noUnusedLocals` 和 `noUnusedParameters`；
- 保留 `cli-base`、`lifecycle`、`review`、`store` 四组 v2 契约测试，共 49/49；
- 当前 `.latch`、全局 CLI/skill 和外部 repo 未修改。

用户确认并归档 Slice 5 前，不开始 Slice 6。

### 2.2 Review 修订决定

本轮采用以下决定：

- 每张 implementation task 单独获得 direct approval；首版删除父 slice 继承批准；
- dev、check、review 都占用 worktree，blocked 不释放占用；
- 并发 approve 使用 workspace 级短锁；
- plan verification 是 gate 真源，命令保存为 argv；
- no-verify 仍需先批准并进入 dev；
- task.json 是当前真源，event/state 是可检查、可修复的历史或索引；
- v2 CLI 先使用独立入口，避免 Slice 2–4 破坏当前全局 v1 CLI 和完整回归。

不采用：

- 通用事务框架；当前问题可以通过提交点、warning 和恢复规则解决；
- 因文件长度立即拆分全部 v1/v2 store；当前没有第二个真实使用方，也会增加过渡 diff；
- 为父 slice 授权增加任务树或跨 task 失效传播。

### 2.3 验证原则

- 每个 slice 先运行本 slice 的最小测试；
- 每个 slice 完成前运行 `pnpm check` 和 `git diff --check`；
- v2 CLI 测试调用 repo 内独立入口，不更新本机全局命令；
- 不把外部 repo build/test 纳入第一阶段；
- 故障恢复规则必须有可重复的临时目录测试，不能只写成未验证风险。

## 3. Slice 1：v2 schema、根目录与安全存储

### 3.1 目标

建立不依赖 v1 的 v2 数据底座，解决 ID 覆盖、子目录双 `.latch`、非原子写、全局锁和 revision 冲突问题。

### 3.2 主要写入范围

```text
src/core/types.ts
src/core/paths.ts
src/core/utils.ts
src/core/task-store.ts
src/core/notes-events.ts
新增或重写对应 tests
```

不要修改：

```text
外部 repo
全局安装
Latch-Board
业务文档
knowledge 之外的 CLI 命令行为
```

### 3.3 实现内容

- 定义 `TaskV2`、`TaskPlan`、`TaskPhase`、`TaskOutcome`、`VerifyResult`、`TaskArtifact` 和事件类型；
- 增加 `schema_version: 2`；
- state 只保留 actor current；
- 删除 owner 和 legacy current 字段；
- task ID 使用毫秒时间、slug 和随机后缀；
- ID 前缀解析后统一返回 canonical 完整 ID；
- Git repo 先确定 Git root，只在 cwd 到 Git root 之间发现 `.latch`，不跨 repo；
- 非 Git 目录可复用祖先 `.latch`，没有时只有 init 使用当前目录；
- JSON 临时文件 + rename 原子写；
- per-task lock 和独立 state lock；workspace lock 留到 Slice 3 首次真实使用时实现；
- task revision 和 `expectRevision` 校验；
- 所有写入前完成参数、schema 和 revision 校验；
- task event 记录 actor、revision 和时间；`use` 不生成 `current_selected`，revision conflict 不持久化 event；
- task 创建和更新以 `task.json` 为提交点，event 或 checkpoint current 写失败返回 warning；
- archive 以目录 rename 为提交点，state 清理失败返回 warning，stale current 不生效；
- 不创建 notes.md；
- open/archive 目录只支持 v2。

### 3.4 必须新增的回归测试

- 同一分钟同标题创建两张不同 task；
- 失败参数不留下空 task；
- 子目录 list 读取根 `.latch`；
- 子目录 checkpoint 不创建嵌套 `.latch`；
- 嵌套 Git repo 不使用父 repo `.latch`；
- unique prefix 写入 state 后保存完整 ID；
- archive 后 current 正确清除；
- archive state 清理失败时归档仍成功，stale current 不生效；
- event 追加失败时 task 创建/更新返回成功和 warning；
- checkpoint current state 写失败时 task 仍可按 ID 读取并返回 warning；
- revision 过期写入失败且文件不变；
- 不同 task 的锁互不阻塞；
- state lock 不影响 task 文件写；
- JSON 损坏错误包含路径；
- list/context 未初始化时不创建目录。

### 3.5 验收

```bash
pnpm build
node --test tests/v2-store.test.mjs
pnpm check
git diff --check
```

输出：

- 当前 schema 示例；
- 临时目录并发测试结果；
- 未覆盖风险。

### 3.6 新窗口交接提示

```text
继续 Latch v2 父计划的 slice-1-storage。
只实现 docs/briefs/2026-07-10-latch-v2-implementation-slices.md 的 Slice 1。
先读 docs/prd/2026-07-10-latch-v2.md 的 schema、并发、root 和错误处理章节。
不得修改全局安装、Latch-Board、appearance-sec、monitoring 或当前 v1 .latch。
完成后运行本 slice 验证并停在 review。
```

## 4. Slice 2：CLI 参数解析与基础命令

Implementation-Task: 202607111802-实现-latch-v2-基础-cli-与-json-契约

Implementation-Status: review

### 4.1 目标

用 `node:util.parseArgs` 建立独立 v2 CLI 入口，删除创建/更新混合语义和静默 flag，同时保持当前 v1 CLI 与完整回归可用。

### 4.2 前置条件

- Slice 1 已通过 review；
- v2 store API 已稳定；
- 用户未要求修改 PRD 命令面。

### 4.3 主要写入范围

```text
src/cli-v2.ts
src/core/task-view-v2.ts
必要的 CLI parser/helper 文件
基础命令 tests
```

### 4.4 实现命令

```text
init
checkpoint
use
list
context
save
```

### 4.5 行为

- v2 独立入口的 unknown command/flag 非 0；
- checkpoint 永远创建；
- save 永远更新；
- use 只设置 current，不做 owner 接管；
- list/context 提供 human、JSON 和 brief JSON；
- JSON envelope 包含 `schema_version: 2`；每次 task 修改返回 previous revision、新 revision 和 warnings；
- checkpoint/save 使用完整 `--plan-file`；save 另支持 decision、artifact、block/unblock；
- 任一 plan 持久化值变化时增加 plan revision，并使 approval/gate/submission 失效；
- artifacts 使用相对项目根路径，支持添加、替换和移除；
- v2 入口不包含 start/resume/log/--new/--force；v1 正式入口暂不删除；
- 不实现 approve/verify/submit/done/abandon，留给后续 slice。

### 4.6 测试

- help 无副作用改成表驱动；
- checkpoint/create-only；
- save/update-only；
- use canonical ID；
- context current/explicit task；
- JSON schema version；
- decision 和 artifact_updated event；
- artifact add/remove；
- block/unblock；
- plan revision invalidation；
- unknown flag/command。

### 4.7 验收

```bash
pnpm build
node --test tests/v2-cli-base.test.mjs
pnpm check
git diff --check
```

### 4.8 新窗口交接提示

```text
继续 Latch v2 父计划的 slice-2-cli-base。
Slice 1 已完成，只实现 init/checkpoint/use/list/context/save 和 parseArgs。
不得提前实现 approve/verify/submit/done/abandon；v2 入口不包含 v1 命令，正式 v1 入口暂时保留。
完成后运行基础 CLI 测试并停在 review。
```

## 5. Slice 3：批准、开发占用与反馈返工

### 5.1 目标

实现 `approve`、plan/work revision 和单 worktree 单 implementation task。

### 5.2 前置条件

- Slice 2 已通过 review；
- 用户协议未变化。

### 5.3 主要写入范围

```text
src/cli-v2.ts
src/core/progress-v2.ts 或替代的 lifecycle 模块
src/core/task-store.ts 的查询接口
对应 lifecycle tests
```

### 5.4 实现内容

- plan approval 绑定 plan revision；
- plan -> dev；
- review directive correction -> dev；
- work revision 增加；
- 旧 gate/submission stale；
- workspace 短锁内完成占用扫描与 approve；同 workspace 已有 dev/check/review 时拒绝；
- 只支持 direct approval，不实现 inherited plan slice；
- plan change 自动回 plan；
- evaluative feedback 不写状态，由 AI 先问用户；
- feedback event 保存 classification 和 summary；
- 不增加 task hierarchy。

### 5.5 测试

- 没 approval 不能进入 dev；
- approval 绑定当前 plan revision；
- plan 改变使 approval 失效；
- review correction 保留 plan approval；
- work revision 正确增加；
- 两进程并发 approve 只有一张成功；
- 同 worktree 已有 dev/check/review 时第二张 task approve 失败；
- task 进入 review 后继续占用，进入 plan/done/abandoned 后释放；
- blocked 不释放实现占用；
- open_questions 非空时 approve 失败；
- plan 任一持久化字段变化后 approval 失效。

### 5.6 验收

```bash
pnpm build
node --test tests/v2-lifecycle.test.mjs
pnpm check
git diff --check
```

### 5.7 新窗口交接提示

```text
继续 Latch v2 父计划的 slice-3-approval。
只实现 approve、plan/work revision、feedback event 和单 worktree 开发占用。
不要实现 verify/submit/done，不改外部 repo。
完成后用临时目录覆盖首次批准、返工和冲突场景，停在 review。
```

## 6. Slice 4：命名验证、submit、done 与 abandon

### 6.1 目标

完成 v2 的验证、验收和归档主流程。

### 6.2 主要写入范围

```text
src/cli-v2.ts
lifecycle/progress-v2 模块
src/core/task-view-v2.ts
tests
```

### 6.3 实现命令

```text
verify
submit
done
abandon
```

### 6.4 行为

- verify 按 name 执行已批准 plan 保存的 argv，并保存当前 work revision 最新结果；
- gate/diagnostic 分离；
- 首次 verify 使 dev -> check；
- plan 中至少一项 gate，且全部有当前 work revision 的 pass 结果才能 submit；
- no-verify 只允许已批准后的 dev -> review，plan 不含 gate 且 reason 必填；
- submit 保存当前 submission 并进入 review；
- done 校验 review、当前 work revision、submission 和 gate/no-verify；
- done 固化 closure 并归档；
- abandon 保存 reason/outcome 并归档；
- CLI 不判断自然语言授权，但 skill 和文档写死协议；
- 删除 finish、done --all 和 knowledge gate；
- archive task 只保留 v2 JSON/events。

### 6.5 测试

- plan gate name 唯一且多个 gate 互不覆盖；
- 同名 gate 重跑；
- 任一 gate fail 阻塞 submit；
- diagnostic fail 不阻塞；
- work revision 改变后 gate stale；
- no-verify 必须已有 approval、plan 不含 gate 且 reason 必填；
- submission 绑定 work revision；
- done 拒绝旧 submission；
- done/abandon archive 清理 current；
- archive outcome 正确；
- verify command not found 记录明确错误。

### 6.6 验收

```bash
pnpm build
node --test tests/v2-review.test.mjs
pnpm check
git diff --check
```

### 6.7 新窗口交接提示

```text
继续 Latch v2 父计划的 slice-4-review。
只实现 verify/submit/done/abandon 和归档门禁。
严格按命名 gate、no-verify、review 和当前 work revision 规则；不要恢复 finish/knowledge/done --all。
完成后停在 review，不更新全局 CLI。
```

## 7. Slice 5：删除 v1 与重整测试

### 7.1 目标

彻底移除 v1 代码和被旧设计绑住的测试，保证源码只表达 v2。

### 7.2 删除范围

```text
src/core/knowledge.ts
knowledge types/fields
knowledge tests
log tests
resume tests
start tests
next/stage/scaffold tests
owner/force tests
v1 fallback 分支
未使用 export/import
```

根据 v2 最终结构决定是否删除或合并：

```text
src/core/ownership.ts
src/core/progress.ts
src/core/notes-events.ts
```

### 7.3 测试重整

保留核心关注点：

```text
store/concurrency
cli-base
approval/lifecycle
verify/review/archive
query/json contract
docs/skill guards
```

帮助命令、参数错误等重复用例改为表驱动。

不要以行覆盖率为目标。必须覆盖 PRD 的状态不变量。

### 7.4 静态检查

在 `tsconfig.json` 启用：

```json
{
  "noUnusedLocals": true,
  "noUnusedParameters": true
}
```

### 7.5 验收

```bash
pnpm check
git diff --check
```

要求：

- 无 knowledge/log/start/next/resume/finish/owner/force 字符残留于 runtime source；
- 无 v1 stage；
- 无未使用 import/export；
- runtime source 目标不超过约 1200 行，但不为行数牺牲清晰度。

### 7.6 新窗口交接提示

```text
继续 Latch v2 父计划的 slice-5-cleanup。
主流程已完成，本任务只删除 v1 能力、重整测试和启用 noUnused。
不要增加新功能，不改外部 repo，不更新全局安装。
完成后运行 pnpm test 并停在 review。
```

## 8. Slice 6：Latch repo 文档与 canonical skill

### 8.1 目标

让 tracked 文档只表达 v2，并建立唯一 skill 真源；仍不切换全局环境。

### 8.2 主要写入范围

```text
README.md
AGENTS.md
CLAUDE.md
docs/INDEX.md
docs/DESIGN.md
docs/HANDBOOK.md
docs/AI_INSTALL.md
docs/ARTIFACTS.md
docs/ADOPTER_SYNC.md
docs/briefs/
docs/templates/
skills/latch/SKILL.md
scripts/
package.json
```

### 8.3 实现内容

- README 改为个人 macOS 工具说明；
- AGENTS 只保留显式 Latch 入口、文档入口和项目开发规则；
- CLAUDE 只 `@AGENTS.md`；
- 新建 canonical `skills/latch/SKILL.md`；
- 删除 repo 内 `.agents/.opencode` Latch skill tracked 副本；
- 删除 skill docs 快照机制；
- `skill:link` / `skill:check` 只管理符号链接，但本 slice 不执行全局链接；
- HANDBOOK 只保留 v2 命令参考和示例；
- DESIGN 固化个人工具和非目标；
- AI_INSTALL 只写本机安装；
- ARTIFACTS 删除 knowledge 层，说明 docs/INDEX；
- SCENARIOS 删除或压缩为显式创建/继续/反馈三类示例；
- ADOPTER_SYNC 只保留当前兼容矩阵和第二阶段待同步状态；
- 完成/过期 brief 从 active INDEX 移除或标记 superseded。

### 8.4 验收

- canonical skill 源只有一份；
- tracked repo 无 skill 内容副本；
- docs/INDEX 链接有效；
- 文档不包含 v1 命令和 stage；
- 文档不包含本机绝对路径；
- `pnpm test` 中增加文档/skill guard；
- `pnpm check` 和 `git diff --check` 通过；
- 不执行 `skill:link`。

### 8.5 新窗口交接提示

```text
继续 Latch v2 父计划的 slice-6-docs-skill。
只重写 Latch repo 文档和 canonical skill，不执行全局链接，不修改业务 repo 或 Latch-Board。
以 docs/prd/2026-07-10-latch-v2.md 为唯一产品契约。
完成后运行文档 guard 和 pnpm test，停在 review。
```

## 9. Slice 7：第一阶段集成验收

### 9.1 目标

在不影响当前全局 v1 使用的前提下，验证 Latch repo 内 v2 已可发布。

### 9.2 验证方式

使用 `dist/cli.js` 和临时目录，完整跑通：

1. init；
2. 显式 checkpoint；
3. save plan；
4. approve；
5. verify 多个 gate；
6. submit；
7. review correction；
8. 重新 verify；
9. submit；
10. done；
11. plan change；
12. blocked/unblocked；
13. abandon；
14. revision conflict；
15. 两张不同 task 并行状态写；
16. 两进程并发 approve 只有一张成功，review/blocked 继续占用；
17. 子目录 root 发现；
18. Board JSON fixture 校验。

### 9.3 命令

```bash
pnpm check
git diff --check
```

另外运行一个临时目录 smoke script，不调用全局 `latch`。

### 9.4 交付给用户 review

- 变更摘要；
- 删除能力清单；
- 新命令示例；
- schema 示例；
- 测试结果；
- 未验证范围；
- 第二阶段切换步骤；
- 明确说明外部 repo 和全局安装仍未修改。

### 9.5 新窗口交接提示

```text
继续 Latch v2 父计划的 slice-7-integration。
不新增功能，只做 Latch repo v2 集成验收和用户 review 材料。
不得更新全局 CLI/skill，不得修改 Latch-Board、appearance-sec、monitoring 或任何现有 .latch。
完成后停在 review，等待用户确认是否进入第二阶段。
```

## 10. 第二阶段：用户再次确认后才执行

以下内容不属于当前第一阶段 implementation task，不提前创建任务。

### 10.1 切换全局环境

- 记录并保留可直接恢复的 v1 CLI commit 或安装路径；
- 记录当前全局 skill 和 Latch-Board commit；
- repo 外备份三个 v1 `.latch` 并校验；
- 更新全局 CLI；
- 创建 canonical skill 符号链接；
- `skill:check`；
- 初始化 Latch repo v2 `.latch` 并做 smoke test；
- 不立即修改业务 repo；任何一步失败时按 Board、skill、CLI、`.latch` 的相反顺序恢复。

### 10.2 更新 Latch-Board

- 删除旧 schema、knowledge 和 progress reducer；
- 消费 v2 JSON；
- 重做 plan/dev/check/review 流程图；
- 增加 plan/work revision、approval、feedback、submission 展示；
- 保持只读；
- 用户 review 后再处理业务 repo。

### 10.3 更新 appearance-sec

必须单独检查现有未提交改动，并由用户确认后：

- 备份/清理 v1 `.latch`；
- 删除项目内 Latch skill；
- 精简 AGENTS/CLAUDE；
- 新建 `docs/INDEX.md`；
- 初始化 v2；
- 不修改业务代码。

### 10.4 更新 monitoring

同 appearance-sec，单独确认、单独修改、单独验证。

### 10.5 观察期

三个项目累计跑满 10 个真实 v2 task，记录 PRD 成功指标。之后才讨论新能力或删除 v1 备份。

## 11. 分窗口协作规则

### 11.1 每个窗口只做一个 slice

不得在同一窗口顺手做下一个 slice。发现前置问题时：

- 在当前 task 记录；
- 如果属于当前 slice acceptance，修复；
- 如果改变 PRD，回父计划 review；
- 不自行扩大。

### 11.2 同一 worktree 不并行 dev

新窗口开始前确认上一张 implementation task 已进入 done、abandoned 或 plan。review 和 blocked 的实现态继续占用当前 worktree；确需并行时使用外部 Git worktree。

### 11.3 外部 repo 只读

第一阶段任何窗口都不得修改：

```text
Latch-Board repo
appearance-sec repo
monitoring repo
全局 skill 目录
全局 latch 安装
```

### 11.4 交接内容

每个 slice 的 submission 至少包含：

- 实际改动；
- 验证命令与结果；
- 未验证范围；
- PRD 是否有偏离；
- 下一 slice 前置条件是否满足；
- 当前 worktree 的用户原有改动是否保持不动。

## 12. 第一张 implementation task 的建议标题

```text
实现 Latch v2 数据底座与 revision 并发保护
```

只有用户 review 并批准本 PRD 与实施计划后，才创建该 task。
