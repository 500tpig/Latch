# Latch gate 有界输出契约

Source-Task: `20260813033522311-设计-latch-gate-有界输出契约-86cf23`

Document-Status: `approved`

Date: 2026-08-12

## 1. 地位与范围

本文件冻结 `verify`、`verify-all` 和底层 command runner 的 stdout/stderr 输出契约，供后续
独立 implementation task 使用。本文件不是 current CLI 行为说明，不修改 CLI、Core、task
schema、event schema、workspace evidence 或 gate pass 规则，也不授权进程执行改动。

首版采用不持久化方案：Latch 在本次命令运行期间统计原始字节数，并保留有界 head/tail
摘要；默认命令结束后返回摘要，显式 verbose 时同时实时转发完整输出。完整输出、摘要和字节
计数均不写入 task、event、workspace evidence、临时文件或聊天。

本契约解决以下问题：

- 默认 human 模式不再把无界 gate 输出直接继承到终端；
- 成功与失败都返回确定上限的逐 stream 摘要；
- JSON protocol stdout 永远不混入 gate 输出；
- verbose 不要求日志存储，也不虚构 `log_ref`；
- `verify`、`verify-all` 和后续 formatter 共用一套进程、计数、截断与终止语义。

## 2. Current 基线与缺口

CLI `0.5.0` 的 current 行为如下：

- human `verify` / `verify-all` 使用 inherited stdio，实时转发完整 stdout 和 stderr；
- JSON 模式捕获输出，成功时不返回日志，失败时分别返回最后 8192 字节；
- current `failure_log` 只保留 tail，不返回成功输出字节数或 duration；
- command runner 使用 `spawn`，不经过 shell，没有 timeout，也没有 `exec` / `execFile`
  `maxBuffer`；
- 完整日志不写入 task、event、workspace evidence 或临时文件。

缺口不是「失败日志太少」这一项，而是 human 与 JSON 使用两套执行模式，成功与失败的字段不
一致，输出量和耗时不可见，signal 被折算为哨兵 exit code，后续调用方容易再实现一套 runner。

## 3. 已确认决策

1. verbose flag 固定为 `--verbose`，不提供短 flag、别名或环境变量。
2. timeout flag 固定为 `--timeout-ms <milliseconds>`；省略时不设置 timeout。
3. `verify-all --timeout-ms` 对每个实际启动的 gate 分别计时，不是整条命令的总时限。
4. stdout 与 stderr 始终分别计数、分别摘要；不得先合并再截断。
5. 默认成功摘要每个 stream 最多保留 4096 个原始字节，按 head 2048 / tail 2048 分配。
6. 默认失败摘要每个 stream 最多保留 16384 个原始字节，按 head 4096 / tail 12288 分配。
7. runner 始终使用 pipe 和有界 rolling buffer；不提供 `--max-buffer`，也不因输出量大而终止
   子进程。
8. human 默认输出和 JSON envelope 都使用同一个 command result；不得为不同 formatter
   重新执行命令或重新计算摘要。
9. JSON 模式下 protocol 只写 stdout。`--json --verbose` 把两个 gate stream 的完整原始字节
   都转发到父进程 stderr，最终 JSON envelope 仍单独写 stdout。
10. 首版不持久化日志，所有响应都省略 `log_ref`；不得返回 `null`、伪路径、evidence ref 或
    聊天引用冒充日志引用。
11. workspace evidence sidecar 继续只证明工作区 snapshot 和 delta，不保存普通 gate 日志、
    摘要、duration 或 stream 字节数。
12. current `failure_log` 由统一的 `verification.stdout` / `verification.stderr` 投影取代，不保留
    双协议或兼容 fallback；实现切换时同步更新 current 文档、测试和直接 reader。

## 4. CLI 参数

### 4.1 命令形态

```bash
latch verify <task-id> \
  --expect-revision <revision> \
  --name <name> \
  [--diagnostic] \
  [--verbose] \
  [--timeout-ms <milliseconds>] \
  [--json] \
  [-- command...]

latch verify-all <task-id> \
  --expect-revision <revision> \
  [--verbose] \
  [--timeout-ms <milliseconds>] \
  [--json]
```

`--verbose` 只改变本次运行期间是否实时转发完整 gate 输出，不改变摘要、task mutation、gate
结果、proof、revision 或 exit status。`--verbose` 可与 `--json`、`--diagnostic` 和
`--timeout-ms` 组合。

`--timeout-ms` 只接受十进制正整数 `1..86400000`。无效、重复或超出范围的值在 task 读取和
子进程启动前返回 `invalid_arguments`。省略该 flag 表示没有 runner timeout，保持 current
无限等待语义。timeout 只能把一次执行变为失败，不能使失败命令通过，因此不写入 plan 或
authorization。

不增加以下入口：

- `--verbose-output`、`--show-output` 或 `-v`；
- `--max-buffer`、`--max-buffer-bytes` 或对应环境变量；
- `--log-file`、`--save-log`、`--log-ref` 或日志查看命令；
- plan 中的 timeout 或 output policy 字段。

## 5. Command result 模型

### 5.1 Ephemeral projection

每个实际选择的 gate 只生成一个 ephemeral command result。该结果用于当前 CLI 响应，不进入
`task.verification` 或 event；持久化的 gate proof 继续使用 current `VerifyResult`、
`command_outcome`、workspace effect 和 evidence ref。

JSON 中 `verification` 的默认投影为：

```json
{
  "name": "project-check",
  "status": "pass",
  "exit_code": 0,
  "duration_ms": 1432,
  "stdout": {
    "bytes": 221,
    "summary": {
      "limit_bytes": 4096,
      "head_limit_bytes": 2048,
      "tail_limit_bytes": 2048,
      "head_bytes": 221,
      "tail_bytes": 0,
      "head": "...",
      "tail": "",
      "omitted_bytes": 0,
      "truncated": false,
      "invalid_utf8": false
    }
  },
  "stderr": {
    "bytes": 0,
    "summary": {
      "limit_bytes": 4096,
      "head_limit_bytes": 2048,
      "tail_limit_bytes": 2048,
      "head_bytes": 0,
      "tail_bytes": 0,
      "head": "",
      "tail": "",
      "omitted_bytes": 0,
      "truncated": false,
      "invalid_utf8": false
    }
  }
}
```

成功时只返回 gate identity、`status`、`exit_code`、`duration_ms` 和两个 stream 的字节数及
摘要。outer mutation envelope 继续返回 revision、phase、warnings、`next_action` 与既有
bounded lifecycle 投影，但不把完整 command、proof、workspace delta 或 task truth 复制到
`verification`。

失败时复用同一 shape，并只按原因增加必要字段：

```json
{
  "name": "project-check",
  "status": "fail",
  "failure_reason": "command_failed",
  "exit_code": null,
  "termination": "signal",
  "signal": "SIGTERM",
  "duration_ms": 1432,
  "stdout": {},
  "stderr": {}
}
```

允许的 additive failure 字段为：

- `failure_reason`：复用 gate current failure reason；timeout 和 signal 仍属于
  `command_failed`，不扩大持久化枚举；
- `termination`：`not_started`、`spawn_error`、`signal`、`timeout` 或 `runner_error`；
  正常 exit 时省略；
- `signal`：子进程确实因 signal close 时返回 Node.js signal name，否则省略；
- `timeout_ms`：只在 timeout 触发时返回调用值；
- `error`：只用于 spawn error 或 runner error，shape 为
  `{ "code": string|null, "message": string }`，`message` 经 UTF-8 安全截断后最多
  2048 字节。

`exit_code` 表示 OS 提供的真实退出码。正常 exit 为非负整数；signal、timeout、spawn error、
runner error 和命令未启动时为 `null`。不得使用 `127` 或 `128 + signal` 冒充真实 exit code。
current task 内部为兼容 schema 5 保存的哨兵值不属于本 ephemeral 输出契约；后续如需修正
持久化 shape，必须另行设计 schema 和 reader 迁移，不能在本 implementation task 中静默修改。

### 5.2 Stream summary shape

stdout 和 stderr 使用完全相同的字段：

| 字段 | 语义 |
|---|---|
| `bytes` | 从该 pipe 收到的原始字节总数，不是字符数或 JSON 序列化后的长度 |
| `limit_bytes` | 当前 gate status 对应的逐 stream 保留上限 |
| `head_limit_bytes` | 截断时允许从 stream 起点选择的原始字节上限 |
| `tail_limit_bytes` | 截断时允许从 stream 末尾选择的原始字节上限 |
| `head_bytes` | 实际送入 head decoder 的原始字节数 |
| `tail_bytes` | 实际送入 tail decoder 的原始字节数 |
| `head` / `tail` | 两段分别解码的 UTF-8 文本；未截断时全文只放入 `head` |
| `omitted_bytes` | `bytes - head_bytes - tail_bytes`，不得为负数 |
| `truncated` | `omitted_bytes > 0` |
| `invalid_utf8` | 任一实际保留段包含无效 UTF-8 或因切片边界产生 replacement 时为 `true` |

未截断时不拆分：`head_bytes == bytes`、`tail_bytes == 0`、`tail == ""`。截断时 head 与
tail 按固定配额从原始 stream 两端选择，不按行、字符、ANSI escape 或测试框架格式重新分配；
中间省略区不插入伪日志文本。formatter 根据 `omitted_bytes` 展示省略说明。

`bytes`、`head_bytes`、`tail_bytes` 和 `omitted_bytes` 使用 JSON safe integer。runner 内部
计数一旦超过 `Number.MAX_SAFE_INTEGER`，立即终止子进程并返回 command failure
`termination: "runner_error"` 和 `error.code: "OUTPUT_BYTE_COUNT_OVERFLOW"`；不得继续返回
不精确计数。该边界只防止错误数据，不是正常的输出量限制。

### 5.3 成功与失败配额

| gate 最终状态 | 每个 stream 上限 | head | tail | 两个 stream 最多保留 |
|---|---:|---:|---:|---:|
| `pass` | 4096 bytes | 2048 bytes | 2048 bytes | 8192 bytes |
| `fail` | 16384 bytes | 4096 bytes | 12288 bytes | 32768 bytes |

runner 从开始就为每个 stream 保留 failure 所需的 4096-byte head 与 12288-byte tail ring，
因此可以在 workspace after evidence 完成、gate 最终 status 已知后选择 success 或 failure
投影。runner 不得先按 success 上限丢弃数据，再在失败时尝试扩大摘要。

默认输出的 gate 日志贡献具有确定上限。两个失败 stream 最多选择 32768 个原始字节；按
JSON string 最坏的 `\u00xx` escape 计算，序列化文本最多占 196608 bytes，另加固定字段和
既有 bounded mutation envelope。成功日志对应上限为 49152 bytes。`--verbose` 的完整实时
转发是显式无界输出，不计入默认响应上限。

## 6. UTF-8、换行与超大输出

### 6.1 Invalid UTF-8

字节计数和 head/tail 选择先于解码。每个实际保留段独立使用 WHATWG UTF-8 decoder 的
replacement mode；无效序列和切片边界的不完整序列替换为 `U+FFFD`，并设置
`invalid_utf8: true`。不得抛出解码异常、静默删除字节、跨省略区拼接 code point 或把摘要
改为 base64。

human 默认 formatter 必须把 `head` 和 `tail` 渲染为 JSON string literal。换行、tab、
引号、反斜杠、ESC 和其它控制字符均显示为 escape，不得在默认模式向终端回放原始控制序列。
JSON 模式由 JSON serializer 执行相同 escaping。

### 6.2 无换行与单个超大 chunk

摘要不依赖换行。一个没有换行的任意长度 stream 与多行输出使用相同字节配额和切片规则。
单个 chunk 大于 tail ring 时，只复制所需 head 和最后 tail 配额，不能临时保留整个 chunk。

verbose 实时转发保持收到的原始 chunk 字节，不补写日志内容。CLI-owned 最终 human 摘要或
终端 prompt 需要换行时，formatter 可在最后一个转发字节不是 LF 的目标 parent stream 上写
一个 framing LF；该 LF 不计入 gate `bytes` 或摘要，也不声称属于 gate 输出。

### 6.3 超大输出与 backpressure

runner 使用 `spawn` pipe、固定 head buffer、固定 tail ring 和整数计数，内存占用不随输出量
增长。默认模式只消费 pipe，不实时转发。verbose 模式遵守 parent stream backpressure：
`write()` 返回 `false` 时暂停对应 child pipe，等待 `drain` 后恢复。不得通过无界用户态队列
绕过 backpressure。

输出超过摘要配额只设置 `truncated` 和 `omitted_bytes`，不会产生 `maxBuffer` error，也不会
终止 gate。实现不得换成带隐式 `maxBuffer` 的 `exec`、`execFile` 或同步 API。

## 7. Stream 行为

| 模式 | gate stdout | gate stderr | CLI protocol / summary |
|---|---|---|---|
| human 默认 | 只捕获，不实时转发 | 只捕获，不实时转发 | 有界 human result 写 parent stdout；warnings 写 parent stderr |
| human `--verbose` | 原始字节实时转发到 parent stdout | 原始字节实时转发到 parent stderr | 命令结束后仍写同一有界 human result |
| JSON 默认 | 只捕获，不实时转发 | 只捕获，不实时转发 | 唯一最终 JSON envelope 写 parent stdout；gate 输出不写 parent stderr |
| JSON `--verbose` | 原始字节实时转发到 parent stderr | 原始字节实时转发到 parent stderr | 唯一最终 JSON envelope 写 parent stdout |

JSON verbose 合并到 parent stderr 只用于观看完整本次输出。每个 child stream 内的字节顺序必须
保持，两个 stream 之间的全局顺序按 pipe chunk 到达顺序 best effort，不承诺逐字节时序，也
不插入 stream label。结构化 envelope 中的逐 stream 摘要仍保持分离。

JSON 参数、lifecycle、writer、revision 或其它 preflight 在 spawn 前失败时，错误 envelope
继续只写 parent stderr，stdout 为空。子进程已开始后的 gate fail 是成功完成的 CLI mutation
响应：最终 envelope 写 stdout，CLI process exit status 为 1；verbose gate 字节可已写 stderr，
但 stderr 不再承诺是 JSON error channel。调用方选择 `--json --verbose` 即显式接受 stderr 为
人类观察 stream，只从 stdout 解析协议。

human result 的固定顺序为 gate header、stdout summary、stderr summary。每个 summary 先显示
总 `bytes`、`truncated` 和 `omitted_bytes`，再按 `head`、`tail` 顺序显示非空 JSON string
literal。`verify-all` 按 plan 顺序为每个实际执行的 gate 输出同一 block，最后输出 aggregate
状态；不得把多 gate stdout/stderr 合并为一个 task-level 摘要。

## 8. 进程终止与 duration

### 8.1 Duration

`duration_ms` 使用 monotonic clock，返回四舍五入到最近整数的毫秒：

- 起点：完成 gate before evidence 后、调用 `spawn()` 紧前；
- 终点：child `close` event 到达，即 process 已结束且 stdio 已关闭；
- 包含 `spawn()`、子进程运行、pipe drain，以及 timeout 后的 TERM/KILL grace period；
- 不包含 gate before/after workspace evidence、task mutation、JSON serialization 或 human
  formatting；
- spawn error 从 `spawn()` 紧前计到对应 `close`；命令因 evidence preflight 未启动时为 `0`。

系统 wall clock 调整不得影响 duration。`duration_ms` 只属于本次响应，不写入 task 或 event。

### 8.2 Normal exit

child 正常退出时返回 OS exit code。exit code 0 只证明 command outcome 成功；workspace
mutation、evidence error 或 unresolved violation 仍可使 gate `status` 为 `fail`。摘要配额按
最终 gate status 选择，而不是只按 exit code 选择。

### 8.3 Signal

没有 timeout 且 child 因 signal close 时：

- `status: "fail"`；
- `failure_reason: "command_failed"`；
- `exit_code: null`；
- `termination: "signal"`；
- `signal` 返回 Node.js `close` event 的 signal name；
- stdout/stderr 返回 failure 配额摘要。

不得合成 `128 + signal`。如果平台没有提供 signal name，省略 `signal`，保留
`termination: "signal"`。

### 8.4 Spawn error

`spawn()` 的 `error` event 使结果为：

- `status: "fail"`、`failure_reason: "command_failed"`；
- `exit_code: null`、`termination: "spawn_error"`；
- stdout/stderr 使用已实际收到的字节，通常为 0；
- `error.code` 使用可用的 Node.js error code，否则为 `null`；
- `error.message` 最多 2048 个 UTF-8 bytes，不包含 stack trace。

runner 必须等待 `close` 后结算 duration 和 stream，不得只在 `error` event 提前返回。spawn
error 不创建日志文件，不返回 `log_ref`。

### 8.5 Timeout

达到 `--timeout-ms` 时，runner 在产品支持的 macOS/POSIX 环境向 child process group 发送
`SIGTERM`，等待固定 2000 ms；进程组未结束时发送 `SIGKILL`。command 不经过 shell，但使用
独立 process group，避免只终止直接 child 而留下持有 pipe 的后代。

timeout 一旦触发，即使 child 在 TERM grace period 内以 0 退出，结果仍为：

- `status: "fail"`、`failure_reason: "command_failed"`；
- `exit_code: null`、`termination: "timeout"`；
- `timeout_ms` 为调用值；
- child close 提供 signal 时同时返回 `signal`；
- duration 计到最终 close，允许大于 `timeout_ms`，但正常只多出最多约 2000 ms 加调度开销；
- stdout/stderr 继续 drain，并使用 failure 配额摘要。

如果 `SIGKILL` 后 process group 仍未 close，runner 保持等待并在 parent 收到退出信号时按平台
规则退出；首版不伪造 close、duration 或成功状态。该极端情况需要实现测试使用可控子进程，
不得依赖固定 sleep 竞争。

### 8.6 Max buffer 与 byte counter overflow

本契约没有 max-buffer termination。rolling buffer 达到固定容量后覆盖旧 tail，继续统计总
字节。只有超过 JSON safe integer 的 byte counter 属于 runner error；此时向 process group
执行与 timeout 相同的 TERM/KILL 序列，返回 `status: "fail"`、
`failure_reason: "command_failed"`、`termination: "runner_error"` 和 bounded error code，
不能把该情况标成 timeout 或正常截断。

## 9. `verify` 与 `verify-all`

`verify` 返回一个 `verification` projection。`verify-all.executed[]` 对每个实际执行的 gate
复用同一 projection，只增加该 gate mutation 后的 `revision`；不得维护简化版第二 shape。

`verify-all` 继续遵守 current 顺序和停止规则：

- 按 approved plan 顺序选择 current generation 中第一个非 current gate；
- 每个 gate 使用独立 command result、独立 timeout 和独立 stdout/stderr 摘要；
- 首个 command failure、timeout、signal、spawn error、evidence error、workspace mutation、
  scope violation 或 gate 间 baseline mismatch 后停止；
- 未启动的后续 gate 只留在 `remaining`，不创建零字节伪 execution；
- gate 间 baseline mismatch 发生在下一命令启动前时，`stopped_gate` 指向未启动 gate，但
  `executed` 不增加该项；
- 没有 pending gate 时 `executed: []`，不返回 task-level stdout/stderr 空摘要。

`verify-all` 的日志保留上限按每个实际执行 gate 计算，总响应大小受 approved plan 中实际执行
gate 数量线性约束。首版不截断 `executed`，因为每个 gate 的 mutation revision 都是调用方继续
流程所需事实；后续若 plan gate 数量需要绝对上限，应在 plan validation 独立设计，不能从
command runner 静默丢项。

human 与 JSON 使用相同结果对象。human formatter 只改变展示，不重新合并 stream、重新截断
或从 escaped 文本反推原始字节数。

## 10. 非持久化与 evidence 边界

首版没有证明必须持久化完整 gate 日志。默认有界摘要满足直接诊断，`--verbose` 满足本次运行
的完整观察；持久化会新增敏感信息、磁盘占用、权限、archive 和清理责任，因此不纳入首版。

以下位置均不得保存普通 gate stdout/stderr、摘要或 stream byte count：

- `.latch/tasks/<task-id>/task.json`；
- `.latch/tasks/<task-id>/events.jsonl`；
- `.latch/tasks/<task-id>/evidence/*.json`；
- `.latch/archive/`；
- 临时目录、Record、聊天或隐藏的全局 cache。

因此所有 human 和 JSON 响应都完全省略 `log_ref`。`workspace_proof.before_ref`、
`after_ref`、`delta_ref` 只能引用 workspace evidence sidecar；它们不能改名、复制或展示为 gate
日志引用。stdout/stderr 内容、摘要、hash、字节数或 exit code 也不能成为 workspace proof。

如果真实使用证明需要跨进程日志引用，必须先建立独立 Standard design task，并同时冻结：

- project-local 或外部存储位置，以及 symlink/path escape 边界；
- 文件和目录权限、敏感信息暴露模型及 reader 权限；
- task、event 与日志对象的引用完整性和 hash；
- open task、review、done、abandon 与 archive 的生命周期；
- retention、容量、显式清理命令、失败恢复和并发边界；
- archive move、backup、restore、schema reader 与 adopter 行为。

缺少任一项时不得先返回临时 `log_ref` 再补存储实现。

## 11. Formatter 复用边界

后续 formatter 或其它需要执行外部 command 的功能必须复用同一个通用 command runner。runner
输入至少包括 argv、cwd、output mode、timeout 和 parent stream sink；返回本文件定义的原始
byte counts、failure-size rolling buffers、duration、exit code、signal、termination 与 bounded
error。

调用方负责把 command result 解释为 gate、diagnostic 或 formatter outcome，但不得：

- 复制 `spawn`、timeout、process-group kill、UTF-8 或 head/tail 算法；
- 使用 `exec` / `execFile` 和另一套 `maxBuffer`；
- 为 formatter 改变 JSON stdout 隔离规则；
- 把 formatter stdout/stderr 写入 workspace evidence；
- 因 argv 包含 `format`、`--fix` 或工具名称而跳过 workspace after evidence。

如果 formatter 作为 gate 执行并修改 covered workspace，current workspace mutation 规则仍拒绝
gate pass。复用 runner 只统一进程执行和输出契约，不赋予 formatter mutation 例外。

## 12. 后续 implementation task

### 12.1 Scope

后续建立一张独立 schema 5 Standard implementation task，最小 material scope 为：

- 将 `src/core/progress/command-output.ts` 收敛为通用 streaming command runner，增加 monotonic
  duration、逐 stream byte counter、failure-size head/tail rolling buffer、backpressure、
  timeout 和 process-group termination；
- 在 `src/core/progress/verification.ts` 复用单一 command result，按最终 gate status 选择
  success/failure projection，不改变 workspace evidence 和 pass 判定；
- 在 `src/commands/review.ts` 与 `src/commands/usage.ts` 增加 `--verbose`、
  `--timeout-ms` 和统一 human/JSON formatter；
- 更新直接类型，但不把 ephemeral output 写入 `TaskV2`、`VerifyResult` 或 event；
- 更新 `tests/review.test.mjs`，并按需新增聚焦 command runner 的单元测试；
- 更新 `docs/HANDBOOK.md`、`docs/DESIGN.md`、canonical Skill 和对应 docs/CLI tests，使 current
  文档在实现交付后取代本文的 proposed 行为说明。

该 task 不实现持久化日志、`log_ref`、日志查看命令、task schema migration、Record、聊天
保存、跨 repo reader、formatter 产品功能或 workspace evidence schema 变化。

### 12.2 Acceptance

- `verify`、diagnostic 和 `verify-all` 接受相同的 `--verbose` 与 `--timeout-ms` 规则；无效参数在
  spawn 前拒绝且不写 task、event 或 evidence；
- 四种 human/JSON × default/verbose stream 行为与第 7 节完全一致，JSON stdout 在所有 gate
  output 情况下均可解析为唯一 envelope；
- success 与 failure 的逐 stream byte count、配额、head/tail、omitted、UTF-8 和 escaping 与
  本契约逐字段一致；
- 默认模式对任意大输出保持常量日志内存，不触发 max-buffer termination；verbose 遵守
  backpressure 并转发全部实际收到的字节；
- normal exit、signal、spawn error、timeout、not-started 和 byte counter overflow 的
  `exit_code`、termination、signal、duration 与 failure 语义一致；
- `verify-all.executed[]` 复用单 gate projection，首个失败停止，未启动 gate 不生成伪 result；
- task、event、evidence、archive 和临时目录均不出现日志内容、摘要、byte count、duration 或
  `log_ref`；
- existing workspace mutation、proof generation、revision、submit 和 JSON error envelope tests
  保持通过；
- current `failure_log` reader/tests 一次性迁移到新 projection，不保留双写或 fallback；
- `pnpm check` 和 `git diff --check` 通过，并完成 human 与 JSON 真实 CLI 流程验收。

### 12.3 测试矩阵

| 类别 | 用例 |
|---|---|
| flags | `--verbose` 单独/配 `--json`/配 diagnostic；timeout 边界 1、86400000、0、负数、小数、overflow、重复 |
| success | stdout only、stderr only、双 stream、空输出、exit 0、duration 非负、4 KiB 上下边界、head/tail 配额 |
| failure | non-zero、exit 0 但 workspace mutation、evidence after error、16 KiB 上下边界、head 4 KiB + tail 12 KiB |
| UTF-8 | ASCII、中文、多字节字符恰跨 head/tail 边界、原生 invalid bytes、控制字符、ESC、JSON escaping |
| shape | 未截断全文仅在 head、tail 为空；omitted 等式；JSON safe integer；无 `failure_log`、无 `log_ref` |
| large output | 单个超大 chunk、许多小 chunk、无换行、多行、stdout/stderr 同时持续写、常量 rolling buffer |
| human default | 不实时回放；固定 block 顺序；摘要使用 JSON literal；warnings 只写 stderr；无换行 framing |
| human verbose | stdout 到 stdout、stderr 到 stderr、完整字节、backpressure、最终有界 result、无换行 framing |
| JSON default | 成功/失败 stdout 各只有一个 envelope；gate 输出不进入 stderr；preflight error 只在 stderr |
| JSON verbose | 两个 gate stream 只到 stderr；stdout 始终为一个 envelope；per-stream 摘要仍分离；无 stream label |
| process exit | normal 0、normal non-zero、SIGTERM、SIGKILL、signal name 缺失、spawn ENOENT、spawn EACCES |
| timeout | TERM 内退出、需要 KILL、后代持有 pipe、timeout 后输出 drain、duration 包含 grace、结果不能转 pass |
| max buffer | 输出远超 16 KiB 不终止；不使用 `exec` / `execFile`；byte counter overflow 使用可注入小阈值单测 |
| verify-all | 0 gate、1 gate、多 gate、每 gate 独立 timeout、首个失败停止、baseline mismatch 不生成伪 execution |
| persistence | task/event/evidence/archive/temp 不含摘要或完整日志；没有任何模式返回 `log_ref` |
| proof regression | command outcome、workspace mutation、scope violation、generation、submit freshness 与 current 行为一致 |
| runner reuse | fake formatter consumer 复用同一 runner result；不复制 spawn/截断/timeout；formatter 输出不进入 evidence |

## 13. 非目标

- 不把 Latch 变成日志存储、terminal recorder 或远程 observability 服务；
- 不保证 verbose 下 stdout/stderr 的全局逐字节时序；
- 不把 ANSI、progress bar 或 carriage return 解释为屏幕最终状态；
- 不按行、测试 case、日志等级或工具格式提取摘要；
- 不压缩、加密、上传、索引或搜索 gate 输出；
- 不通过聊天、Record、workspace evidence 或 artifact 保存完整日志；
- 不改变 gate command argv、shell 边界、workspace proof 或 formatter mutation 规则；
- 不在本设计 task 中修改任何 CLI 或 Core 行为。
