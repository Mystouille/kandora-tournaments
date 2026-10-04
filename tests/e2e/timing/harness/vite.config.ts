import { defineConfig, normalizePath } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { WebSocketServer } from "ws";
import tailwindcss from "@tailwindcss/vite";
import { createAuthorityClock } from "../../../../app/game/server/src/timing/authorityClock";
import { clockSampleForProbe } from "../../../../app/game/server/src/transport/clockSync";
import { installGameGateway } from "./gameGateway";

const root = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(root, "..", "..", "..", "..");

export default defineConfig({
  root,
  cacheDir: resolve(
    repositoryRoot,
    "scriptsIgnored",
    "browser-test-vite-cache"
  ),
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "~/services/replayViewerData.server": resolve(
        repositoryRoot,
        "tests",
        "e2e",
        "game-ui",
        "serverStub.ts"
      ),
      "~/utils/jwt.server": resolve(
        repositoryRoot,
        "tests",
        "e2e",
        "game-ui",
        "serverStub.ts"
      ),
      "~": resolve(repositoryRoot, "app"),
      "../utils/league-permissions.server": resolve(
        repositoryRoot,
        "tests",
        "e2e",
        "statistics",
        "adminPermissionStub.ts"
      ),
    },
  },
  optimizeDeps: {
    entries: [
      resolve(root, "index.html"),
      resolve(
        repositoryRoot,
        "tests",
        "e2e",
        "game-ui",
        "responsiveHarness.tsx"
      ),
      resolve(
        repositoryRoot,
        "tests",
        "e2e",
        "statistics",
        "graphsHarness.tsx"
      ),
      resolve(
        repositoryRoot,
        "tests",
        "e2e",
        "statistics",
        "teamColorsHarness.tsx"
      ),
      resolve(
        repositoryRoot,
        "tests",
        "e2e",
        "statistics",
        "gameSummaryHarness.tsx"
      ),
    ].map(normalizePath),
  },
  server: {
    host: "127.0.0.1",
    port: 5198,
    strictPort: true,
    hmr: false,
    watch: {
      ignored: [/[\\/]app[\\/]game[\\/]/],
    },
    fs: { allow: [repositoryRoot] },
  },
  plugins: [
    tailwindcss(),
    {
      name: "isolated-timing-authority",
      async configureServer(server) {
        const clock = createAuthorityClock({ epoch: "browser-test-epoch" });
        await installGameGateway(server, clock);
        const sockets = new WebSocketServer({ noServer: true });
        server.httpServer?.on("upgrade", (request, socket, head) => {
          if (request.url !== "/timing/clock") {
            return;
          }
          sockets.handleUpgrade(request, socket, head, (websocket) => {
            websocket.on("message", (raw) => {
              const receivedAt = clock.now();
              const input: unknown = JSON.parse(raw.toString());
              websocket.send(
                JSON.stringify(
                  clockSampleForProbe(input, "browser-test", clock, receivedAt)
                )
              );
            });
          });
        });
        server.httpServer?.once("close", () => sockets.close());
      },
    },
  ],
});
