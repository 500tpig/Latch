import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

const cli = join(process.cwd(), "dist/cli.js");
const repoRoot = process.cwd();

function run(cwd, args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.env ?? {}),
      PWD: cwd,
      LATCH_ACTOR: options.actor ?? "default",
    },
  });
}

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

// 护栏:只防止 SCENARIOS 误删 Latch 自身反馈场景,不验证规则是否被遵守
test("scenarios doc keeps latch self-feedback section", () => {
  const content = readFileSync(join(repoRoot, "docs/SCENARIOS.md"), "utf8");
  assert.match(content, /## \d+\. Latch 自身反馈/);
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
  assert.match(result.stderr, /missing latest verify/);
});

test("knowledge generate --draft writes task card before finish", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Knowledge draft"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  const result = run(cwd, [
    "knowledge",
    "generate",
    "--draft",
    "--module",
    "cli,knowledge",
    "--keyword",
    "resume,notes",
    "--path",
    "src/cli.ts",
    "--symbol",
    "currentTask",
    "--line",
    "95",
  ]);
  assert.equal(result.status, 0);

  const files = readdirSync(join(cwd, ".latch", "knowledge", "tasks"));
  assert.equal(files.length, 1);
  const content = readFileSync(join(cwd, ".latch", "knowledge", "tasks", files[0]), "utf8");
  assert.match(content, /draft: true/);
  assert.match(content, /modules: \["cli", "knowledge"\]/);
  assert.match(content, /source_task:/);
  assert.match(content, /currentTask/);
});

test("knowledge recall follows path then keyword then module", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Recall task"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, [
    "knowledge",
    "generate",
    "--draft",
    "--module",
    "router",
    "--keyword",
    "resume",
    "--path",
    "src/cli.ts",
    "--symbol",
    "currentTask",
  ]);
  run(cwd, ["knowledge", "refresh-modules"]);

  const byPath = run(cwd, ["knowledge", "recall", "--file", "src/cli.ts"]);
  assert.match(byPath.stdout, /\tpath\t/);

  const byKeyword = run(cwd, ["knowledge", "recall", "--keyword", "resume"]);
  assert.match(byKeyword.stdout, /\tkeyword\t/);

  const byModule = run(cwd, ["knowledge", "recall", "--module", "router"]);
  assert.match(byModule.stdout, /module\trouter\t/);
});

test("knowledge recall no longer accepts positional task id", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Recall task"]);
  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];

  const result = run(cwd, ["knowledge", "recall", taskId]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No knowledge match\./);
});

test("knowledge verify marks missing citation as unverified", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Verify knowledge"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, [
    "knowledge",
    "generate",
    "--draft",
    "--module",
    "router",
    "--keyword",
    "missing",
    "--path",
    "src/cli.ts",
    "--symbol",
    "DefinitelyMissingSymbol",
  ]);
  const result = run(cwd, ["knowledge", "verify", "--all"]);
  assert.equal(result.status, 0);

  const files = readdirSync(join(cwd, ".latch", "knowledge", "tasks"));
  const content = readFileSync(join(cwd, ".latch", "knowledge", "tasks", files[0]), "utf8");
  assert.match(content, /unverified/);
});

test("knowledge verify does not require rg in PATH", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src", "cli.ts"), "export const currentTask = true;\n");

  run(cwd, ["init"]);
  run(cwd, ["start", "Verify knowledge without rg"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, [
    "knowledge",
    "generate",
    "--draft",
    "--module",
    "router",
    "--keyword",
    "current",
    "--path",
    "src/cli.ts",
    "--symbol",
    "currentTask",
  ]);
  const result = run(cwd, ["knowledge", "verify", "--all"], { env: { PATH: "" } });
  assert.equal(result.status, 0);

  const files = readdirSync(join(cwd, ".latch", "knowledge", "tasks"));
  const content = readFileSync(join(cwd, ".latch", "knowledge", "tasks", files[0]), "utf8");
  assert.doesNotMatch(content, /unverified/);
});

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
  assert.equal(data.progress.can_advance, true);
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
});

test("done rejected outside finish stage", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  assert.equal(run(cwd, ["init"]).status, 0);
  assert.equal(run(cwd, ["start", "Early done"]).status, 0);
  // 新任务停在 triage，没经过 finish，done 必须拒绝
  assert.notEqual(run(cwd, ["done"]).status, 0);
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
  assert.match(notes, /知识记忆：用 `latch save --knowledge generate\|skip --knowledge-reason "\.\.\."` 记录/);
  assert.match(notes, /下次接什么：/);
  // 「没验证什么」格子必须带固定提示,逼 AI 写清未覆盖范围或显式写「无」
  assert.match(notes, /没有写「无」/);
});

test("done rejected when finish closure lacks knowledge decision", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Need decision"]);
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]);
  run(cwd, ["next"]);

  const result = run(cwd, ["done"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Knowledge decision is required/);
});

test("done rejected when knowledge decision is generate but card is missing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Need card"]);
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]);
  run(cwd, ["next"]);
  run(cwd, ["save", "--knowledge", "generate", "--knowledge-reason", "有复用价值"]);

  const result = run(cwd, ["done"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Run `latch knowledge generate` first/);
});

test("done passes after explicit skip knowledge decision", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Skip knowledge"]);
  run(cwd, ["save", "--goal", "G", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]);
  run(cwd, ["next"]);
  run(cwd, ["save", "--knowledge", "skip", "--knowledge-reason", "一次性任务"]);

  assert.equal(run(cwd, ["done"]).status, 0);
});

test("save rejects skip knowledge decision without reason", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Missing reason"]);
  const result = run(cwd, ["save", "--knowledge", "skip"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires `--knowledge-reason`/);
});

test("knowledge generate persists structured decision on task", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Knowledge state"]);
  run(cwd, ["save", "--goal", "G", "--scope", "S", "--acceptance", "A", "--next", "N"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["next"]);
  run(cwd, ["verify", "--", process.execPath, "-e", "process.exit(0)"]);
  run(cwd, ["next"]);
  const result = run(cwd, ["knowledge", "generate", "--module", "cli", "--keyword", "state"]);
  assert.equal(result.status, 0);

  const taskId = readdirSync(join(cwd, ".latch", "tasks"))[0];
  const task = JSON.parse(readFileSync(join(cwd, ".latch", "tasks", taskId, "task.json"), "utf8"));
  assert.equal(task.knowledge_decision, "generate");
  assert.equal(task.knowledge_reason, "生成知识卡");
  assert.equal(typeof task.knowledge_card_path, "string");
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

test("log writes entry with files split by comma", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  const result = run(cwd, ["log", "限制弹窗条件", "--files", "a.vue,b.vue"]);
  assert.equal(result.status, 0);

  const log = readFileSync(join(cwd, ".latch", "log.jsonl"), "utf8").trim();
  const entry = JSON.parse(log);
  assert.equal(entry.summary, "限制弹窗条件");
  assert.deepEqual(entry.files, ["a.vue", "b.vue"]);
  assert.equal(typeof entry.timestamp, "string");
  assert.match(entry.timestamp, /Z$/);
});

test("log accepts files before summary", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  const result = run(cwd, ["log", "--files", "a.vue,b.vue", "限制弹窗条件"]);
  assert.equal(result.status, 0);

  const log = readFileSync(join(cwd, ".latch", "log.jsonl"), "utf8").trim();
  const entry = JSON.parse(log);
  assert.equal(entry.summary, "限制弹窗条件");
  assert.deepEqual(entry.files, ["a.vue", "b.vue"]);
});

test("log without files writes empty array", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  const result = run(cwd, ["log", "小修一笔"]);
  assert.equal(result.status, 0);

  const log = readFileSync(join(cwd, ".latch", "log.jsonl"), "utf8").trim();
  const entry = JSON.parse(log);
  assert.equal(entry.summary, "小修一笔");
  assert.deepEqual(entry.files, []);
});

test("log requires summary", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  // summary 必填,缺了必须非零退出
  const result = run(cwd, ["log"]);
  assert.notEqual(result.status, 0);
});

test("log can record a small task while open tasks exist", () => {
  const cwd = mkdtempSync(join(tmpdir(), "latch-"));

  run(cwd, ["init"]);
  run(cwd, ["start", "Active task"]);
  const result = run(cwd, ["log", "小修一笔", "--files", "a.ts"]);
  assert.equal(result.status, 0);
  const log = readFileSync(join(cwd, ".latch", "log.jsonl"), "utf8").trim();
  const entry = JSON.parse(log);
  assert.equal(entry.summary, "小修一笔");
  assert.deepEqual(entry.files, ["a.ts"]);
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
});
