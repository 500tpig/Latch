# Context pack 与 benchmark

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

Decision-Status: approved

Document-Status: current component of `2026-07-15-latch-final-product-contract.md`

Date: 2026-07-15

Revision: 3

Released: 2026-07-16 — 全面 current 发布。

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

## 4. Pack 内容与输出字段

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
