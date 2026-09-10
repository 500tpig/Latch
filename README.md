# Latch

Latch 是给 AI coding task 使用的本地任务记录 CLI。它把计划、批准、验证结果和待确认事项保存在项目的 `.latch/` 中，帮助在中断后查明「做到哪里、依据是什么、下一步需要谁决定」。它不保存完整聊天，也不保证提高效率或避免错误。

这是 **0.6.1 早期试用版**，目标是收集安装、流程和恢复反馈。

## 什么时候使用

适合与 coding agent 合作、需要跨会话继续任务，或希望明确记录计划批准、验证证据和未完成事项的开发者。

一次就能完成的小改动、纯问答或已有工具足以记录的工作通常不需要 Latch。目录存在 `.latch/` 只表示支持 Latch，不要求每次修改都创建 task。Record 是按明确请求保存和召回的项目记录，不是自动记忆。

`workspace_scope.paths` 约束 task 的写入与验证流程，**不是工作区隔离或文件访问沙箱**。Agent 仍能修改共享目录，Latch 也不替代代码审查、Git 或测试。

## 环境和安装

本次试用验证环境：macOS 26.6.2 arm64、Node.js 22.22.3、pnpm 11.6.0、Git，以及运行本次检查的 Codex 会话。其他 macOS 版本、Linux、Windows 和其他宿主尚未完成本次验证。

前置条件：已安装 Node.js 22、pnpm 11 和 Git，能访问依赖 registry。task 写入还需要宿主提供稳定的会话 ID；当前 Codex 适配读取 `CODEX_THREAD_ID`。缺少有效身份时只能读取，不能靠手工设置 `LATCH_ACTOR` 绕过。不要将普通终端可运行 `--help` 理解为已验证 task 写入。

从 [GitHub 仓库](https://github.com/500tpig/Latch) 下载源码并解压，或运行 `git clone https://github.com/500tpig/Latch.git`，然后进入源码根目录。本仓库是脱敏后的公开试用源码，以全新 Git 历史发布。以下命令在 Codex 会话的 shell 中执行，不安装全局 CLI，也不修改 Skill 链接。

<!-- trial:start -->
```bash
set -eu
export LATCH_SOURCE="$PWD"
pnpm install --frozen-lockfile --store-dir "$LATCH_SOURCE/.pnpm-store"
pnpm build
node dist/cli.js --version
```

## 一个完整的最小任务

继续在同一个 shell 中运行。这个演示显式授权在新建的临时目录写入 `hello.txt`、验证结果，并在内容检查通过后归档该演示 task；这不是对业务任务自动批准或自动归档的授权。

```bash
export LATCH_DEMO_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/latch-demo.XXXXXX")"
mkdir "$LATCH_DEMO_ROOT/project" "$LATCH_DEMO_ROOT/responses"
cd "$LATCH_DEMO_ROOT/project"
git init -q
cat > check.cjs <<'JS'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
assert.equal(readFileSync('hello.txt', 'utf8'), 'Hello Latch\n')
JS
latch() { node "$LATCH_SOURCE/dist/cli.js" "$@"; }
latch init --json > "$LATCH_DEMO_ROOT/responses/init.json"

cat > "$LATCH_DEMO_ROOT/plan.json" <<'JSON'
{
  "goal": "创建内容为 Hello Latch 的 hello.txt",
  "workspace_scope": { "paths": ["hello.txt"] },
  "scope": ["仅修改 hello.txt"],
  "acceptance": ["hello.txt 的完整内容为 Hello Latch 加一个换行"],
  "approach": ["写入文件并校验完整内容"],
  "verification_plan": [{
    "name": "hello-content",
    "kind": "gate",
    "command": ["node", "check.cjs"]
  }]
}
JSON

latch checkpoint "最小试用" --profile light \
  --plan-file "$LATCH_DEMO_ROOT/plan.json" \
  --authorize-request "执行此演示，创建并验证 hello.txt" \
  --json --brief > "$LATCH_DEMO_ROOT/responses/current.json"

# 始终从上一条成功响应取 task ID 和 revision，不猜编号。
read_state() {
  LATCH_DEMO_TASK=$(node -p "require(process.env.LATCH_DEMO_ROOT + '/responses/current.json').task_id")
  LATCH_DEMO_REV=$(node -p "require(process.env.LATCH_DEMO_ROOT + '/responses/current.json').revision")
}
read_state
printf 'Hello Latch\n' > hello.txt
latch verify-all "$LATCH_DEMO_TASK" --expect-revision "$LATCH_DEMO_REV" \
  --json --brief > "$LATCH_DEMO_ROOT/responses/current.json"
read_state
latch submit "$LATCH_DEMO_TASK" --expect-revision "$LATCH_DEMO_REV" \
  --changes "已创建 hello.txt，完整内容校验通过" \
  --knowledge-impact-none "临时演示没有项目知识文档变更" \
  --json --brief > "$LATCH_DEMO_ROOT/responses/current.json"
read_state
latch context "$LATCH_DEMO_TASK" --json --review > "$LATCH_DEMO_ROOT/responses/review.json"
cat hello.txt
node check.cjs

# 本演示已明确授权：内容校验通过后，归档无未验证项的演示 task。
latch done "$LATCH_DEMO_TASK" --expect-revision "$LATCH_DEMO_REV" \
  --json --brief > "$LATCH_DEMO_ROOT/responses/done.json"
latch list --json --brief > "$LATCH_DEMO_ROOT/responses/list.json"
printf '演示和响应保存在：%s\n' "$LATCH_DEMO_ROOT"
```
<!-- trial:end -->

预期：输出 `Hello Latch`，`done.json` 记录归档结果，`list.json` 不再列出演示 task。响应文件放在示例项目之外，避免把命令输出误算作项目改动。任何一步失败都应停止，保留响应并按[反馈模板](docs/FEEDBACK.md)脱敏反馈；不要改 revision 或跳过 gate 重试。

## 与 Agent 一起使用

首次可明确要求 Agent：「读取本源码目录的 `skills/latch/SKILL.md`，仅在新建的临时 Git 项目试用 Latch；将 Skill 中本仓 runner 替换为该源码目录下 `dist/cli.js` 的绝对路径，不安装全局命令或 Skill 链接。」上面的 shell 示例用于核验 CLI，不代表已验证自然语言 Agent 在每次恢复时都能正确执行规则。

有多个独立验收面或需要方案确认时使用 Standard task，展示方案后等待明确批准。普通 Light task 只能用于范围固定、低风险且无未决问题的任务。真实任务在 `submit` 后停在 review，由使用者确认是否完成；有未验证项时需要逐项记录解决、明确接受风险或有责任人的后续安排。

## 当前边界与反馈

当前 CLI 版本为 `0.6.1`，JSON envelope 为 schema 3；新 task 使用 schema 5，minimum writer 为 `0.5.0`。schema 2–4 只读，不迁移；Record 使用独立 schema 1。

验收描述是否与交付一致、closeout 结论是否受到证据支持，仍需 Agent 和使用者判断。已有规则修正不等于机器能判断任意自然语言结论。workspace proof 的未知问题不应直接解释为误拦。

[早期版本说明与已知限制](docs/EARLY_RELEASE.md) · [反馈模板](docs/FEEDBACK.md) · [MIT License](LICENSE)

## 开发检查

完整维护仓库运行 `pnpm check` 和 `git diff --check`；隔离试用检查入口为 `node scripts/verify-early-trial.mjs`。精简源码快照仅提供 `pnpm build`、`pnpm typecheck` 和 CLI，未附带维护仓库的测试与内部历史文档；上述维护检查入口不属于精简快照。

## 致谢

- [linux.do](https://linux.do) — 中文技术交流社区。本次早期试用面向该社区收集安装、流程和恢复反馈。
