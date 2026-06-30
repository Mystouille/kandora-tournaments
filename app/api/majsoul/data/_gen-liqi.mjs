// Generates app/api/majsoul/data/types/liqi.d.ts from the MahjongSoul `liqi` protobuf schema.
//
// `pbts` consumes pbjs-generated JS (not the raw JSON descriptor), so this runs the real
// pbjs -> pbts two-step. pbts emits `export namespace lq { ... }`, but the codebase imports
// `* as lq` and accesses members flat (e.g. lq.RecordNewRound); so we demote the namespace to
// a local one and re-export it via `export = lq` to expose members at the module root.
//
// protobufjs-cli is resolved from the repo root (a root devDependency), so no per-folder
// install is needed. liqi.json is fetched on first run (it is git-ignored). Run: npm run liqi:generate
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const typesDir = path.join(here, "types");
const srcJson = path.join(typesDir, "liqi.json");

const PROTO_URL =
  "https://mahjongsoul.game.yo-star.com/v0.11.48.w/res/proto/liqi.json";
if (!fs.existsSync(srcJson)) {
  console.log("fetching liqi.json ...");
  const res = await fetch(PROTO_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch liqi.json: ${res.status} ${res.statusText}`);
  }
  fs.writeFileSync(srcJson, Buffer.from(await res.arrayBuffer()));
}

// The descriptor uses `lq.`-qualified internal refs, so the package must stay intact.
const jsPath = path.join(typesDir, "_liqi.js");
const dtsPath = path.join(typesDir, "_liqi.core.d.ts");

// protobufjs-cli needs protobufjs@7 while the app uses protobufjs@8, so run it in isolation
// via npx instead of installing it into the project (avoids a peerDependency conflict).
const runCli = (tool, args) => {
  const quoted = args.map((a) => (a.startsWith("-") ? a : `"${a}"`)).join(" ");
  execSync(`npx --yes --package protobufjs-cli@1.3.3 ${tool} ${quoted}`, {
    stdio: "inherit",
  });
};

runCli("pbjs", ["-t", "static-module", "-o", jsPath, srcJson]);
runCli("pbts", ["--no-comments", "-o", dtsPath, jsPath]);
fs.rmSync(jsPath);

// pbts emits `export namespace lq { ... }`. The codebase imports `* as lq` and
// accesses members flat (lq.RecordNewRound), so demote the top-level namespace to a
// local one and re-export it via `export = lq` to expose members at module root.
let dts = fs.readFileSync(dtsPath, "utf8");
fs.rmSync(dtsPath);
dts = dts.replace(/^export namespace lq \{/m, "namespace lq {");
dts += "\nexport = lq;\n";
const outPath = path.join(typesDir, "liqi.d.ts");
fs.writeFileSync(outPath, dts);
console.log("generated liqi.d.ts:", fs.statSync(outPath).size, "bytes");
