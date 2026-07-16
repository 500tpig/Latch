# Light profile、authorization、证明包与 review

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

Decision-Status: approved

Document-Status: current component of `2026-07-15-latch-final-product-contract.md`

Date: 2026-07-15

Revision: 6

Released: 2026-07-16 — 全面 current 发布。

判定表 B、A、C 的权威定义见 `docs/prd/2026-07-15-latch-workflow-triggers-draft.md`，本章不重复展开。

**不重开：** light 禁 `--no-verify`（对 light）；事前 authorization 不因单独 work_revision↑ 失效（retrospective 除外，见 §4）；无 deferred_wave；impact 为 submit 输入；artifact 单真源；profile 变更抬 plan_revision；review/blocked 矩阵主干；checkpoint 只原子 task.json；已有事前授权走 approve；Core 不做 NLP。

## 1. 目的与边界

### 1.1 目的

- `profile: light` 压缩 plan/approve 往返，不新增 phase；
- 证明包覆盖**事前授权**与**受限事后建档**；
- `submit → review`；明确归档后 `done`。

### 1.2 非目标

- Core 不做语义 NLP；知识章管 freshness 算法；
- 不自动 done；group 不做完成门禁；
- 不把任意未授权实现「洗成」retrospective。

### 1.3 责任拆分

| 角色 | 必须 | 不得 |
|---|---|---|
| Skill | light/standard、精确低风险、grill、确认归档、诚实 retrospective 入口 | 伪造事前批；对已有进行中 task 滥用 retrospective |
| Core | 结构、revision、phase、blocked、proof 矩阵、basis 有效性 | 解析自然语言意图 |

## 2. Profile 与 phase

### 2.1

```ts
type TaskProfile = 'light' | 'standard'
```

共用 `plan | dev | check | review`（+ blocked）。

### 2.2 Profile 变更（机械效果）

在 **允许** 的 profile 变化发生时（§2.3–2.4），Core 一律：

1. `plan_revision + 1`；
2. `phase → plan`；
3. 事前 authorization、retrospective basis、gate、submission 全失效；
4. **当时不**改 `work_revision`（重新开工规则见 §4.5–4.6）；
5. 追加 `profile_changed` 事件，字段至少含 `from`、`to`、`reason`（非空；Skill 填写，Core 只验非空）。

### 2.3 Light → standard（必须升级）

Skill 判定出现 open_questions、高风险、自拟方案、越界、多 gate 等 → **必须**升级并走 §2.2。`reason` 例：`risk-surface`、`open-questions`、`scope-expanded`。

### 2.4 Standard → light（降级限制，恢复 handoff 规则）

**禁止**在已产生有效 `implementation_authorization`（含迁移后仍有效的事前授权语义）后 **静默**降回 `light`。

仅当下列之一成立时，Skill 才可请求 `standard → light`，并走 §2.2：

1. **尚无**有效 `implementation_authorization`（可有未开工 plan，或仅有已失效 basis）；或  
2. 用户**明确**要求缩小为 light，并同意重写 intent（plan 字段）与证明包路径；`profile_changed.reason` 须体现用户缩小范围（例：`user-requested-narrowing`）。

降级后须重新满足 light 证明包（含至少一条 gate、请求即授权或新 approve），不得沿用已失效的旧 authorization 假装仍有效。

Core：若检测到 `standard → light` 且当前仍存在对 **变更前** plan_revision 有效的 implementation_authorization 投影且无结构化用户缩小标记，应拒绝（实施可用 event reason 枚举或 approve/save 标志；不得静默成功）。

## 3. 证明包

| 成分 | 真源 |
|---|---|
| intent | `plan.goal` / `scope` / `acceptance` |
| work_basis | §4 |
| proof | §5 矩阵 |
| knowledge_impact | submit 输入 → `submission.knowledge_impact` |

`submit` / `done` / legacy patch 均须能复核 **有效 work_basis + 当前 proof 分支**，不得只信任 `submission.verified` 文本。

### 3.1 硬拒绝摘要

- blocked → 拒实施向 approve、verify、submit、done、patch、retrospective 启动；仍允许 plan 更新与 abandon（§8.2）；
- open_questions 非空 → 拒实施向 authorization 与 submit；
- 无有效 work_basis 或 proof 不满足 → 拒 submit / done。

## 4. work_basis

### 4.1 类型

```ts
type WorkBasis =
  | {
      kind: 'implementation_authorization'
      plan_revision: number
      authorized_at: string
      source: 'user_request' | 'user_approve' | 'user_delta'
      reason: string
      scope: {
        summary: string
        paths?: string[]
        notes?: string
      }
    }
  | {
      kind: 'retrospective_record'
      recorded_at: string
      reason: string
      implemented_before_task: true
      scope_summary: string
      plan_revision: number
      work_revision: number
    }
```

- 仅 `source` 区分请求即授权 / approve / delta（无并行 `mode`）。
- retrospective **不得**表述或投影为事前批准。

### 4.2 有效性

**implementation_authorization** 有效 iff 结构合法、`scope.summary` 非空、`plan_revision === task.plan_revision`。

**不因**单独 `work_revision`↑ 失效（同一已授权 plan 下可多轮改代码）。

**retrospective_record** 有效 iff：

- 结构合法，`implemented_before_task === true`；
- `plan_revision === task.plan_revision`；
- `work_revision === task.work_revision`；
- 仅覆盖**该 work_revision 上、记账前已存在的实现**的 verify/submit。

**任何因继续改代码导致的 `work_revision` 递增** → retrospective_record **立即失效**；必须改用 `implementation_authorization`，并走 §4.5。

**任何 `plan_revision` 递增** → 两种 basis 均失效；retrospective 的 **rebind** 见 §4.6（可保持 work_revision，不得伪 +1）。

### 4.3 请求即授权（Skill）

触发章判定表 B → `source: user_request` 的 implementation_authorization。Core 不验是否真低风险。

### 4.4 写入路径

#### A. 新建 light + 请求即授权：`checkpoint`

`task.json` 原子提交含：plan、`profile: light`、`work_basis`（authorization）、`phase: dev`、`work_revision: 1`、primary_writer 等。  
无 `--expect-revision`。events/state 随后；失败不回滚 task.json（warning）。

#### B. 新建 retrospective task（事后建档专用创建）

仅当：**尚无该工作的 open task**，且用户明确要求事后记录已完成实现（Skill 确认，不得把「继续开发」洗成 retrospective）。

`checkpoint`（或等价 create）原子 `task.json`：

- plan 描述已发生工作；
- `work_basis: retrospective_record`，其中 `plan_revision` 为创建后的 plan 修订号，`work_revision: 1`，`implemented_before_task: true`；
- `phase: dev`；
- `work_revision: 1`。

然后可 `verify` /（standard 下）`submit`；**light retrospective 仍须 gate**（§5）。

#### C. 已有 task：事前授权只走 `approve`

- 写/更新 `implementation_authorization` 仅通过 `approve`；
- expect_revision、writer、open_questions 空；
- **禁止**对已有 open task 追加 `retrospective_record` 以洗白未授权新实现（拒绝：task 已存在 primary 工作流且非 §4.4.B 创建型 retrospective）；
- 普通 `save` 不写 basis、不推 phase。

### 4.5 每次 **implementation_authorization** 使 plan→dev：`work_revision + 1`

当有效 **`implementation_authorization`** 落盘且 `phase` 从 `plan` 进入 `dev` 时：

```text
work_revision := work_revision + 1
```

- 含：首次 authorize、plan/profile 回到 plan 后再次 approve、light request 进入 dev；
- 自然包含 `0 → 1`；
- **不包括**：verify、submit、patch impact、纯评价、**仅** retrospective rebind（§4.6）。

### 4.6 retrospective 启动与 rebind（固定，禁止「或」）

| 情形 | work_revision | plan_revision / record | phase |
|---|---|---|---|
| **首次** retrospective 启动（§4.4.B 创建，或合法事后建档 task 首次写入 record） | **固定 `0 → 1`**（当前为 0 时设为 1；禁止写成含糊的「+1 或设为 1」以外的任意值） | record 绑定新/当前 `plan_revision` 与 `work_revision: 1` | → `dev` |
| **仅** plan 或 profile 变化、**代码未变**（无新实现轮次） | **保持**原 `work_revision` 不变 | `plan_revision` 已按 §2.2/+plan 递增；写入**新** retrospective_record，**只**把 `plan_revision` 绑到当前，`work_revision` 仍为原值；旧 record 失效 | → `plan` 后若仍走 retrospective 补记且代码未变：保持 work_revision，phase 可回 `dev` 仅用于 verify/submit 已有实现，**不得**因此 `work_revision+1` |
| **实际继续改代码** | 禁止再写/续 retrospective | 必须 `implementation_authorization` + §4.5（`work_revision+1`，phase→dev） | 正常授权路径 |

补充：

- 「代码未变」由 Skill 声明并写入 rebind reason；Core 不内容比对 diff，但 **禁止**在 rebind 路径上增加 `work_revision`。
- **禁止**在已有有效 `implementation_authorization` 或已存在 submission 之后，用 retrospective 覆盖洗白。
- 首次启动以外，不存在第三种「+1 或设为 1」的可选分支。

## 5. Proof 矩阵（统一）

| profile | work_basis 种类 | 允许的 proof |
|---|---|---|
| light | implementation_authorization | **仅** 全部 gate 在当前 work_revision pass |
| light | retrospective_record | **仅** 全部 gate 在当前 work_revision pass |
| standard | implementation_authorization | gate 全过 **或** plan 无 gate 且 `--no-verify --reason` |
| standard | retrospective_record | 同上（gate 或 no-verify） |
| standard | legacy_approval 投影（§12） | 同上（gate 或 no-verify） |

- light **永远**禁止 `--no-verify`。
- retrospective **不**改变「非事前批准」语义；仅允许 standard 用 no-verify 完成无闸补记。
- Diagnostic 不计 submit 门禁。

### 5.1 失效

- work_revision↑ → 旧 gate 结果不可用于 submit；retrospective basis 失效（§4.2）；
- plan_revision↑ → gate 结果失效；两种 basis 失效。

## 6. knowledge_impact

```ts
type KnowledgeImpact =
  | { kind: 'none'; reason: string }  // reason 非空
  | {
      kind: 'updated'
      summary: string                 // 必须非空
      artifact_refs: Array<{ kind: string; path: string }>  // length >= 1
    }
```

Core 硬门禁：

- `none.reason` 非空（不设最短长度配置）；
- `updated.summary` **非空**；
- `updated.artifact_refs.length >= 1`；
- 每个 ref 已存在于**当前** `task.artifacts`（同 kind+path），`path` 为相对 workspace root 的合法路径；
- 空 summary、空数组、或 ref 不在 artifacts → **submit/patch 失败**。

无 `document_paths` / 无 `deferred_wave`。

时序：submit 输入 → 写入 submission；done 只读校验。

```ts
type Submission = {
  plan_revision: number
  work_revision: number
  changes: string
  verified: string
  unverified: string
  knowledge_impact: KnowledgeImpact
  no_verify?: { reason: string }
  submitted_at: string
}
```

## 7. Intent

仅 plan 字段；无并列 intent。

## 8. Phase 矩阵

### 8.1 反馈 / 流转

| 意图 | 效果 |
|---|---|
| 可执行实现修正 | work_revision+1，phase→dev；submission 失效；若 basis 为 retrospective 则 basis 失效，须新 authorization |
| plan 或 profile 变化 | plan_revision+1，phase→plan；basis/gate/submission 失效；**不**因此 work_revision+1 |
| 仅 plan/profile 变且代码未变的 retrospective rebind | 保持 work_revision；新 record 绑新 plan_revision（§4.6） |
| 纯评价 | 不改 phase / revisions |
| 成功 submit | phase→review |
| implementation_authorization 使 plan→dev | work_revision+1（§4.5） |
| 首次 retrospective 启动 | work_revision 0→1（§4.6） |
| 明确归档 | done（Skill 确认后） |

check 语义：与 v2 一致——验证发生在 check 路径；submit 自 dev/check 在满足 proof 后进入 review。

### 8.2 blocked

与 v2 主干一致并追加本契约拒绝项：

**拒绝：**

- 实施向 `approve`（写入 implementation_authorization / 推进 dev）；
- `verify`；
- `submit`；
- `done`；
- legacy `patch_submission_knowledge_impact`；
- retrospective **首次启动**与 **rebind 启动进 dev**（避免在 blocked 时推进证明链）。

**允许（完整保留 v2）：**

- `list`、`context`、`use`；
- 显式 `unblock`；
- **更新 plan**（`save` plan；**不**自动清除 blocked，须显式 unblock）；
- **`abandon`**。

blocked **不**改变当前 phase。

### 8.3 done

Skill 确认用户明确归档后调用。  
Core 校验：非 blocked、phase=review、**submission 有效（§9）**、**work_basis 对 submission 双 revision 仍有效或为提交时已冻结且仍匹配**、**proof 分支在提交时满足且 done 时仍可复核**（gate 结果仍在对应 work_revision，或 submission 带合法 no_verify 且 plan 仍无 gate）、knowledge_impact、writer、expect_revision。

`--followup` **不是**归档授权证据。

## 9. submission 有效与 done/patch 复核

submission 结构有效 iff：

```text
submission.plan_revision === task.plan_revision
AND submission.work_revision === task.work_revision
AND knowledge_impact 合法
```

此外 `done` 与「信任该 submission」的操作还须：

1. 存在对 `submission.plan_revision` / `work_revision` 合法的 work_basis 解释：  
   - 当前 `implementation_authorization.plan_revision` 匹配，或  
   - 当前 `retrospective_record` 双 revision 匹配，或  
   - standard 下有效 `legacy_approval` 且 `approved_plan_revision === submission.plan_revision`；
2. proof 分支在该 work_revision 上仍成立（gate pass 记录存在，或 no_verify 条件仍成立）；  
3. 不只检查 `verified` 字符串。

## 10. open_questions / grill

非空 → 拒实施向 authorization 与 submit。

## 11. 事件

`implementation_authorized` | `retrospective_recorded` | `profile_changed` | `submitted` | `submission_knowledge_impact_patched` | `review_feedback` | `done` | `abandoned`

## 12. 迁移

### 12.1 profile

无 profile → standard。

### 12.2 legacy_approval（读时投影）

- 来自旧 `implementation_approval`；
- **仅 standard**；
- 仅 `task.plan_revision === approved_plan_revision`；
- 可作为 standard 的 work_basis 投影，支撑 verify/submit（含 no-verify 分支）；
- 不伪造 scope.summary；plan 变后失效，须新 `approve`。

### 12.3 legacy patch：补 impact（兼容真实 v2 submission）

现行 v2 `submission` **没有** `plan_revision` 字段。patch 必须服务真实数据。

逻辑操作 `patch_submission_knowledge_impact`：

**前置：**

- phase === `review`；非 blocked；
- 存在 submission；
- submission **缺少合法 `knowledge_impact`**；
- 允许 submission **同时缺少** `plan_revision` 字段（legacy）；
- 若 submission **带有** `plan_revision`，则必须 `=== task.plan_revision`；若**缺失**，则在 patch 时写入 **当前** `task.plan_revision`；
- `submission.work_revision === task.work_revision`（v2 已有 work_revision）；
- 有效 work_basis 解释成立：优先 `legacy_approval` 且 `approved_plan_revision === task.plan_revision`，或当前 implementation_authorization / retrospective 双绑定匹配；
- 当前 proof 分支对 `submission.work_revision` 仍成立（原 gate pass 仍在，或原 no_verify submission 且 plan 仍无 gate）；
- 可写 actor + primary writer；`--expect-revision`；
- Skill/调用方提供合法 knowledge_impact **输入**。

**效果：**

- 写入 `knowledge_impact`；
- 若缺 `plan_revision`，补写为当前 `task.plan_revision`；
- **不**改 phase、`work_revision`、changes/unverified；`verified` 保持或保持由结构化结果可再生成的摘要策略与 v2 一致；
- task `revision + 1`；事件 `submission_knowledge_impact_patched`；
- **不**重跑 gate、**不**要求假 review feedback。

**拒绝：** 双 revision 真冲突、basis/proof 已失效、已有合法 impact、已 archive。

### 12.4 无 impact 不得 done

未 patch 且无 impact 的 review → 不得 done。

## 13. 命令面

| 操作 | 语义 |
|---|---|
| `checkpoint` light+request | task.json 原子；dev；work_revision=1 |
| `checkpoint` retrospective | §4.4.B |
| `approve` | 写 implementation_authorization；plan→dev 时 work_revision+1 |
| `save` | 不写 basis、不擅自推 phase |
| `verify` / `submit` / `done` | §3–§9 |
| `patch_submission_knowledge_impact` | §12.3 |

提交点 task.json；锁序 task→state。

## 14. 错误示例

```text
Patch denied: submission work_revision mismatch.
```

```text
Patch denied: no valid work_basis or proof for legacy submission.
```

```text
Retrospective denied: cannot apply retrospective_record to in-flight authorized task.
```

```text
Submit denied: retrospective_record stale after work_revision change; authorize first.
```

```text
Done denied: proof branch no longer valid for submission work_revision.
```

```text
Light submit denied: --no-verify is not allowed for profile=light.
```

## 15. 与 v2

保留 phase 矩阵主干、blocked、expect_revision、submit→review、done 再验证明。  
扩展 work_basis、profile、impact、legacy patch、双 revision submission。  
废止 submit 直连 done、伪造事前批、伪造 legacy scope。

## 16. 一致性摘要

- legacy patch 兼容无 `plan_revision` 的 v2 submission，一次补 plan_revision+impact，并复核 basis+proof；
- retrospective：首次启动 `work_revision 0→1`；仅 plan/profile 变且代码未变则 rebind 并 **保持** work_revision；继续改代码禁止 retrospective，改 authorization 且 work_revision+1；
- 每次 implementation_authorization 的 plan→dev 都 work_revision+1；
- standard→light 禁止静默降级；须无授权或用户明确缩小并写 `profile_changed.reason`；
- blocked 允许只读、unblock、更新 plan、abandon；拒绝 verify/submit/done/patch/实施向 approve/retrospective 启动；
- `knowledge_impact.updated`：非空 summary、`artifact_refs.length >= 1` 且 ref∈artifacts；
- light 只 gate；standard 在有效 basis 下 gate 或 no-verify；done/patch 复核 basis+proof。
