import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "./helpers.mjs";

test("context emits task summary and json", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["checkpoint", "Context task", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];

  const text = run(cwd, ["context"]);
  assert.match(text.stdout, /Task: Context task/);
  assert.match(text.stdout, /Owner: default/);
  assert.match(text.stdout, /Goal: G/);
  assert.match(text.stdout, /Notes:/);

  const json = run(cwd, ["context", taskId, "--json"]);
  assert.equal(json.status, 0);
  const data = JSON.parse(json.stdout);
  assert.equal(data.task_id, taskId);
  assert.equal(data.owner, "default");
  assert.equal(data.goal, "G");
  assert.equal(data.scope, "S");
  assert.equal(data.acceptance, "A");
  assert.equal(data.next, "N");
  assert.equal(data.knowledge_decision, null);
  assert.deepEqual(data.artifacts, []);
  assert.equal(data.progress.can_advance, true);
});

test("context --json --brief emits the handoff core without full fields", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["checkpoint", "Brief context", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];

  const brief = run(cwd, ["context", taskId, "--json", "--brief"]);
  assert.equal(brief.status, 0);
  const data = JSON.parse(brief.stdout);
  assert.equal(data.task_id, taskId);
  assert.equal(data.title, "Brief context");
  assert.equal(data.status, "active");
  assert.equal(data.stage, "triage");
  assert.equal(data.owner, "default");
  assert.equal(data.current, true);
  assert.equal(data.next, "N");
  assert.equal(data.latest_verify, null);
  assert.equal(data.progress.can_advance, true);
  assert.ok(Array.isArray(data.recent_events));
  assert.equal("goal" in data, false);
  assert.equal("scope" in data, false);
  assert.equal("acceptance" in data, false);
  assert.equal("knowledge_decision" in data, false);
  assert.equal("artifacts" in data, false);

  const full = JSON.parse(run(cwd, ["context", taskId, "--json"]).stdout);
  assert.equal(full.goal, "G");
  assert.equal(full.scope, "S");
  assert.equal(full.acceptance, "A");
  assert.deepEqual(full.artifacts, []);
});

test("save --artifact appends to task.artifacts and shows in context/resume", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["checkpoint", "Artifact task", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  // --artifact 可重复传，每个值形如 "<kind>:<path>"
  run(cwd, ["save", "--artifact", "brief:docs/briefs/x.md", "--artifact", "prd:docs/prd/y.md"]);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.deepEqual(task.artifacts, [
    { kind: "brief", path: "docs/briefs/x.md" },
    { kind: "prd", path: "docs/prd/y.md" },
  ]);

  // context --json 输出整个数组
  const json = run(cwd, ["context", "--json"]);
  const data = JSON.parse(json.stdout);
  assert.deepEqual(data.artifacts, task.artifacts);

  // resume 人读输出里也有 Artifacts 行
  const text = run(cwd, ["resume", "--brief"]);
  assert.match(text.stdout, /Artifacts: brief:docs\/briefs\/x\.md  prd:docs\/prd\/y\.md/);
});

test("save --artifact rejects malformed value", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["checkpoint", "Bad artifact"]);
  const result = run(cwd, ["save", "--artifact", "no-colon-path"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be "<kind>:<path>"/);
});

test("resume with no current task exits zero", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  assert.equal(run(cwd, ["init"]).status, 0);
  const result = run(cwd, ["resume"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No current task/);
});

test("resume shows saved fields for handoff", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Handoff task"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "Continue here"]);
  run(cwd, ["next"]);
  const result = run(cwd, ["resume"]);
  // 跨会话续接靠 resume header 直接从 task.json 打四个字段，不再依赖 notes 里的 Save: 回显
  assert.match(result.stdout, /Goal: G/);
  assert.match(result.stdout, /Scope: S/);
  assert.match(result.stdout, /Acceptance: A/);
  assert.match(result.stdout, /Next: Continue here/);
  // save 不再往 notes 抄字段，Save: 段不该出现
  assert.doesNotMatch(result.stdout, /Save: triage/);
});

test("resume warns when verify passed outside finish", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Stuck task"]);
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  // 在 triage 就跑 verify(verify 命令不挡阶段),模拟工作实际做完但 stage 悬挂在中间
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]);
  const result = run(cwd, ["resume"]);
  assert.match(result.stdout, /verify passed but stage is triage/);
});

test("resume --brief lists recent events and notes path without full notes", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Brief task"]);
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  // events 此时:started, saved, stage_changed, stage_changed
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const result = run(cwd, ["resume", "--brief"]);
  // brief 不打印 notes 全文:save 写进 notes 的 "Save: triage" 不该出现
  assert.doesNotMatch(result.stdout, /Save: triage/);
  // 但要给 notes 路径,让 AI 想看细节时能自己读
  assert.match(result.stdout, new RegExp(`Notes: .*${taskId}`));
  // 列出最近 events
  assert.match(result.stdout, /Recent events:/);
  assert.match(result.stdout, /stage_changed/);
  assert.match(result.stdout, /Advance target: check/);
  assert.match(result.stdout, /Can advance: yes/);
  assert.match(result.stdout, /Next action: run `latch next`/);
});

test("resume --task can read an explicit task without current task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Explicit task"], { actor: "agent-a" });
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];

  const result = run(cwd, ["resume", "--brief", "--task", taskId], { actor: "agent-b" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Task: Explicit task/);
  assert.match(result.stdout, /Owner: agent-a/);
  assert.match(result.stdout, new RegExp(`Notes: .*${taskId}`));
  assert.match(result.stdout, /Can advance: no/);
  assert.match(result.stdout, /Blocked by: missing goal or next/);
});

test("resume --task rejects ambiguous task id prefix", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "First task"]);
  run(cwd, ["start", "Second task"]);
  const [firstId, secondId] = readdirSync(join(cwd, ".latch", "tasks")).sort();
  const prefix = firstId.slice(0, 4);

  const result = run(cwd, ["resume", "--task", prefix]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Task id is ambiguous/);
  assert.match(result.stderr, new RegExp(firstId));
  assert.match(result.stderr, new RegExp(secondId));
});

test("resume --json returns the same structured context", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["checkpoint", "Resume JSON", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  const result = run(cwd, ["resume", "--json"]);
  assert.equal(result.status, 0);

  const data = JSON.parse(result.stdout);
  assert.equal(data.title, "Resume JSON");
  assert.equal(data.goal, "G");
  assert.equal(data.progress.advance_to, "plan");
  assert.equal(data.progress.can_advance, true);
  assert.deepEqual(data.progress.blocked_reasons, []);
  assert.equal(data.progress.next_action, "run `latch next`");
});

test("list --json includes structured progress for each task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Task A"]);
  run(cwd, ["start", "Task B"]);
  const [, secondId] = readdirSync(join(cwd, ".latch", "tasks"));
  run(cwd, ["save", "--task", secondId, "--goal", "G", "--next", "N"]);
  run(cwd, ["next", "--task", secondId]);

  const result = run(cwd, ["list", "--json"]);
  assert.equal(result.status, 0);

  const data = JSON.parse(result.stdout);
  assert.equal(data.tasks.length, 2);
  assert.equal(typeof data.tasks[0].progress.next_action, "string");
  const second = data.tasks.find((task) => task.task_id === secondId);
  assert.equal(second.progress.advance_to, "dev");
  assert.equal(second.progress.can_advance, true);
  assert.equal(second.goal, "G");

  const briefResult = run(cwd, ["list", "--json", "--brief"]);
  assert.equal(briefResult.status, 0);
  const brief = JSON.parse(briefResult.stdout);
  const briefSecond = brief.tasks.find((task) => task.task_id === secondId);
  assert.equal(briefSecond.next, "N");
  assert.equal(typeof briefSecond.current, "boolean");
  assert.equal(briefSecond.progress.advance_to, "dev");
  assert.equal("goal" in briefSecond, false);
  assert.equal("scope" in briefSecond, false);
  assert.equal("acceptance" in briefSecond, false);
});

test("resume explains verify gate when check cannot advance", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Check gate"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);

  const result = run(cwd, ["resume", "--brief"]);
  assert.match(result.stdout, /Advance target: finish/);
  assert.match(result.stdout, /Can advance: no/);
  assert.match(result.stdout, /Next action: run `latch verify -- <command>`/);
  assert.match(result.stdout, /Blocked by: missing latest verify/);
});

test("resume explains finish prerequisites before user confirmation", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Finish gate"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]);
  run(cwd, ["next"]);

  const result = run(cwd, ["resume", "--brief"]);
  assert.match(result.stdout, /Advance target: done/);
  assert.match(result.stdout, /Next action: run `latch finish --changes "\.\.\." --verified "\.\.\." --unverified "\.\.\." --followup "\.\.\."`/);
  assert.match(result.stdout, /Knowledge decision is required/);
});

test("context --json includes progress summary", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "JSON context"]);
  const result = run(cwd, ["context", "--json"]);
  assert.equal(result.status, 0);

  const context = JSON.parse(result.stdout);
  assert.deepEqual(context.progress, {
    advance_to: "plan",
    can_advance: false,
    blocked_reasons: ["missing goal or next"],
    next_action: "fill the missing task fields first",
  });
  // recent_events: AI 默认入口 context --json 必须带最近动作线索
  assert.ok(Array.isArray(context.recent_events));
  assert.ok(context.recent_events.length >= 1);
});

test("recent events truncate long verify commands but keep events jsonl complete", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Long verify"]);
  const longMarker = `LONG_${"x".repeat(220)}`;
  const longScript = `process.stdout.write("${longMarker}")`;
  const verify = run(cwd, ["verify", "--", process.execPath, "-e", longScript]);
  assert.equal(verify.status, 0);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const brief = JSON.parse(run(cwd, ["context", "--json", "--brief"]).stdout);
  const verifiedEvent = brief.recent_events.find((line) => line.includes("verified"));
  assert.ok(verifiedEvent);
  assert.match(verifiedEvent, /\.\.\./);
  assert.equal(verifiedEvent.includes(longMarker), false);
  assert.equal(brief.latest_verify.command.includes(longMarker), false);

  const full = JSON.parse(run(cwd, ["context", "--json"]).stdout);
  assert.equal(full.latest_verify.command.includes(longMarker), true);
  assert.equal(full.recent_events.some((line) => line.includes(longMarker)), true);

  const events = readFileSync(join(cwd, ".latch", "tasks", taskId, "events.jsonl"), "utf8");
  assert.equal(events.includes(longMarker), true);
});
