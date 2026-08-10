/**
 * Tournaments-hosted game-server entrypoint.
 *
 * The server logic lives in the shared submodule (`app/game/server/`). The
 * host injects its PortalAdapter here, then loads the server. The dynamic
 * import guarantees `setAdapter` runs before the server module evaluates.
 */
import "dotenv/config";
import { setAdapter } from "~/game/portal-adapter";
import { portalAdapter } from "~/services/gamePortalAdapter.server";

setAdapter(portalAdapter);
await import("~/game/server/src/index");
