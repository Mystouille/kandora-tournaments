import { isGameEnabled } from "~/game/feature-gate";

/**
 * GET /api/game/session
 *
 * Public, tokenless spectator session for the live game viewer.
 *
 * Tournament spectating is anonymous and read-only, so we return an EMPTY
 * token: the shared game-server accepts spectators without auth (players still
 * authenticate — see the game-server connection handler). The returned `wsUrl`
 * points at the shared game-server; set `GAME_WS_URL` (e.g.
 * `wss://game.example.com`). When unset the client falls back to same-origin,
 * which only works if a reverse proxy forwards `/ws/game/*` to the game-server.
 *
 * 404s when `GAME_ENABLED=false`.
 */
export async function loader() {
  if (!isGameEnabled()) {
    return new Response("Not Found", { status: 404 });
  }
  return Response.json({
    token: "",
    wsUrl: process.env.GAME_WS_URL ?? null, // null → client uses same-origin
    wsPath: "/ws/game",
  });
}
