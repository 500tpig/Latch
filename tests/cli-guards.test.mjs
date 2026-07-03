import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run, repoRoot } from "./helpers.mjs";

test("public docs do not contain local user paths", () => {
  const files = [
    "README.md",
    "AGENTS.md",
    "docs/DESIGN.md",
    "docs/HANDBOOK.md",
    "docs/AI_INSTALL.md",
    "docs/templates/PROJECT_AGENTS.md",
    ".agents/skills/latch/SKILL.md",
    ".opencode/skills/latch/SKILL.md",
  ];

  for (const file of files) {
    const content = readFileSync(join(repoRoot, file), "utf8");
    assert.equal(content.includes("/Users/johnsmith/"), false, file);
  }
});

test("agent skill copies stay identical", () => {
  const agentsSkill = readFileSync(join(repoRoot, ".agents/skills/latch/SKILL.md"), "utf8");
  const opencodeSkill = readFileSync(join(repoRoot, ".opencode/skills/latch/SKILL.md"), "utf8");

  assert.equal(opencodeSkill, agentsSkill);
});

// 护栏:只防止 SCENARIOS 误删 Latch 流程反馈场景,不验证规则是否被遵守
test("scenarios doc keeps latch process-feedback section", () => {
  const content = readFileSync(join(repoRoot, "docs/SCENARIOS.md"), "utf8");
  assert.match(content, /## \d+\. Latch 流程反馈/);
});

test("top-level help has no side effects", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  assert.match(run(cwd, []).stdout, /Usage: latch/);
  assert.match(run(cwd, ["--help"]).stdout, /Usage: latch/);
  assert.match(run(cwd, ["-h"]).stdout, /Usage: latch/);
  assert.equal(existsSync(join(cwd, ".latch")), false);
});

test("knowledge --help has no side effects", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  const result = run(cwd, ["knowledge", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch knowledge/);
  assert.equal(existsSync(join(cwd, ".latch")), false);
});

test("done --help does not archive task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Help only"]);
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]);
  run(cwd, ["next"]);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const result = run(cwd, ["done", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch done/);
  assert.equal(existsSync(join(cwd, ".latch", "tasks", taskId, "task.json")), true);
});

test("done -h does not archive task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Short help"]);
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]);
  run(cwd, ["next"]);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const result = run(cwd, ["done", "-h"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch done/);
  assert.equal(existsSync(join(cwd, ".latch", "tasks", taskId, "task.json")), true);
});

test("abandon --help does not archive task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Help only"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];

  const result = run(cwd, ["abandon", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch abandon/);
  assert.equal(existsSync(join(cwd, ".latch", "tasks", taskId, "task.json")), true);
});

test("verify --help does not write verification", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Verify help"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];

  const result = run(cwd, ["verify", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch verify/);

  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.latest_verify, undefined);
});

test("start --help does not create task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  const result = run(cwd, ["start", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch start/);
  assert.equal(existsSync(join(cwd, ".latch")), false);
});

test("init --help does not create latch dir", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  const result = run(cwd, ["init", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch init/);
  assert.equal(existsSync(join(cwd, ".latch")), false);
});

test("list --help does not create latch dir", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  const result = run(cwd, ["list", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch list/);
  assert.equal(existsSync(join(cwd, ".latch")), false);
});

test("list --json without init is read-only", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  const result = run(cwd, ["list", "--json"]);
  assert.equal(result.status, 0);
  assert.equal(existsSync(join(cwd, ".latch")), false);

  const data = JSON.parse(result.stdout);
  assert.deepEqual(data.tasks, []);
});

test("log --help does not create latch dir", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  const result = run(cwd, ["log", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch log/);
  assert.equal(existsSync(join(cwd, ".latch")), false);
});

test("resume --help does not create latch dir", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  const result = run(cwd, ["resume", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch resume/);
  assert.equal(existsSync(join(cwd, ".latch")), false);
});

test("context --help does not create latch dir", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  const result = run(cwd, ["context", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch context/);
  assert.equal(existsSync(join(cwd, ".latch")), false);
});

test("use --help does not create latch dir", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  const result = run(cwd, ["use", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch use/);
  assert.equal(existsSync(join(cwd, ".latch")), false);
});

test("checkpoint --help does not change current task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Checkpoint help"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const notesBefore = readFileSync(join(cwd, ".latch", "tasks", taskId, "notes.md"), "utf8");
  const eventsBefore = readFileSync(join(cwd, ".latch", "tasks", taskId, "events.jsonl"), "utf8");

  const result = run(cwd, ["checkpoint", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch checkpoint/);
  assert.equal(readFileSync(join(cwd, ".latch", "tasks", taskId, "notes.md"), "utf8"), notesBefore);
  assert.equal(readFileSync(join(cwd, ".latch", "tasks", taskId, "events.jsonl"), "utf8"), eventsBefore);
});

test("save --help does not change current task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Save help"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const taskBefore = readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8");
  const notesBefore = readFileSync(join(cwd, ".latch", "tasks", taskId, "notes.md"), "utf8");
  const eventsBefore = readFileSync(join(cwd, ".latch", "tasks", taskId, "events.jsonl"), "utf8");

  const result = run(cwd, ["save", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch save/);
  assert.equal(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"), taskBefore);
  assert.equal(readFileSync(join(cwd, ".latch", "tasks", taskId, "notes.md"), "utf8"), notesBefore);
  assert.equal(readFileSync(join(cwd, ".latch", "tasks", taskId, "events.jsonl"), "utf8"), eventsBefore);
});

test("finish --help does not change current task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Finish help"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const taskBefore = readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8");
  const notesBefore = readFileSync(join(cwd, ".latch", "tasks", taskId, "notes.md"), "utf8");
  const eventsBefore = readFileSync(join(cwd, ".latch", "tasks", taskId, "events.jsonl"), "utf8");

  const result = run(cwd, ["finish", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch finish/);
  assert.equal(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"), taskBefore);
  assert.equal(readFileSync(join(cwd, ".latch", "tasks", taskId, "notes.md"), "utf8"), notesBefore);
  assert.equal(readFileSync(join(cwd, ".latch", "tasks", taskId, "events.jsonl"), "utf8"), eventsBefore);
});

test("next --help does not advance task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Next help"]);
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const taskBefore = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  const eventsBefore = readFileSync(join(cwd, ".latch", "tasks", taskId, "events.jsonl"), "utf8");

  const result = run(cwd, ["next", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: latch next/);
  const taskAfter = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(taskAfter.stage, taskBefore.stage);
  assert.equal(readFileSync(join(cwd, ".latch", "tasks", taskId, "events.jsonl"), "utf8"), eventsBefore);
});

test("checkpoint fails while latch lock is held", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Locked"]);
  run(cwd, ["save", "--goal", "Original goal"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const taskPath = join(cwd, ".latch", "tasks", taskId, "task.json");
  const lockPath = join(cwd, ".latch", ".lock");
  mkdirSync(lockPath);

  const result = run(cwd, ["checkpoint", "--goal", "Overwritten"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Latch is busy/);

  const task = JSON.parse(readFileSync(taskPath, "utf8"));
  assert.equal(task.goal, "Original goal");
});

test("save fails while latch lock is held", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Locked"]);
  run(cwd, ["save", "--goal", "Original goal"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const taskPath = join(cwd, ".latch", "tasks", taskId, "task.json");
  const lockPath = join(cwd, ".latch", ".lock");
  mkdirSync(lockPath, { recursive: true });

  const result = run(cwd, ["save", "--goal", "Overwritten"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Latch is busy/);

  const task = JSON.parse(readFileSync(taskPath, "utf8"));
  assert.equal(task.goal, "Original goal");
});

test("done with missing task clears lock before exiting", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);

  const result = run(cwd, ["done", "--task", "missing-task"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Task not found/);
  assert.equal(existsSync(join(cwd, ".latch", ".lock")), false);

  const followUp = run(cwd, ["start", "After missing done"]);
  assert.equal(followUp.status, 0);
});
