import { spawnSync } from "node:child_process";
import { join } from "node:path";

const cli = join(process.cwd(), "dist/cli.js");
const repoRoot = process.cwd();

function clearActorEnv(env) {
  for (const key of Object.keys(env)) {
    if (
      key === "LATCH_ACTOR" ||
      key === "CODEX_THREAD_ID" ||
      key.startsWith("CLAUDE_CODE_") ||
      key.startsWith("OPENCODE_")
    )
      delete env[key];
  }
}

export function run(cwd, args, options = {}) {
  const env = {
    ...process.env,
    PWD: cwd,
  };
  if (options.cleanActorEnv) clearActorEnv(env);
  Object.assign(env, options.env ?? {});
  if (options.actor !== undefined) env.LATCH_ACTOR = options.actor;
  else if (!options.cleanActorEnv) env.LATCH_ACTOR = "default";

  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
}

export { cli, repoRoot };
