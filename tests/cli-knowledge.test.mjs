import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "./helpers.mjs";

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
  // 知识卡路径改由 artifacts 数组里 kind="knowledge_card" 的一项表达
  assert.ok(Array.isArray(task.artifacts), "artifacts should be an array");
  const kc = task.artifacts.find((a) => a.kind === "knowledge_card");
  assert.ok(kc, "artifacts should contain a knowledge_card entry");
  assert.equal(typeof kc.path, "string");
  assert.ok(!("knowledge_card_path" in task), "legacy knowledge_card_path field must be gone");
});
