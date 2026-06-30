const { spawn } = require("child_process");
const path = require("path");

const binPath = path.resolve(
  __dirname,
  "../node_modules/@react-router/serve/bin.js"
);
const args = process.argv.slice(2);

const child = spawn(process.execPath, [binPath, ...args], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" },
});

process.on("SIGTERM", () => {
  console.log("[start] Received SIGTERM, shutting down gracefully");
  child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 5000);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
