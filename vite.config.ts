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
  resolve: {
    alias: [
      // `@ant-design/icons` v6 ships an ESM build, but under SSR Vite resolves
      // the package's `node` export condition, which points at `index.mjs`
      // (`export * from "./lib/index.js"` — CommonJS). That CJS chain gets
      // bundled into the SSR module runner and throws "exports is not defined".
      // Force the pure-ESM `es/` build instead.
      { find: /^@ant-design\/icons$/, replacement: "@ant-design/icons/es" },
      // Even the ESM icon components import their SVG data from the CommonJS
      // `@ant-design/icons-svg/lib/asn/*` path. Redirect those to the ESM `es/`
      // twins so no CommonJS module ends up in the SSR graph.
      {
        find: /^@ant-design\/icons-svg\/lib\//,
        replacement: "@ant-design/icons-svg/es/",
      },
    ],
  },
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
