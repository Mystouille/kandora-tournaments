import { isGameEnabled } from "~/game/feature-gate";
import { getTokenFromRequest } from "~/utils/jwt.server";

/**
 * GET /api/game/session
 *
 * Session bootstrap shared by players and public spectators.
 *
 * Authenticated players receive their existing JWT so the game-server can
 * verify and seat them. Anonymous spectators receive an empty token, which is
 * accepted only on the server's read-only spectator path. The returned `wsUrl`
 * points at the shared game-server; set `GAME_WS_URL` (e.g.
 * `wss://game.example.com`). When unset the client falls back to same-origin,
 * which only works if a reverse proxy forwards `/ws/game/*` to the game-server.
 *
 * 404s when `GAME_ENABLED=false`.
 */
export async function loader({ request }: { request: Request }) {
  if (!isGameEnabled()) {
    return new Response("Not Found", { status: 404 });
  }
  return Response.json({
    token: getTokenFromRequest(request) ?? "",
    wsUrl: process.env.GAME_WS_URL ?? null, // null → client uses same-origin
    wsPath: "/ws/game",
  });
}
