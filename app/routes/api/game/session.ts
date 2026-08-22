import { isGameEnabled } from "~/game/feature-gate";
import { getTokenFromRequest } from "~/utils/jwt.server";
import { getAuthenticatedUser } from "~/utils/jwt.server";

/**
 * GET /api/game/session
 *
 * Session bootstrap shared by authenticated players and spectators.
 *
 * Callers receive their existing JWT so the game-server can verify their
 * identity for seating or viewer presence. The returned `wsUrl` points at the
 * shared game-server; set `GAME_WS_URL` (e.g.
 * `wss://game.example.com`). When unset the client falls back to same-origin,
 * which only works if a reverse proxy forwards `/ws/game/*` to the game-server.
 *
 * 404s when `GAME_ENABLED=false`.
 */
export async function loader({ request }: { request: Request }) {
  if (!isGameEnabled()) {
    return new Response("Not Found", { status: 404 });
  }
  const user = await getAuthenticatedUser(request);
  const token = getTokenFromRequest(request);
  if (!user || !token) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return Response.json({
    token,
    wsUrl: process.env.GAME_WS_URL ?? null, // null → client uses same-origin
    wsPath: "/ws/game",
  });
}
