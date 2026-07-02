import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "./helpers.mjs";

test("start allows multiple open tasks and keeps current task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  assert.equal(run(cwd, ["init"]).status, 0);
  assert.equal(run(cwd, ["start", "First task"]).status, 0);
  assert.equal(run(cwd, ["start", "Second task"]).status, 0);

  const tasks = readdirSync(join(cwd, ".latch", "tasks"));
  assert.equal(tasks.length, 2);
  const state = JSON.parse(readFileSync(join(cwd, ".latch", "state.json"), "utf8"));
  assert.equal(state.current_task_id, tasks[0]);
  assert.equal(state.actors.default.current_task_id, tasks[0]);

  const list = run(cwd, ["list"]);
  assert.match(list.stdout, new RegExp(`\\* active\\ttriage\\tdefault\\t${tasks[0]}`));
  assert.match(list.stdout, new RegExp(`  active\\ttriage\\tdefault\\t${tasks[1]}`));
});

test("use switches current task and resume reads it", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "First task"]);
  run(cwd, ["start", "Second task"]);
  const secondId = readdirSync(join(cwd, ".latch", "tasks"))[1];
  assert.equal(run(cwd, ["use", secondId]).status, 0);

  const state = JSON.parse(readFileSync(join(cwd, ".latch", "state.json"), "utf8"));
  assert.equal(state.current_task_id, secondId);
  assert.equal(state.actors.default.current_task_id, secondId);
  const resume = run(cwd, ["resume"]);
  assert.match(resume.stdout, /Task: Second task/);
  assert.match(resume.stdout, /Owner: default/);
});

test("task option targets non-current task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "First task"]);
  run(cwd, ["start", "Second task"]);
  const [firstId, secondId] = readdirSync(join(cwd, ".latch", "tasks"));
  assert.equal(run(cwd, ["save", "--task", secondId, "--goal", "G", "--next", "N"]).status, 0);
  assert.equal(run(cwd, ["next", "--task", secondId]).status, 0);

  const first = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", firstId, "task.json"), "utf8"));
  const second = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", secondId, "task.json"), "utf8"));
  assert.equal(first.stage, "triage");
  assert.equal(second.stage, "plan");
});

test("different actors keep separate current tasks", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  assert.equal(run(cwd, ["start", "Actor A task"], { actor: "agent-a" }).status, 0);
  assert.equal(run(cwd, ["start", "Actor B task"], { actor: "agent-b" }).status, 0);

  const tasks = readdirSync(join(cwd, ".latch", "tasks"));
  assert.equal(tasks.length, 2);
  const state = JSON.parse(readFileSync(join(cwd, ".latch", "state.json"), "utf8"));
  assert.equal(state.actors["agent-a"].current_task_id, tasks[0]);
  assert.equal(state.actors["agent-b"].current_task_id, tasks[1]);

  const resumeA = run(cwd, ["resume"], { actor: "agent-a" });
  const resumeB = run(cwd, ["resume"], { actor: "agent-b" });
  assert.match(resumeA.stdout, /Task: Actor A task/);
  assert.match(resumeA.stdout, /Owner: agent-a/);
  assert.match(resumeB.stdout, /Task: Actor B task/);
  assert.match(resumeB.stdout, /Owner: agent-b/);
});

test("checkpoint creates a new task for a new actor instead of appending to another actor current task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["checkpoint", "First actor task", "--goal", "G1"], { actor: "agent-a" });
  const result = run(cwd, ["checkpoint", "Second actor task", "--goal", "G2"], {
    actor: "agent-b",
  });
  assert.equal(result.status, 0);

  const tasks = readdirSync(join(cwd, ".latch", "tasks"));
  assert.equal(tasks.length, 2);
  const taskA = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", tasks[0], "task.json"), "utf8"));
  const taskB = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", tasks[1], "task.json"), "utf8"));
  assert.equal(taskA.owner, "agent-a");
  assert.equal(taskA.goal, "G1");
  assert.equal(taskB.owner, "agent-b");
  assert.equal(taskB.goal, "G2");
});

test("write commands reject another actor's task without force", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Owned task"], { actor: "agent-a" });
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];

  const save = run(cwd, ["save", "--task", taskId, "--goal", "steal"], { actor: "agent-b" });
  assert.notEqual(save.status, 0);
  assert.match(save.stderr, /owned by agent-a/);

  const use = run(cwd, ["use", taskId], { actor: "agent-b" });
  assert.notEqual(use.status, 0);
  assert.match(use.stderr, /owned by agent-a/);
});

test("force can transfer task ownership to another actor", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Owned task"], { actor: "agent-a" });
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];

  const use = run(cwd, ["use", taskId, "--force"], { actor: "agent-b" });
  assert.equal(use.status, 0);
  const state = JSON.parse(readFileSync(join(cwd, ".latch", "state.json"), "utf8"));
  assert.equal(state.actors["agent-b"].current_task_id, taskId);

  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.owner, "agent-b");
});
