import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));
const mobileRoot = fileURLToPath(new URL("./mobile", import.meta.url));

function browserSafeRiichi() {
  return {
    name: "browser-safe-riichi",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.replaceAll("\\", "/").endsWith("/riichi/index.js")) {
        return null;
      }
      return code
        .replace(
          "eval(this.tmpResult.oya.join('+'))",
          "this.tmpResult.oya.reduce((total, value) => total + value, 0)"
        )
        .replace(
          "eval(this.tmpResult.ko.join('+'))",
          "this.tmpResult.ko.reduce((total, value) => total + value, 0)"
        );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, "");
  const webAppBaseUrl = env.VITE_APP_BASE_URL || env.APP_BASE_URL || "";

  return {
    root: mobileRoot,
    base: "./",
    envDir: repositoryRoot,
    define: {
      "import.meta.env.VITE_APP_BASE_URL": JSON.stringify(webAppBaseUrl),
    },
    plugins: [browserSafeRiichi(), react()],
    resolve: {
      alias: [
        {
          find: /^assert$/,
          replacement: fileURLToPath(
            new URL("./mobile/src/polyfills/assert.ts", import.meta.url)
          ),
        },
        {
          find: /^~\//,
          replacement: `${fileURLToPath(new URL("./app", import.meta.url))}/`,
        },
      ],
    },
    server: {
      fs: {
        allow: [repositoryRoot],
      },
    },
    build: {
      outDir: fileURLToPath(new URL("./build/mobile", import.meta.url)),
      emptyOutDir: true,
    },
  };
});