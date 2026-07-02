import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "./helpers.mjs";

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
