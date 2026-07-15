# 模块知识与 freshness（最终契约草案节）

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

Decision-Status: draft (candidate r2 — P1 freshness baseline fix)

Document-Status: draft

Date: 2026-07-15

Revision: 2

## 1. 目的与边界

- Git 模块知识 = **当前**约定真源；task archive = **历史**；源码+测试 = 最终验证。
- 不恢复 v1 knowledge DB；Core 不算语义质量；无 group 级 knowledge 门禁。
- `knowledge_impact` 形状与时序以 **Light 章**为准。

## 2. 文档位置与粒度

- 默认每复杂模块/子系统一页 Markdown（项目可选 `docs/modules/<id>.md` 或源码旁 ARCHITECTURE.md）。
- 简单符号无页：task 用 `impact.kind=none` + 具体 reason。

## 3. Frontmatter（完整可比较）

```yaml
---
id: string
summary: string
covers: string[]                 # 见 §4 语法
status: current | stale | retired
last_fingerprint: string | null  # 规范化后 covers 文件集内容指纹；无基线时 null
last_fingerprint_algo: string    # 固定如 "sha256-v1"
provenance:
  last_verified_task_id: string | null
  last_verified_at: string | null   # ISO-8601
  optional_commit_sha: string | null
---
```

- **`last_fingerprint` 为 freshness 比较的持久基线**；不得依赖未定义的「上次索引」。
- 缺 frontmatter / 缺 `last_fingerprint`：可读正文，freshness 结果为 **`baseline_missing`**（按 stale 降级处理，不得标 fresh）。

## 4. covers 语法与路径规范化

### 4.1 语法（Core 可解析子集）

每条 cover 为相对 **workspace root** 的一种：

| 形式 | 例子 | 含义 |
|---|---|---|
| 精确文件 | `src/foo.ts` | 单文件 |
| 目录前缀 | `src/components/DataTableV2/` | 该目录下所有常规文件（非递归符号约定：实现须 **递归** 包含子目录文件，排除 `node_modules`、`.git`、构建产物目录名列表见下） |
| 单段 glob | `src/components/DataTableV2/*.{ts,vue}` | 仅该目录一层；`**` 允许一层递归 `src/foo/**/*.ts` |

禁止：绝对路径、`..` 跳出 workspace、空字符串。

### 4.2 规范化

1. Unicode NFC；  
2. 去掉首部 `./`；  
3. 路径分隔符统一 `/`；  
4. 解析后文件列表排序（字节序）；  
5. 排除目录名：`node_modules`、`.git`、`dist`、`build`、`coverage`、`.latch`。

### 4.3 fingerprint 算法 `sha256-v1`

```text
for each file in sorted(normalized_paths):
  append path + "\0" + sha256(file_bytes) + "\n"
fingerprint = sha256(utf8(concat))
hex encode lowercase
```

空 covers → fingerprint 为对空串的 sha256；并报告 `covers_empty` warning（不得当 meaningful current 注入，除非 Skill 显式只要摘要）。

## 5. Freshness 判定

| 条件 | 结果 |
|---|---|
| status=retired | retired（不可当现行 contract） |
| status=stale | stale |
| covers 解析失败 / 文件消失导致集合不完整 | error → 当 stale 用 |
| `last_fingerprint` 为 null | baseline_missing → 当 stale 用 |
| 当前指纹 === last_fingerprint 且 status=current | **fresh** |
| 当前指纹 !== last_fingerprint | **stale**（无论 status 字段是否仍写 current；输出须标 stale） |

`review_needed`：派生布尔 =（结果为 stale 或 baseline_missing 或 error）且 status≠retired。

## 6. 基线更新时机

仅在下列情况 **写入/更新** `last_fingerprint` + `last_fingerprint_algo` + provenance 时间/task：

1. Skill 完成知识 delta 更新，且 task `knowledge_impact.kind=updated` 所关联 artifact 即该文档，并在 **同一人工确认的文档提交意图** 下（通常随代码一起由用户提交 Git）；或  
2. 显式 `knowledge verify --path`（逻辑命令）在 Skill 确认「文档仍正确」后重算并写回 frontmatter。

**禁止：** 仅因为读过文档或打了 context pack 就更新基线。

Latch Core **可选**提供 `knowledge fingerprint --path` 只读计算；写回 frontmatter 是工作区文件修改，须 writer 工作流与用户 Git 授权习惯，不由 done 偷偷改。

## 7. 注入 context 的规则

| freshness | pack 行为 |
|---|---|
| fresh | 可注入，`freshness=fresh` |
| stale / baseline_missing / error | 可注入摘录但必须 `freshness=stale|error`，不得标 current |
| retired | 默认不注入正文；可注迁移链接一行 |

## 8. 与 impact

见 Light 章：`none` / `updated`+artifact_refs。updated 的 artifact 路径应落在某知识文档；freshness 基线更新遵循 §6。

## 9. 重构迁移表

split/merge/retire/supersede 表；旧页 retired；不删 `.latch`。

## 10. 一致性摘要

- 持久基线 = frontmatter.`last_fingerprint` + algo；
- covers 语法与规范化已定义；
- 基线仅在确认文档正确时更新；
- stale 不静默。
