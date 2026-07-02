import { spawnSync } from "node:child_process";
import { join } from "node:path";

const cli = join(process.cwd(), "dist/cli.js");
const repoRoot = process.cwd();

export function run(cwd, args, options = {}) {
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

export { cli, repoRoot };
