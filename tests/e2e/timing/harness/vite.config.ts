import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { createAuthorityClock } from "../../../../app/game/server/src/timing/authorityClock";
import { clockSampleForProbe } from "../../../../app/game/server/src/transport/clockSync";
import { installGameGateway } from "./gameGateway";

const root = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(root, "..", "..", "..", "..");

export default defineConfig({
  root,
  resolve: { alias: { "~": resolve(repositoryRoot, "app") } },
  server: {
    host: "127.0.0.1",
    port: 5198,
    strictPort: true,
    fs: { allow: [repositoryRoot] },
  },
  plugins: [
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
