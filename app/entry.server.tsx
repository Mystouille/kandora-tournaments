import { PassThrough, Transform } from "node:stream";

import type { AppLoadContext, EntryContext } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import { createCache, extractStyle, StyleProvider } from "@ant-design/cssinjs";

import { initLeagueAgent } from "./services/serverInit.server";

// In production, boot server agents (connectors, workers, Discord bot) as soon
// as this module loads. In dev the Vite `server-startup` plugin handles it.
if (process.env.NODE_ENV === "production") {
  initLeagueAgent().catch((err) =>
    console.error("Failed to initialize server agents:", err)
  );
}

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode
        ? "onAllReady"
        : "onShellReady";

    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000
    );

    // Create a fresh antd style cache per request for SSR extraction.
    const cache = createCache();

    const { pipe, abort } = renderToPipeableStream(
      <StyleProvider cache={cache}>
        <ServerRouter context={routerContext} url={request.url} />
      </StyleProvider>,
      {
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });

          // Extract antd styles collected during SSR and inject before </head>.
          const antdStyles = extractStyle(cache);
          let headInjected = false;
          const styleInjector = new Transform({
            transform(chunk, encoding, callback) {
              if (!headInjected) {
                const html = chunk.toString();
                const idx = html.indexOf("</head>");
                if (idx !== -1) {
                  headInjected = true;
                  callback(
                    null,
                    html.slice(0, idx) + antdStyles + html.slice(idx)
                  );
                  return;
                }
              }
              callback(null, chunk);
            },
          });

          responseHeaders.set("Content-Type", "text/html");

          pipe(body);
          const stream = createReadableStreamFromReadable(
            body.pipe(styleInjector)
          );

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );
  });
}
