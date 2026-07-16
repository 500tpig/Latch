# 迁移、CLI 总表、兼容回退与发布边界

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

Decision-Status: approved

Document-Status: current component of `2026-07-15-latch-final-product-contract.md`

Date: 2026-07-15

Revision: 4

Released: 2026-07-16 — 全面 current 发布；R2 事件 revision 唯一重写为 1..n。

## 1. 与 v2 的关系（权威）

```text
基础契约 = docs/prd/2026-07-10-latch-v2.md（历史基线）
最终契约 = v2 全文保留条款
            + 本最终分章按「同名主题优先级覆盖」
```

**覆盖优先级（高 → 低）：**

1. 最终分章（Actor / Light / Group / 触发 / 知识 / Context / 本节）  
2. 最终 PRD 入口不变量  
3. v2 中未被覆盖的条款（root 发现、JSON 输出形状、错误字符串习惯、锁、archive 提交点、Board 只读等）**继续有效**

最终入口和分章是 current 事实；v2 中未被覆盖的条款继续有效。

## 2. 迁移总原则

1. 原地兼容；禁止日常删 `.latch`；  
2. 失败则停；  
3. **旧数据读取：** 新字段可缺省（按各章投影规则）；  
4. **新写入：** 新 task 必须满足新不变量（如 `primary_writer`、light 的 basis/profile）；  
5. task.json 提交点；event/state 失败不回滚 task；  
6. 锁序 `task -> state`。

不得写「所有新字段处处可选」而不区分读/写。

## 3. Schema 版本与事件兼容（回退）

### 3.1 版本字段（唯一选项，无备选）

| 位置 | 规则 |
|---|---|
| `task.json.schema_version` | 现行写入为 **`2`**。引入 primary_writer / profile / work_basis / provenance 等后的**可写格式**必须为 **`3`**。不使用 `2 + format_flags`。 |
| `events.jsonl` | **无**独立文件头。`events_meta` **唯一规则**：若存在，**必须是文件第一行**，且**全文件至多一条**；形状 `{ type: "events_meta", events_schema_version: 3, actor, task_id, revision: 0, created_at }`（`revision` 固定为 `0`，不占用业务事件序号）。若第一行不是 `events_meta`，则**不得**在后续行再出现 `events_meta`（出现则 schema error）。若无 `events_meta` 且 `task.schema_version === 3`，默认按 v3 扩展事件集校验。 |
| 旧 reader | 只认 v2 `TASK_EVENT_TYPES` 白名单；未知 type（含全部 v3 专有 type 与 `events_meta`）→ validate 失败（现状）。 |

### 3.2 写扩展事件的门闸

写入任一 **v3 专有** event（`writer_claimed`、`writer_taken_over`、`implementation_authorized`、`profile_changed`、`retrospective_recorded`、`submission_knowledge_impact_patched`、`events_meta` 等）之前必须：

1. 同次或已有 `task.schema_version === 3`（原子升级允许 2→3 与首条 v3 写入同一提交点策略：先写 task.json=3，再 append events）；  
2. CLI 版本 ≥ 文档记载的 `min_cli_version`（实现发布说明必填）。

### 3.3 读兼容

| Reader | 行为 |
|---|---|
| 新 CLI (v3+) | 识别 v3 types；**未知** type → 跳过该行并 warning，不整文件失败 |
| 旧 CLI (v2 only) | 未知 type → **整段失败** |

### 3.4 回退方案

**R1 — 发布前：** 旧 CLI 环境**禁止**写 v3 events / schema 3。

**R2 — 已 schema 3 需回到可被 v2 CLI 读写的状态：**

用户明确确认后运行 **`latch downgrade-v2 --task <id>`**（逻辑名；实施可定）：

#### R2 输入前置

- task 存在且 `schema_version === 3`；  
- 用户确认丢失 v3 事件细节与 v3 专用字段；  
- 写锁 task→state。

#### R2 备份（必须先于破坏性改写）

1. 复制整个 task 目录到  
   `.latch/archive/v3-backup/<task_id>-<utc_ts>/`  
   （含 `task.json` 与完整 `events.jsonl`）。

#### R2 task.json：v3 → 可写 v2 映射（确定）

| v3 字段 | v2 可写结果 |
|---|---|
| `schema_version` | 设为 **`2`** |
| `primary_writer` | **删除键**（v2 无此字段；主写语义丢失，仅 backup 可查） |
| `profile` | **删除键** |
| `work_basis` / `implementation_authorization` / `retrospective_record` | **删除**；若存在可投影的事前批准，写入 v2 形状 `implementation_approval`：`{ approved_plan_revision, approved_at, source: "user", reason }`，其中 `approved_plan_revision` 取 authorization.plan_revision 或当前 plan_revision，`reason` 取 authorization.reason 或 `"downgraded from v3"`；**retrospective_record 不转换为 approval**（删除，避免伪造事前批） |
| `group_id` | **删除键**（v2 无 group；backup 保留） |
| `provenance` | **删除键** |
| `submission.plan_revision` | **删除**该子字段；保留 v2 submission 其余字段；若有 `knowledge_impact` → **删除**（v2 无此字段；backup 保留） |
| `submission` 其它 | 保留 changes/verified/unverified/submitted_at/no_verify |
| phase / plan / verification / artifacts / blocked / outcome | **保留**（v2 已有） |
| 非法于 v2 的其它键 | 删除 |

降级后 task 必须通过**现行 v2** task schema 校验，且旧 CLI 可 `save`/`approve`/…（受 v2 规则约束）。

#### R2 events.jsonl

1. 原文件已在 backup 中完整保留；  
2. 主文件重写为**仅** v2 白名单 type 的行（按原时间/`created_at` 序过滤）；  
3. **丢弃**所有 v3-only type 与 `events_meta`；  
4. **唯一 revision 规则：** 对保留事件按过滤后顺序**重写** `revision` 为单调 **`1..n`**（n=保留条数）；不保留原 revision 空洞。backup 中可查降级前原 revision。

#### R2 state.json

- 不修改其它 actor 键；  
- 若 current 指向该 task，保留；  
- 不把已删的 primary_writer 映回 state。

#### R2 成功条件

- task.schema_version===2 且 v2 validate 通过；  
- 旧 CLI `context <id> --json` 可读；  
- backup 目录存在且含降级前 task.json。

**R3 — 失败则停：** 任一步失败则中止，不删 backup，不删 `.latch`。

## 4. 分项迁移

| 领域 | 旧数据读 | 新写入 | 章 |
|---|---|---|---|
| primary_writer | 缺键=legacy_unclaimed | 新 task 必写 | Actor |
| actor | default 不可写 | session 必填 | Actor |
| profile | 缺=standard | light 必有 basis 规则 | Light |
| legacy_approval | 投影 | 不伪造 scope | Light |
| submission impact | patch 可补 | submit 必带 | Light |
| group_id | 缺=无组 | 空串非法 | Group |
| 知识 fingerprint | 缺 baseline=stale 降级 | updated 时更新基线 | 知识 |

## 5. CLI 逻辑命令总表（补全）

### 5.1 生命周期与仓库

| 逻辑 | 要点 |
|---|---|
| `init` | 初始化 `.latch`；保留 v2 |
| `checkpoint` | 建 task；light/retrospective 变体见 Light |
| `use` | session actor；只改 state |
| `list` / `list --group` | 可无 session |
| `context` / `context <id>` | 无 id 须 session |
| `save` | plan/meta/group；不擅自推 phase |
| `approve` | authorization；plan→dev 时 work+1 |
| `verify` / `submit` / `done` / `abandon` | Light+v2 |
| `block` / `unblock` | v2；plan 更新不自动 unblock |
| claim / takeover | Actor |
| `patch_submission_knowledge_impact` | Light |
| `decision` / `save --decision` | 保留 v2 decision 事件 |
| `save --feedback` / review feedback | 反馈矩阵见触发章 |
| `context pack` | Context 章预算 |
| `knowledge fingerprint/check` | 知识章 |
| `benchmark context` | Context 章 diagnostic |

### 5.2 错误与 JSON

- 错误退出码与人读信息：**保留 v2 习惯**（expect_revision 冲突文案等），新错误见各章示例。  
- `--json` 输出：在 v2 schema 上**扩展**字段（primary_writer、profile、group_id、writer_status、siblings…），不无故删旧键。

### 5.3 锁与 archive

- 短锁、过期锁、组合锁 `task -> state`：**保留 v2**。  
- archive 提交点与 done/abandon 落盘：**保留 v2**，并叠加 Light done 复核。

## 6. v2 条款覆盖表（扩展）

| v2 主题 | 最终 |
|---|---|
| 显式 Latch 才建 task | **覆盖**：客观信号建 light（触发章）；发布同步 AGENTS/skill |
| actor 退化可写 | **覆盖**：fail closed |
| 无 primary_writer | **覆盖** |
| plan/approve/verify/submit/review/done | **保留** + Light 证明包 |
| open_questions 空才 approve | **保留** + request 授权 |
| blocked 允许 plan/abandon | **保留** + Light 额外拒绝 |
| worktree warning | **保留** + 触发章 mixed |
| root 发现 / init | **保留 v2** |
| JSON/错误/锁/Board 只读 | **保留 v2** |
| `.latch` 删除语义 | **收紧**：日常不可删 |
| 无 knowledge/context/group | **新增** 各章 |

## 7. 发布边界（代码 + 迁移 + 文档 + skill 同一边界）

**禁止：** 仅把 INDEX/HANDBOOK 切到最终契约而 CLI 仍为纯 v2 行为（文档超前实现）。

### 7.1 同一发布单元（任一 slice 列车）

| 轨道 | 内容 |
|---|---|
| 代码 | 该 slice 宣称的 CLI 行为 |
| 数据 | 若写入 schema 3 / v3 events：须具备 §3.4 R2 降级工具 |
| 文档 | 与该 slice 对应的 PRD 段落、HANDBOOK、**DESIGN.md** 必要句 |
| 指令面 | **`AGENTS.md`**、**`skills/latch/SKILL.md`**、**`docs/AI_INSTALL.md`** 中与触发/命令面冲突的句子 |

`AI_INSTALL.md`、根 `AGENTS.md` 和 canonical Skill 已与触发章同步发布；三处均使用 A/B/C 判定表。

### 7.2 部分生效（slice 列车）

允许 INDEX 标注「迁移期 / 部分生效」并只启用已交付 slice。  
部分生效**不得**把最终 PRD 标成唯一 current 且暗示 knowledge/context 已可用。

### 7.3 「全面 current」必要条件（全部满足）

宣称「最终契约已全面 current、可替代 v2 作为唯一产品契约」时，**同一发布**须已交付：

| 序号 | 必须已交付 |
|---|---|
| C1 | **S0** Actor（session actor、primary_writer、claim/takeover、fail closed） |
| C2 | **S1** Light 证明包（work_basis、submit→review、impact、禁 light no-verify） |
| C3 | **S3** Group 最小集 |
| C4 | **S4** 知识 freshness helper（fingerprint/基线读路径；与 Light impact 联调） |
| C5 | **S5** Context pack（24k 硬顶与 meta）+ **benchmark context** 可跑 diagnostic（fixture 可先最小集） |
| C6 | **S6** 迁移/legacy patch + **R2 downgrade-v2** 工具 |
| C7 | 文档：最终 PRD、INDEX current 指针、HANDBOOK、DESIGN 必要段 |
| C8 | 指令面：**AGENTS.md**、**skills/latch/SKILL.md**、**AI_INSTALL.md**（触发规则与命令面与代码一致） |

缺 C4/C5 而把知识/Context 写进 current 正文 → **阻断发布**。  
本次发布已完成 C8：`AI_INSTALL.md`、根 `AGENTS.md` 和 canonical Skill 均已启用 A/B/C 触发规则。

全面 current 已于 2026-07-16 发布；后续契约变更仍须单独 task 与 approve。

## 8. 实施 slice

| 序 | Slice |
|---|---|
| S0 | Actor |
| S1 | Light 证明包 |
| S2 | 触发/判定表 skill 规则（可与 S1 同发） |
| S3 | Group |
| S4 | 知识 freshness |
| S5 | Context pack + benchmark |
| S6 | 迁移 + R2 降级 |
| S7 | 全面 current 文档与指令面，已发布 |
| S8 | 观察期 |

## 9. 一致性摘要

- schema **仅** 2 与 3；`events_meta` **仅允许文件第一行且至多一条**；
- R2：v3→v2 字段映射 + 过滤后事件 **revision 重写为 1..n**；
- 全面 current **含**知识+Context 实现及 **AI_INSTALL.md**；
- 旧读可缺省 / 新写必不变量。
