import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const selectors = process.argv.slice(2);

function run(entry, args) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, entry), ...args],
    {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    }
  );
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("node_modules\\vitest\\vitest.mjs", ["run", ...selectors]);
if (selectors.length === 0) {
  run("node_modules\\@playwright\\test\\cli.js", ["test"]);
}
