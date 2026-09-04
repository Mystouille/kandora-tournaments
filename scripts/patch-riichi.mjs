import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const yakuPath = resolve(root, "node_modules/riichi/yaku.js");
const marker = "// kandora: compare Iipeikou sequences without exceptions";
const assertImport = "const assert = require('assert')\n";
const original = `                    try {
                        assert.deepStrictEqual(v, o.currentPattern[i])
                        return true
                    } catch(e) {}`;
const previousReplacement = `                    ${marker}
                    const candidate = o.currentPattern[i]
                    if (candidate instanceof Array && candidate.length === v.length && v.every((tile, index) => tile === candidate[index]))
                        return true`;
const replacement = `                    ${marker}
                    const candidate = o.currentPattern[i]
                    if (
                        candidate instanceof Array &&
                        candidate.length === 3 &&
                        candidate[0] === v[0] &&
                        candidate[1] === v[1] &&
                        candidate[2] === v[2]
                    ) {
                        return true
                    }`;

let source = await readFile(yakuPath, "utf8");
if (source.includes(replacement) && !source.includes(assertImport)) {
  process.exit(0);
}
if (source.includes(previousReplacement) && !source.includes(assertImport)) {
  source = source.replace(previousReplacement, replacement);
  await writeFile(yakuPath, source, "utf8");
  process.exit(0);
}
if (!source.includes(assertImport) || !source.includes(original)) {
  throw new Error(
    "riichi@1.2.0 source changed; review scripts/patch-riichi.mjs before continuing"
  );
}

source = source.replace(assertImport, "").replace(original, replacement);
await writeFile(yakuPath, source, "utf8");
