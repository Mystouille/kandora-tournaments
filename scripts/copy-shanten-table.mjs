import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "app/game/rules/shanten-suit-table.bin");
const destination = resolve(
  root,
  "build/server/assets/shanten-suit-table.bin"
);

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);