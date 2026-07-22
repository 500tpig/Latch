# Context pack 与 benchmark

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

Decision-Status: approved

Document-Status: current component of `2026-07-15-latch-final-product-contract.md`

Date: 2026-07-15

Revision: 5

Released: 2026-07-16 — 全面 current 发布。

Updated: 2026-07-22 — 增加可读 timeline 与原始 event 的 history selector。

## 1. 目的与边界

- 单次 context pack 硬预算与可复现 benchmark；
- 不保证永远低 token 且零遗漏；
- 会话总上下文 ≠ pack；用户不必每条消息先算。

## 2. 字符计数（硬门禁用）

### 2.1 定义

- 计量对象：pack **最终序列化输出**的 Unicode 标量值个数（JavaScript ` [...str].length` / Python `len(s)` 对 BMP 外一致时用 code point 计数）。
- **不含**包外系统提示、历史聊天、本轮其它工具噪声。
- UTF-8 字节数可并列输出，**不作**默认硬顶单位。

### 2.2 默认预算

| 项 | 默认 |
|---|---|
| L0 task 短视图 | 4_000 code points |
| L1 知识+地图+兄弟摘要 | 6_000 |
| L2 摘录 | 计入合计 |
| **单次 pack 硬顶** | **24_000** code points |
| 扩读单批 | 8_000 |
| 扩读累计 / orientation | 48_000 |

超硬顶必须截断并设 `truncated=true`。项目配置可提高硬顶，默认 24_000。

## 3. Orientation 阶段

### 3.1 定义

**orientation** = 为回答**同一用户任务意图**而连续进行的 pack+扩读序列，直到：

1. Skill 声明 orientation **关闭**（已开工实现或已足够回答）；或  
2. 用户发送**新的**独立意图（新 bug / 新 task / 明确「换话题」）；或  
3. 切换 `task_id` 主键；或  
4. 空闲超过实现配置的 TTL（默认不强制；若实现则须文档化，默认建议无 TTL，仅 1–3）。

### 3.2 累计扩读计数

- 扩读累计字节/字符在 **orientation 内**累加；
- orientation 关闭时清零；
- 新 orientation 不得继承上一任务的扩读累计。

## 4. Task 读取层级与 Pack 输出

### 4.1 Task 读取层级

CLI 提供三个兼容层级：

- `context --json` 与 `context --json --brief` 保持既有输出；
- `context --json --status` 只返回 phase、revision、授权、writer、blocked、gate 计数和 `next_action`；
- `context --json --since-revision <revision>` 返回指定 revision 之后的 event 与当前最小状态，并设置 `requires_baseline: true`。

`--brief`、`--status` 与 `--since-revision` 互斥。delta 只适用于调用方已持有可信 baseline 的情况，不是跨 session 完整恢复入口。`current` 是 actor state 指针；`primary_writer` 与 caller writer status 单独返回。

JSON Context 可额外使用 `--history <timeline|events|both>`；它不改变上述层级，也不适用于 `--status` 或非 JSON 输出。省略参数时是兼容模式：full、brief 与 delta 继续同时返回 raw event 和带 `details` 的 timeline，且不增加字段。显式选择会增加 `history_view`：

- `timeline` 只返回可读 timeline，并省略 timeline item 的 `details`；
- `events` 只返回 raw `recent_events` 或 delta `events`；
- `both` 返回与默认等价的两套历史字段。

selector 只改变响应投影，不修改 task/event 真源、schema version、Context pack 预算或 timeline 文案语义。S8 只读样本在 revision 4 的默认 minified brief JSON 为 5,110 Unicode code points；`--history timeline` 的同输入输出为 3,636，减少 1,474（28.85%），其中包含 `history_view` 标记。该数值仅用于同输入的相对字符比较，不表示模型 token。

status 输出应显著小于 brief。回归测试至少比较同一 task 的序列化字符数，确保 status 小于 brief；30% 降幅仍作为 benchmark 次目标，不成为单次 CLI 硬门禁。

### 4.2 Pack 内容与输出字段

必含：

```ts
type ContextPackMeta = {
  task_id?: string
  orientation_id: string          // 实现生成的稳定 id
  char_count: number              // code points
  char_budget: number             // default 24000
  truncated: boolean
  truncate_note?: string
  sources: Array<{ kind: string; path?: string; freshness?: string }>
  expand_batches: number
  expand_chars_cum: number
  expand_reason?: string
  estimated_tokens?: number       // 诊断，非正式门禁
}
```

渐进顺序：task → 知识（freshness 标注）→ 地图 → 兄弟摘要 → 摘录 → 扩读。

## 5. Benchmark 可复现格式

### 5.1 题目录（仓库内 fixture）

路径建议：`benchmarks/context/cases/<case_id>.json`

```ts
type ContextBenchCase = {
  id: string
  title: string
  kind: 'cross_file' | 'doc_route' | 'regression'
  prompt: string
  /** 相对 repo root；必须看到或显式列入 next_reads */
  gold_critical: string[]
  gold_optional?: string[]
  /** 广读基线入口文件列表 */
  baseline_broad_entry: string[]
  max_tool_steps_main: number     // 主成功：首次可行动证据步数上限，默认 8
}
```

### 5.2 单次 run 记录

```ts
type ContextBenchRun = {
  case_id: string
  path: 'broad' | 'rg' | 'codegraph' | 'context_pack'
  tool_steps_to_first_actionable: number | null
  chars_read: number
  estimated_tokens?: number
  critical_hits: string[]
  critical_misses: string[]
  wrong_doc: boolean
  freshness_failures: number
  pack_meta?: ContextPackMeta
}
```

### 5.3 主成功判定（确定）

对 `path=context_pack` 的 run：

1. `critical_misses.length === 0`；  
2. `wrong_doc === false`；  
3. `tool_steps_to_first_actionable !== null` 且 `<= case.max_tool_steps_main`（默认 **8**）；  
4. 若使用知识源，无「标为 fresh 实为 stale」的 freshness 谎报。

### 5.4 次成功（诊断，不单独否决）

- 相对同 case 的 `broad` 路径：`estimated_tokens` 或 `chars_read` 降幅 ≥ 30% 为**目标参考**；
- 未达 30% 但主成功 → 仍记 pass_main，附 `token_goal_miss`；
- 主失败 → 整体 fail。

### 5.5 工具步定义

一次「工具步」= 一次工具调用（读文件 / rg / pack / codegraph 查询等）。  
「可行动证据」= gold_critical 中至少一项已进入模型可见上下文或 pack.sources。

## 6. Adapter

rg+读为降级终点；CodeGraph 可选且须 freshness；升级/重建索引 **另授权**。

## 7. 权限事实（本设计 task）

- DataTableV2 **只读**勘察已做；  
- CodeGraph 升级/重建：**未授权**。

## 8. 一致性摘要

- 硬顶 24000 **code points**，计数法已定义；
- orientation 重置边界已定义；
- benchmark 有 case/run schema、步数默认 8、主次判定可执行。
