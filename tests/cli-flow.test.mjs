import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "./helpers.mjs";

test("task advances only after required fields and verification", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  assert.equal(run(cwd, ["init"]).status, 0);
  assert.equal(run(cwd, ["start", "Auth expiry"]).status, 0);
  assert.notEqual(run(cwd, ["next"]).status, 0);

  assert.equal(run(cwd, ["save", "--goal", "Redirect expired sessions", "--next", "Write plan"]).status, 0);
  assert.equal(run(cwd, ["next"]).status, 0);
  assert.equal(run(cwd, ["next"]).status, 0);
  assert.equal(run(cwd, ["next"]).status, 0);
  assert.notEqual(run(cwd, ["next"]).status, 0);

  assert.equal(run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]).status, 0);
  assert.equal(run(cwd, ["next"]).status, 0);
  assert.equal(
    run(cwd, ["save", "--knowledge", "skip", "--knowledge-reason", "一次性修复，无需沉淀"]).status,
    0,
  );
  assert.notEqual(run(cwd, ["next"]).status, 0);
  assert.equal(run(cwd, ["done"]).status, 0);

  const state = JSON.parse(readFileSync(join(cwd, ".latch/state.json"), "utf8"));
  assert.deepEqual(state, {});
});

test("next --to finish skips dev/check when fields are filled", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Doc tweak"]);
  // 字段填齐即可从 triage 跳级 finish，跳过 plan/dev/check，不需要 verify
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  const result = run(cwd, ["next", "--to", "finish"]);
  assert.equal(result.status, 0);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.stage, "finish");
  assert.equal(task.latest_verify, undefined);
});

test("done accepts documentation task that jumped to finish without verify", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Doc only"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, ["next", "--to", "finish", "--reason", "纯文档任务，无 verify 意义"]);
  run(cwd, [
    "finish",
    "--changes",
    "只改文档",
    "--verified",
    "无，纯文档跳级",
    "--unverified",
    "未运行测试",
    "--followup",
    "等用户确认后 done",
  ]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.latest_verify, undefined);

  const result = run(cwd, ["done"]);
  assert.equal(result.status, 0);

  const state = JSON.parse(readFileSync(join(cwd, ".latch/state.json"), "utf8"));
  assert.deepEqual(state, {});
});

test("done rejects jumped finish task when latest verify failed", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Doc with failed verify"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(1)"]);
  run(cwd, ["next", "--to", "finish", "--reason", "纯文档任务，无 verify 意义"]);
  run(cwd, [
    "finish",
    "--changes",
    "只改文档",
    "--verified",
    "无",
    "--unverified",
    "verify 失败",
    "--followup",
    "等用户确认后 done",
  ]);

  const result = run(cwd, ["done"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Gate verification must pass/);
});

test("next --to finish rejected when required fields missing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Doc tweak"]);
  // 缺 scope/acceptance，跳级门禁不通过
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  const result = run(cwd, ["next", "--to", "finish"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing scope/);
  assert.match(result.stderr, /missing acceptance/);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.stage, "triage");
});

test("next --to finish from dev rejected to keep verify gate", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Code task"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, ["next"]); // triage -> plan
  run(cwd, ["next"]); // plan -> dev
  // dev 不能跳级 finish，要走 check 让 verify 把关
  const result = run(cwd, ["next", "--to", "finish"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /transition dev -> finish is not allowed/);
});

test("next from check explains missing verify", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Check gate"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, ["next"]); // triage -> plan
  run(cwd, ["next"]); // plan -> dev
  run(cwd, ["next"]); // dev -> check
  const result = run(cwd, ["next"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing gate verify/);
});

test("next --to rejects unknown stage", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  assert.equal(run(cwd, ["init"]).status, 0);
  assert.equal(run(cwd, ["start", "Unknown stage task"]).status, 0);
  assert.notEqual(run(cwd, ["next", "--to", "garbage"]).status, 0);
});

test("verify records failure and exits non-zero", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  assert.equal(run(cwd, ["init"]).status, 0);
  assert.equal(run(cwd, ["start", "Failing verify"]).status, 0);
  // 验证命令以非零退出，verify 必须记录 fail 并以同样非零码退出
  const result = run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(1)"]);
  assert.notEqual(result.status, 0);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.latest_verify.status, "fail");
  assert.equal(task.latest_verify.exit_code, 1);
  assert.equal(task.latest_gate_verify.status, "fail");
  assert.equal(task.latest_gate_verify.kind, "gate");
});

test("diagnostic verify failure does not overwrite passing gate verify", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Scoped pass full fail"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  assert.equal(run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]).status, 0);
  assert.notEqual(run(cwd, ["verify", "--diagnostic", "--", process.execPath, "-e", "process.exit(1)"]).status, 0);

  const result = run(cwd, [
    "finish",
    "--changes",
    "scoped 通过后记录全量既有失败",
    "--verified",
    "gate verify passed",
    "--unverified",
    "diagnostic verify failed",
    "--followup",
    "等用户确认后 done",
  ]);
  assert.equal(result.status, 0);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.stage, "finish");
  assert.equal(task.latest_verify.status, "fail");
  assert.equal(task.latest_verify.kind, "diagnostic");
  assert.equal(task.latest_gate_verify.status, "pass");
  assert.equal(task.latest_diagnostic_verify.status, "fail");
  assert.equal(run(cwd, ["done"]).status, 0);
});

test("diagnostic verify alone does not satisfy finish gate", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Only diagnostic"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  assert.equal(run(cwd, ["verify", "--diagnostic", "--", process.execPath, "-e", "process.exit(0)"]).status, 0);

  const result = run(cwd, ["finish", "--changes", "只有诊断验证"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing gate verify/);
});

test("failing gate verify after a pass blocks finish", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Gate fail after pass"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  assert.equal(run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]).status, 0);
  assert.notEqual(run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(1)"]).status, 0);

  const result = run(cwd, ["finish", "--changes", "最新 gate 失败"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /gate verify is fail/);
});

test("verify passes through help after separator", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Verify passthrough"]);
  const result = run(cwd, ["verify", "--", process.execPath, "--help"]);
  assert.equal(result.status, 0);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.latest_verify.status, "pass");
  assert.match(task.latest_verify.command, /--help/);
});

test("verify child command sees temp cwd instead of repo root", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Verify cwd"]);
  const result = run(cwd, [
    "verify",
    "--",
    process.execPath,
    "-e",
    "if (process.cwd() !== process.env.PWD) process.exit(2)",
  ]);
  assert.equal(result.status, 0);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.latest_verify.status, "pass");
});

test("done rejected outside finish stage", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  assert.equal(run(cwd, ["init"]).status, 0);
  assert.equal(run(cwd, ["start", "Early done"]).status, 0);
  // 新任务停在 triage，没经过 finish，done 必须拒绝
  assert.notEqual(run(cwd, ["done"]).status, 0);
});

test("finish rejected outside finish stage", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Too early"]);
  const result = run(cwd, ["finish", "--changes", "还没到 finish"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Task must be in finish stage/);
});

test("finish from check still requires passing verification", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Check gate"]);
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);

  const result = run(cwd, ["finish", "--changes", "没有验证不能收尾"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot advance check -> finish: missing gate verify/);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.stage, "check");
});

test("entering grill scaffolds open-questions template", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Grill task"]);
  run(cwd, ["next", "--to", "grill"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const notes = readFileSync(join(cwd, ".latch", "tasks", taskId, "notes.md"), "utf8");
  assert.match(notes, /Scaffold: grill/);
  assert.match(notes, /仍未确认的问题：/);
});

test("entering finish scaffolds closure template", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Finish task"]);
  // 走完门禁链到 finish：triage -> plan -> dev -> check ->(verify pass)-> finish
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]);
  run(cwd, ["next"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const notes = readFileSync(join(cwd, ".latch", "tasks", taskId, "notes.md"), "utf8");
  assert.match(notes, /Scaffold: finish/);
  assert.match(notes, /知识记忆：`latch finish` 默认 skip/);
  assert.match(notes, /下次接什么：/);
  // 「没验证什么」格子必须带固定提示,逼 AI 写清未覆盖范围或显式写「无」
  assert.match(notes, /没有写「无」/);
});

test("finish writes closure and structured fields in one command", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Finish command"]);
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]);
  run(cwd, ["next"]);

  const result = run(cwd, [
    "finish",
    "--changes",
    "收口 finish 流程",
    "--verified",
    "pnpm test",
    "--unverified",
    "无",
    "--followup",
    "等用户确认后 done",
    "--artifact",
    "brief:docs/briefs/x.md",
  ]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Saved finish closure/);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.knowledge_decision, "skip");
  assert.equal(task.knowledge_reason, "默认跳过；如有可复用规则再显式生成知识卡");
  assert.equal(task.next, "等用户确认后 done");
  assert.deepEqual(task.artifacts, [{ kind: "brief", path: "docs/briefs/x.md" }]);

  const notes = readFileSync(join(cwd, ".latch", "tasks", taskId, "notes.md"), "utf8");
  assert.match(notes, /## Finish closure/);
  assert.match(notes, /改了什么：收口 finish 流程/);
  assert.match(notes, /验证了什么：pnpm test/);
  assert.match(notes, /没验证什么：无/);
  assert.match(notes, /下次接什么：等用户确认后 done/);
});

test("finish advances from verified check and records closure", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Finish from check"]);
  run(cwd, ["save", "--goal", "G", "--next", "开发前下一步"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]);

  const result = run(cwd, [
    "finish",
    "--changes",
    "直接收尾",
    "--verified",
    "node -e pass",
    "--unverified",
    "无",
    "--followup",
    "等用户确认后 done",
  ]);
  assert.equal(result.status, 0);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.stage, "finish");
  assert.equal(task.next, "等用户确认后 done");
  assert.equal(task.knowledge_decision, "skip");
  assert.equal(task.knowledge_reason, "默认跳过；如有可复用规则再显式生成知识卡");

  const events = readFileSync(join(cwd, ".latch", "tasks", taskId, "events.jsonl"), "utf8");
  assert.match(events, /"type":"stage_changed","from":"check","to":"finish"/);
  assert.match(events, /"type":"finish_saved"/);

  const notes = readFileSync(join(cwd, ".latch", "tasks", taskId, "notes.md"), "utf8");
  assert.match(notes, /改了什么：直接收尾/);
  assert.match(notes, /下次接什么：等用户确认后 done/);
});

test("finish from verified check requires closure even with structured fields", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Finish needs closure"]);
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]);

  const result = run(cwd, [
    "finish",
    "--artifact",
    "brief:docs/briefs/x.md",
    "--knowledge",
    "generate",
    "--knowledge-reason",
    "需要复用",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Finish closure is required/);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.stage, "check");
  assert.equal(task.artifacts, undefined);
  assert.equal(task.knowledge_decision, undefined);
});

test("checkpoint creates task when none active", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  // 没 current task 时 checkpoint 必须先开任务再记字段
  const result = run(cwd, ["checkpoint", "Login fix", "--goal", "G", "--next", "N"]);
  assert.equal(result.status, 0);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.goal, "G");
  assert.equal(task.next, "N");
  // checkpoint 只记账不推进阶段，新任务停在 triage
  assert.equal(task.stage, "triage");
});

test("checkpoint appends to current task without creating new one", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Existing"]);
  const firstId = readdirSync(join(cwd, ".latch", "tasks"))[0];

  // 有 current task 时 checkpoint 只追加，不该新建第二个任务
  const result = run(cwd, ["checkpoint", "--goal", "New goal", "--next", "New next"]);
  assert.equal(result.status, 0);

  const tasks = readdirSync(join(cwd, ".latch", "tasks"));
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0], firstId);

  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", firstId, "task.json"), "utf8"));
  assert.equal(task.goal, "New goal");
  assert.equal(task.next, "New next");
});

test("checkpoint with a title rejects appending to current task without --new", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Existing"]);

  const result = run(cwd, ["checkpoint", "Fresh task", "--goal", "New goal"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Use `latch checkpoint --new/);

  const tasks = readdirSync(join(cwd, ".latch", "tasks"));
  assert.equal(tasks.length, 1);

  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", tasks[0], "task.json"), "utf8"));
  assert.equal(task.title, "Existing");
  assert.equal(task.goal, undefined);
});

test("checkpoint --new creates a fresh task even when current task exists", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Existing"]);
  const firstId = readdirSync(join(cwd, ".latch", "tasks"))[0];

  const result = run(cwd, [
    "checkpoint",
    "Fresh task",
    "--new",
    "--goal",
    "New goal",
    "--next",
    "New next",
  ]);
  assert.equal(result.status, 0);

  const tasks = readdirSync(join(cwd, ".latch", "tasks")).sort();
  assert.equal(tasks.length, 2);
  const secondId = tasks.find((id) => id !== firstId);
  assert.ok(secondId);

  const first = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", firstId, "task.json"), "utf8"));
  const second = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", secondId, "task.json"), "utf8"));
  const state = JSON.parse(readFileSync(join(cwd, ".latch", "state.json"), "utf8"));

  assert.equal(first.goal, undefined);
  assert.equal(second.title, "Fresh task");
  assert.equal(second.goal, "New goal");
  assert.equal(second.next, "New next");
  assert.equal(state.current_task_id, secondId);
  assert.equal(state.actors.default.current_task_id, secondId);
});

test("checkpoint title parsing skips values of unknown flags", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  const result = run(cwd, ["checkpoint", "--reason", "ignored", "Fresh task", "--goal", "New goal"]);
  assert.equal(result.status, 0);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.title, "Fresh task");
  assert.equal(task.goal, "New goal");
});

test("checkpoint can update an explicit task with --task without requiring --new", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Existing"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];

  const result = run(cwd, ["checkpoint", "--task", taskId, "--goal", "New goal"]);
  assert.equal(result.status, 0);

  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.goal, "New goal");
});

test("abandon archives current task and preserves failed verification", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Give up task"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(1)"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const result = run(cwd, ["abandon", "--reason", "方向错了"]);
  assert.equal(result.status, 0);

  const state = JSON.parse(readFileSync(join(cwd, ".latch", "state.json"), "utf8"));
  assert.deepEqual(state, {});
  assert.equal(readdirSync(join(cwd, ".latch", "tasks")).length, 0);

  const month = new Date().toISOString().slice(0, 7);
  const archivedDir = join(cwd, ".latch", "archive", month, taskId);
  const task = JSON.parse(readFileSync(join(archivedDir, "task.json"), "utf8"));
  assert.equal(task.status, "abandoned");
  assert.equal(task.stage, "abandoned");
  assert.equal(task.latest_verify.status, "fail");

  const events = readFileSync(join(archivedDir, "events.jsonl"), "utf8");
  assert.match(events, /"type":"abandoned"/);
  assert.match(events, /方向错了/);
  const notes = readFileSync(join(archivedDir, "notes.md"), "utf8");
  assert.match(notes, /Abandoned/);
  assert.match(notes, /方向错了/);

  assert.equal(run(cwd, ["log", "清掉后可记录"]).status, 0);
  assert.equal(run(cwd, ["start", "New task"]).status, 0);
});

test("abandon non-current task keeps current task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "First task"]);
  run(cwd, ["start", "Second task"]);
  const [firstId, secondId] = readdirSync(join(cwd, ".latch", "tasks"));
  assert.equal(run(cwd, ["abandon", "--task", secondId]).status, 0);

  const state = JSON.parse(readFileSync(join(cwd, ".latch", "state.json"), "utf8"));
  assert.equal(state.current_task_id, firstId);
  assert.deepEqual(readdirSync(join(cwd, ".latch", "tasks")), [firstId]);
});

test("abandon works for blocked task without reason", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Blocked task"]);
  assert.equal(run(cwd, ["next", "--to", "blocked"]).status, 0);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const result = run(cwd, ["abandon"]);
  assert.equal(result.status, 0);

  const month = new Date().toISOString().slice(0, 7);
  const archivedDir = join(cwd, ".latch", "archive", month, taskId);
  const task = JSON.parse(readFileSync(join(archivedDir, "task.json"), "utf8"));
  assert.equal(task.status, "abandoned");
  assert.equal(task.stage, "abandoned");

  const events = readFileSync(join(archivedDir, "events.jsonl"), "utf8");
  assert.match(events, /"type":"abandoned"/);
  const notes = readFileSync(join(archivedDir, "notes.md"), "utf8");
  assert.doesNotMatch(notes, /Abandoned/);
});

test("abandon rejected with no current task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  const result = run(cwd, ["abandon"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No current task/);
});
