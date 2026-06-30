import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import type { ViteDevServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Boot the tournament/league agent (connectors, workers, Discord bot) once the
// dev server starts listening. In production this is triggered from
// entry.server.tsx instead.
function serverStartup() {
  return {
    name: "server-startup",
    configureServer(server: ViteDevServer) {
      server.httpServer?.once("listening", () => {
        server.ssrLoadModule("/app/services/serverInit.server").then((mod) => {
          mod
            .initLeagueAgent()
            .catch((err: unknown) =>
              console.error("Failed to initialize server agents:", err)
            );
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths(), serverStartup()],
  ssr: {
    // Bundle antd (and its styling deps) into the server build so SSR works.
    noExternal: [
      /antd/,
      /@ant-design/,
      /@rc-component/,
      /@emotion/,
      /stylis/,
      /csstype/,
    ],
    // Keep native / Node-only packages out of the SSR bundle.
    external: [
      "mongoose",
      "mongodb",
      "dotenv",
      "node-cron",
      "protobufjs",
      "ws",
      "discord.js",
      "@discordjs/builders",
      "@discordjs/collection",
      "@discordjs/formatters",
      "@discordjs/rest",
      "@discordjs/util",
      "@discordjs/ws",
      "zlib-sync",
      "canvas",
      "sharp",
      "busboy",
    ],
  },
  build: {
    rollupOptions: {
      external: ["zlib-sync"],
    },
  },
  optimizeDeps: {
    exclude: ["mongoose", "mongodb", "dotenv"],
  },
  test: {
    globals: true,
    include: ["app/**/*.spec.ts"],
  },
});
