# Latch 最终契约实施 checklist

Source-Task: 20260714084358411-重审-latch-最终任务与知识上下文设计-51d5e1

状态：由 design-accepted 最终契约候选（task 约 revision 44 及随后确认）按迁移章 §7.3 **C1–C8** 派生。  
**不是**产品设计文档；**不是**实施 approve。

契约入口：`docs/prd/2026-07-15-latch-final-product-contract-draft.md`  
发布边界权威：`docs/prd/2026-07-15-latch-migration-cli-draft.md` §7

## 总原则

- 每一 slice 列车：代码 + 必要数据工具 + 对应文档段落 + 指令面，**禁止**文档全面 current 而 CLI 未实现。
- 全面 current 必须 **C1–C8 全部满足** 后同一发布宣称。
- 升 INDEX current、改产品代码均须**单独用户授权 / 另开 task 并 approve**。

## C1 — S0 Actor

- [ ] session actor fail closed（`tool:session:id`；default 不可写）
- [ ] `primary_writer`；新 task 必写
- [ ] legacy_unclaimed + 继续指定 task → claim
- [ ] 非对称 takeover
- [ ] R2 相关：schema 3 写入门闸（与 S6 衔接）
- [ ] 验收样本：本设计 task 类 `claude:default` 历史 → claim 路径
- [ ] 文档/ skill 段落：仅 Actor 范围（若部分生效）

## C2 — S1 Light 证明包

- [ ] `profile` light/standard
- [ ] `work_basis`（authorization | retrospective）
- [ ] 证明包门禁；light 禁 `--no-verify`
- [ ] submit → review 必停；明确归档才 done
- [ ] `knowledge_impact` submit 输入 / done 校验
- [ ] plan/work revision 失效与 double binding
- [ ] legacy submission patch impact
- [ ] 触发判定表 skill 规则可与本 slice 同发（S2）

## C3 — S3 Group

- [ ] 可选 `group_id`
- [ ] `list --group`、兄弟只读摘要
- [ ] 无 group 门禁/状态机

## C4 — S4 知识 freshness

- [ ] frontmatter：`covers`、`last_fingerprint`、algo
- [ ] fingerprint 计算与 stale 行为
- [ ] 基线更新时机（禁止仅因读取更新）
- [ ] 与 impact=updated / artifact 联调

## C5 — S5 Context + benchmark

- [ ] context pack 24000 code points 硬顶与 meta
- [ ] orientation 累计扩读
- [ ] `benchmark context` diagnostic + 最小 fixture
- [ ] freshness 标注接入 pack

## C6 — S6 迁移与回退

- [ ] schema 2→3 升级路径
- [ ] v3 事件写入门闸
- [ ] legacy patch / claim 迁移命令
- [ ] **`downgrade-v2` R2**（backup + 字段映射 + events 1..n）
- [ ] 失败不删 `.latch`

## C7 — 文档全面 current（仅当 C1–C6 已交付）

- [ ] 最终 PRD 定稿路径写入 INDEX 为 current
- [ ] v2 PRD 降为历史
- [ ] HANDBOOK 对齐
- [ ] DESIGN 必要段对齐

## C8 — 指令面（与 C7 同发）

- [ ] `AGENTS.md`（取消「仅显式 Latch」若代码已自动建 light）
- [ ] `skills/latch/SKILL.md`
- [ ] `docs/AI_INSTALL.md`（命令面与触发规则）
- [ ] 项目侧规则若有冲突一并改

## 建议实施 task 切分（示例，非设计）

1. 实施 task A：C1（S0）  
2. 实施 task B：C2（+S2 skill 触发）  
3. 实施 task C：C3  
4. 实施 task D：C4+C5（可再拆）  
5. 实施 task E：C6  
6. 文档/指令 task F：C7+C8（全面 current，须 C1–C6 已合并发布）

## 明确不做（本 checklist）

- 不新增产品能力
- 不自动 Git / 不升 CodeGraph（除非实施 task 另授）
- 不在未 approve 的实施 task 中改 CLI 源码

## 本设计 task 生命周期备注

当前 task 处于 **`plan`**。用户日后说「归档 / done」仅表示**归档授权意图**，**不能**直接执行 `latch done`。  
须先：展示/更新 plan → 用户 **approve 实施**（若进入写正式文档或其它批准范围）→ 完成工作 → **verify** → **submit** → **review** → 用户再次明确归档后才 `done`。  
在仅保持设计、等待「正式文档授权」或「实施 task 授权」期间，**继续 `plan` 是正确状态**。
