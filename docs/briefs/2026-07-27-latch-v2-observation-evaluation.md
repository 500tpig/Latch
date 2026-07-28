# Latch v2 观察期评估

Source-Task: `20260727101723730-评估-latch-v2-观察期结果并规划改进-7184ec`

Document-Status: approved

Date: 2026-07-28

## 结论

Latch v2 已满足观察期的样本数量要求，不需要再等待 10 张任务后才开始评估。
固定 10 张样本足以判断当前流程的主要问题，其余 27 张候选任务用于检查结论
是否在更大范围内重复出现。

当前生命周期的安全约束有效：plan 变化会使旧授权失效，review 修正会生成新的
work revision，失败 gate 会留下记录，归档前仍要求有效 submission。主要问题集中在
使用规则和证据表达，不是 task 存储或 revision 机制失效。

评估确认以下问题：

1. 用户在 review 后完成的手工验收无法更新 submission 中的 `verified` 和
   `unverified`，导致 closure 可能保留已经过期的未验证说明。
2. 描述性 `echo` 命令可以作为 gate 自动通过，但不能证明手工步骤已经执行。
3. 当前契约把「多 gate」直接归入 Standard，实际却有 9 张 Light task 使用多个
   gate，规则与使用方式不一致。
4. 固定样本没有 `decision_recorded`，37 张候选任务也只有 1 条，无法直接评估
   grill 解决了哪些阻塞问题。
5. 部分计划字段完整，但关键产品选择仍在 review 阶段补充，说明字段完整不等于
   方案稳定。
6. takeover 没有造成事实错误，但 37 张候选任务中有 9 张发生 takeover，共
   11 次，存在可见的跨 session 操作成本。

本评估只形成判断和后续任务建议，不修改 CLI、Core、Skill、项目规则或外部 repo。

## 证据范围

### 时间窗口

- 起点：`2026-07-16T06:51:47.388Z`；
- 截止：`2026-07-27T10:17:23.731Z`，即来源 task 创建时间；
- 时间字段：归档 task 的 `closure.accepted_at`。

截止时间用于固定本次评估数据，避免评估期间新增归档改变统计结果。

### Repo

- `monitoring`；
- `appearance-sec`；
- `Loom` 已明确提供，但未初始化 `.latch`，因此没有归档样本。

### 数据来源

只读取以下文件：

```text
.latch/archive/**/task.json
.latch/archive/**/events.jsonl
```

不读取 Codex 会话、聊天记录或其他跨会话材料。归档 task 只读，不补记、不重写，
也不根据本次结论修改历史分类。

### 样本数量

| 范围 | 数量 | monitoring | appearance-sec |
|---|---:|---:|---:|
| 起点后的 `done` task | 39 | 30 | 9 |
| 排除项 | 2 | 1 | 1 |
| 合格候选 | 37 | 29 | 8 |
| 固定样本 | 10 | 8 | 2 |

排除以下 Latch 规则接入任务：

- `20260716072752914-对齐项目-agents-md-的-latch-a-b-c-触发契约-69a7b2`；
- `20260716072828631-对齐-agents-md-的-latch-触发规则-ff209b`。

两张任务属于 Latch 规则接入，不属于观察期要求的正常产品、修复、重构或技术文档
样本。

## 固定样本

固定样本按 `closure.accepted_at` 从早到晚选取。

1. `20260716081702905-对齐播放历史折线的采样时间与缺失点-036d22`
   - Repo：`monitoring`
   - Profile：Standard
   - 结果：2 次 plan 变化，均在 review 后记录。
2. `20260716085256024-调整基础组件编辑交互-f8ee06`
   - Repo：`monitoring`
   - Profile：Light
   - 结果：1 次 implementation correction。
3. `20260716091133532-统一图表表单具体维度必填规则-cb2930`
   - Repo：`monitoring`
   - Profile：Light
   - 结果：无 plan 变化或 review 返工。
4. `20260720080059118-过滤-display-config-非指标字段-ip-端口-id类-从选择指标下-19159c`
   - Repo：`monitoring`
   - Profile：Standard
   - 结果：`manual-tcp-indicator-dropdown` 使用描述性 `echo` gate。
5. `20260721021719008-整合滚动排名列表与胶囊柱图-a5b3df`
   - Repo：`monitoring`
   - Profile：Standard
   - 结果：1 次 plan change，1 次 implementation correction。
6. `20260721025910951-明确浏览器验证默认策略-1bc232`
   - Repo：`monitoring`
   - Profile：Light
   - 结果：无 plan 变化或 review 返工。
7. `20260722055349626-统一物理链路表格样式-0fa27a`
   - Repo：`appearance-sec`
   - Profile：Light
   - 结果：1 次 implementation correction。
8. `20260722030934649-隐藏值为-0-的授权参数-7d45fc`
   - Repo：`appearance-sec`
   - Profile：Light
   - 结果：1 次失败 gate，修正后通过。
9. `20260722073207362-建立组件架构迁移路线图与兼容基线-e6e6f8`
   - Repo：`monitoring`
   - Profile：Light
   - 结果：1 次 non-implementation correction。
10. `20260722075626860-cmp-01-palette-元数据不可变-edffab`
    - Repo：`monitoring`
    - Profile：Light
    - 结果：无 plan 变化或 review 返工。

## 统计结果

| 指标 | 固定 10 张 | 37 张候选 |
|---|---:|---:|
| Light | 7 | 19 |
| Standard | 3 | 18 |
| 发生 plan 更新的 task | 4 | 14 |
| 发生 review feedback 的 task | 5 | 15 |
| 发生 plan change 的 task | 2 | 6 |
| 发生 implementation correction 的 task | 3 | 10 |
| 出现失败 gate 的 task | 1 | 7 |
| 失败 gate 运行次数 | 1 | 8 |
| 出现 blocked 的 task | 0 | 0 |
| `decision_recorded` | 0 | 1 |
| 发生 takeover 的 task | 2 | 9 |
| takeover 次数 | 4 | 11 |
| 使用多个 gate 的 Light task | 2 | 9 |
| scope 达到 5 项以上的 Light task | 0 | 4 |
| 留下浏览器或真实流程未验证项的 task | 7 | 29 |
| 未验证项仍存在但 follow-up 表示无后续的 task | 1 | 14 |
| 使用描述性自动通过 gate 的 task | 1 | 1 |

浏览器和真实流程未验证项按 closure 文本分类，并排除了明确只改文档或项目执行约定的
任务。该数字用于定位证据问题，不表示 29 张任务都未达到用户要求。

## 评估结果

### P0：手工验收事实无法更新 submission

#### 证据

- 固定样本中 7 张留下浏览器或真实流程未验证项；
- 37 张候选任务中 29 张留下同类未验证项；
- 其中 14 张的 follow-up 同时表示「无后续」或「无剩余工作」；
- 部分 closure 的 `unverified` 表示仍需手工确认，follow-up 却表示用户已经测试并确认。

两个业务 repo 都明确规定：浏览器自动化只在用户明确要求时执行，常规情况下由用户
完成页面验收。因此，未启动浏览器本身不是流程错误。问题在于用户验收发生在 submit
之后时，当前命令只能修正 submission 的 `knowledge_impact`，不能更新
`verified` 或 `unverified`；`done` 会把旧 submission 原样复制到 closure。

#### 影响

- 归档数据无法区分「尚未验证」「用户已经验证」和「用户明确接受剩余风险」；
- follow-up 被迫同时承担未来动作和历史验收说明；
- 后续恢复时需要解释相互矛盾的字段。

#### 推荐

先创建流程级任务，不立即增加 schema：

1. 在 Skill 的 review closeout 中核对 submission 的 `unverified` 与用户最新验收事实；
2. 仍有未验证项时，follow-up 必须写明责任人、下一步或明确的风险接受事实；
3. 不允许只写「无后续」而不解释剩余未验证项；
4. 收集一轮新样本后，再决定是否需要 review acceptance event 或 submission
   evidence patch。

若流程级修正仍需要依赖 follow-up 覆盖旧事实，再单独设计 Core 能力。设计时应比较：

- 新增 `review_acceptance` event；
- 允许在实现快照不变时修正 submission 的 `verified` 和 `unverified`；
- 保持当前结构，只收紧 closure 摘要规则。

### P0：描述性命令可以伪装成 gate

#### 证据

固定样本中的「过滤 display_config 非指标字段」把
`echo 手动步骤：……` 配置为 gate。命令返回 0 后会被记录为 pass，但没有执行页面操作。
closure 随后又把该步骤称为 diagnostic，与 plan 中的 `kind: gate` 不一致。

#### 影响

- gate pass 不再等于可执行证明已经完成；
- `verify-all` 可以自动通过本应由用户完成的步骤；
- submission 的 gate 摘要可能高估验证范围。

#### 推荐

优先修改 Skill、手册和契约测试：

1. `echo`、`printf`、`true` 和纯说明命令不得作为 gate；
2. 手工步骤写入 diagnostic 或 submission 的 `unverified`；
3. 用户完成手工步骤后，记录明确的验收事实；
4. CLI 是否拒绝已知 no-op 命令另建设计任务评估，不在 Core 中尝试自然语言判断。

### P0：A/B/C 的「多 gate」规则与实际使用不一致

#### 证据

当前权威定义把「多 gate」作为 C/Standard 信号。37 张候选任务中有 19 张 Light，
其中 9 张包含多个 gate，4 张 scope 达到 5 项以上。

典型任务包括：

- `ECharts 阶段 2：P0 全量接入`：Light、5 个 gate、5 项 scope；
- `阶段 3：Dial 与 WaterPolo Series 配置`：Light、3 个 gate、5 项 scope；
- `CMP-01 Palette 元数据不可变`：Light、4 个 gate；
- `修复预览播放排名标签与多链路恢复`：Light、4 个 gate，并发生 2 次 plan change。

机械的 lint、文档索引、diff 和 build 检查可以同时存在于低风险改动中。仅按 gate
数量升级 Standard 会增加流程成本，但继续保留现有文字又会让实际使用长期违反契约。

#### 推荐

修订产品契约，不按 gate 数量自动决定 profile：

- 多个机械检查不单独触发 Standard；
- 多个独立验收面、产品选择、公共契约或高风险面触发 Standard；
- Light 在实施中出现 plan change、产品选择或 scope 扩大时，必须重新执行 A/B/C
  判断，并在需要时升级为 Standard；
- Core 不根据命令数量自动升级 profile，语义判断继续由 Skill 承担。

### P1：grill 的关键决定缺少持久化证据

#### 证据

- 固定样本没有 `decision_recorded`；
- 37 张候选任务只有 1 条 `decision_recorded`；
- 归档不保存聊天，无法从 task 数据直接统计实际提问次数。

因此，当前数据可以从后期 plan change 和 review correction 推断部分 under-grill，
但不能证明实施前已经解决了哪些阻塞问题。

#### 推荐

- A 类请求可以先创建带 `open_questions` 的 Standard task，并保持在 `plan`；
- 只记录会改变 scope、产品行为、兼容策略或风险接受方式的决定；
- 不保存完整聊天，不为每轮追问创建 event；
- plan change 在 review 后发生时，摘要应说明原问题为何未在实施前解决。

### P1：计划字段完整不等于方案稳定

#### 证据

37 张候选任务中有 15 张发生 review feedback，10 张发生 implementation correction。
「服务与支持日志与数据导出」已使用 Standard，但仍发生 5 次 implementation
correction，涉及控件形态、版本显示、管理员权限、点击区域和页面布局。

「对齐探针基本信息列」虽然是单文件 Light task，仍在 review 中补充长文本、省略、
Tooltip 和键盘 focus。该例更接近正常 UI 迭代，不应与权限或产品语义缺失等同处理。

#### 推荐

Standard approve 前增加语义检查，不增加新的 plan 字段：

- 是否仍存在两个以上合理的用户行为；
- 权限来源、默认值和兼容策略是否唯一；
- 空数据、长文本、无权限和旧数据是否已有处理结论；
- 未决项是否只是实现细节，还是会改变用户可见结果。

review correction 的评估应区分：

- 未提前解决的产品选择；
- 根因证据不足；
- 实现遗漏；
- 正常视觉迭代；
- 用户新增的精确 delta。

### P1：takeover 存在可见成本

#### 证据

37 张候选任务中有 9 张发生 takeover，共 11 次；固定样本中有 2 张发生 takeover，
共 4 次。没有证据表明 takeover 造成授权或 task 事实错误。

#### 推荐

先继续使用当前 review closeout fast path，并在后续归档中区分：

- 为继续实施而 takeover；
- 只为运行 gate、submit 或 done 而 takeover；
- 同一 task 多次往返 takeover。

如果 takeover 主要发生在已通过 gate 的 review task，再评估进一步压缩收尾命令；
不放松 primary writer 和显式 takeover 约束。

### P1：扩大样本不是 37 个独立产品情境

固定样本由 8 张 `monitoring` 和 2 张 `appearance-sec` 组成。37 张候选中有 29 张
来自 `monitoring`，其中多张属于连续的 CMP 和 ECharts 分段任务，彼此共享代码、
文档和验证方式。

因此，本评估可以判断 Vue UI、组件配置、文档治理和跨 session 任务的使用问题，
但不能直接推广到后端服务、数据库迁移、破坏性数据操作或公共 API 变更。Loom 没有
Latch 归档，也不能提供对照。

无需等待更多任务后再处理 P0 问题。只有需要声称「适用于不同类型项目」时，才应
在另行授权的 repo 中增加独立样本。

## 不作为问题处理的信号

### 失败 gate

37 张候选任务中有 7 张出现失败 gate，共 8 次失败运行，最后均完成修正并通过。
失败主要来自文档索引、diff、静态 registry 和局部类型检查。这说明 gate 能拦截问题，
不能把失败次数直接解释为流程质量下降。

### blocked 为零

没有 task 记录 blocked。该结果不等于没有等待条件，因为登录态、真实数据和用户手工
验收通常被写入 `unverified` 或 follow-up。blocked 只表示 task 是否因外部条件不能继续
实施，不用于替代剩余验证说明。

### revision conflict

失败的 revision mutation 通常不能同时写入 task event。当前归档没有足够证据时，
revision conflict 必须记为「未知」，不能按 0 次处理。

### 未启动浏览器

两个业务 repo 都把浏览器执行权限保留给用户。评估不建议自动启动浏览器，也不把
所有未启动浏览器的 task 判为失败；需要修正的是验收事实的记录方式。

## 后续任务

| 优先级 | 建议任务 | 主要层级 | 完成标准 |
|---|---|---|---|
| P0 | 收紧手工验收与归档事实规则 | Skill、手册、契约测试 | `unverified` 与 follow-up 不再无解释地矛盾 |
| P0 | 禁止描述性命令作为自动 gate | Skill、手册、契约测试 | 手工步骤只进入 diagnostic 或明确验收事实 |
| P0 | 修订 A/B/C 的多 gate 判定 | 产品契约、Skill、AGENTS | 机械检查不决定 profile，独立风险面决定 Standard |
| P1 | 提高阻塞决定的记录率 | Skill、使用场景、契约测试 | 关键产品选择使用 `decision_recorded`，不保存聊天 |
| P1 | 设计 review 手工验收证据 | 产品设计、CLI/Core 候选 | 明确是否需要 event 或 submission evidence patch |
| P1 | 评估 review closeout takeover 成本 | 只读观察、Skill | 区分实施 takeover 与仅收尾 takeover |
| P2 | 扩展非 UI 样本 | 另行指定 repo | 只在需要跨项目推广结论时执行 |

### 推荐顺序

1. 先实施三个 P0 文档和 Skill 任务，不增加 schema；
2. 使用后续真实任务检查 closure、gate 和 profile 分类是否改善；
3. 只有流程修正仍无法表达用户验收事实时，才启动 review evidence 的 Core 设计；
4. handoff 和样本扩展不阻塞 P0 修正。

## 不建议的改法

- 不保存完整聊天或 grill 逐轮记录；
- 不根据 gate 数量在 Core 中自动升级 profile；
- 不把浏览器自动化变成默认授权；
- 不重写已经归档的 task；
- 不为无法持久化的 revision conflict 推断零次；
- 不在本次评估中删除 v1 备份；
- 不把 37 张相关性较高的候选任务解释为 37 个独立产品情境。

## 本次评估边界

本文件是已批准的观察期评估，不修改 current 产品契约。后续任务必须分别展示计划并获得
明确授权。v1 备份是否删除、CLI/Core 是否修改、外部 repo 是否接入，均不由本评估
自动授权。
