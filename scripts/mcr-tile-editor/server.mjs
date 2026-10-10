import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MCR_TILE_ATLAS_CONFIG,
  MCR_TILE_ATLAS_CONFIG_PATH,
  MCR_TILE_ATLAS_OUTPUT_ROOT,
  bakeMcrTileAtlases,
  describeMcrTileSheets,
  normalizeMcrTileAtlasConfig,
  readMcrTileAtlasConfig,
  renderMcrTileSheet,
  writeMcrTileAtlasConfig,
} from "../generate-mcr-tile-atlases.mjs";

const editorRoot = path.dirname(fileURLToPath(import.meta.url));
const STATIC_FILES = new Map([
  ["/", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", contentType: "text/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", contentType: "text/css; charset=utf-8" }],
]);

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'",
  "x-content-type-options": "nosniff",
};

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function requestJson(request) {
  if (!(request.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new TypeError("Expected an application/json request");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) {
      throw new RangeError("Request body exceeds 128 KiB");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function statusForError(error) {
  return error instanceof SyntaxError ||
    error instanceof TypeError ||
    error instanceof RangeError
    ? 400
    : 500;
}

export function createMcrTileEditorServer({
  configPath = MCR_TILE_ATLAS_CONFIG_PATH,
  outputRoot = MCR_TILE_ATLAS_OUTPUT_ROOT,
} = {}) {
  let bakeQueue = Promise.resolve();
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/api/state") {
        jsonResponse(response, 200, {
          config: await readMcrTileAtlasConfig(configPath),
          defaults: DEFAULT_MCR_TILE_ATLAS_CONFIG,
          sheets: await describeMcrTileSheets(),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/preview") {
        const body = await requestJson(request);
        const config = normalizeMcrTileAtlasConfig(body.config);
        const rendered = await renderMcrTileSheet(body.sheetId, config);
        response.writeHead(200, {
          ...SECURITY_HEADERS,
          "content-type": "image/png",
          "content-length": rendered.buffer.length,
          "x-atlas-width": rendered.width,
          "x-atlas-height": rendered.height,
        });
        response.end(rendered.buffer);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/bake") {
        const body = await requestJson(request);
        const config = normalizeMcrTileAtlasConfig(body.config);
        const bake = bakeQueue.then(async () => {
          const outputs = await bakeMcrTileAtlases(config, outputRoot);
          await writeMcrTileAtlasConfig(config, configPath);
          return outputs;
        });
        bakeQueue = bake.catch(() => undefined);
        const outputs = await bake;
        jsonResponse(response, 200, {
          config,
          outputs: outputs.map(({ id, output, width, height }) => ({
            id,
            output,
            width,
            height,
          })),
        });
        return;
      }

      const staticFile = STATIC_FILES.get(url.pathname);
      if (request.method === "GET" && staticFile !== undefined) {
        const content = await fs.readFile(
          path.join(editorRoot, staticFile.file)
        );
        response.writeHead(200, {
          ...SECURITY_HEADERS,
          "content-type": staticFile.contentType,
          "content-length": content.length,
        });
        response.end(content);
        return;
      }

      jsonResponse(response, 404, { error: "not_found" });
    } catch (error) {
      const status = statusForError(error);
      if (status === 500) {
        console.error("[mcr-tile-editor] request failed", error);
      }
      jsonResponse(response, status, {
        error: error instanceof Error ? error.message : "Unknown editor error",
      });
    }
  });
}

function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

const invokedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const host = "127.0.0.1";
  const portText = argumentValue("port") ?? "4174";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`Invalid editor port: ${portText}`);
  }
  const server = createMcrTileEditorServer();
  server.listen(port, host, () => {
    console.log(`MCR tile atlas editor: http://${host}:${port}`);
  });
}
