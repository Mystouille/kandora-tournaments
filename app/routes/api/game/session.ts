import { isGameEnabled } from "~/game/feature-gate";
import { signGameToken, verifyGameToken } from "~/utils/jwt.server";
import { requireGameApiAccess } from "~/utils/gameAuth.server";

const MOBILE_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

function sessionBody(token: string) {
  return {
    token,
    wsUrl: process.env.GAME_WS_URL?.trim() || null,
    wsPath: "/ws/game",
  };
}

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
  const access = await requireGameApiAccess(request);
  if (!access.authorized) {
    return access.response;
  }
  const token = await signGameToken(access.user.sub);
  return Response.json(sessionBody(token));
}

export async function action({ request }: { request: Request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: MOBILE_CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: MOBILE_CORS_HEADERS }
    );
  }
  if (!isGameEnabled()) {
    return Response.json(
      { error: "game_disabled" },
      { status: 404, headers: MOBILE_CORS_HEADERS }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "invalid_body" },
      { status: 400, headers: MOBILE_CORS_HEADERS }
    );
  }
  const token = form.get("token");
  if (typeof token !== "string" || (await verifyGameToken(token)) === null) {
    return Response.json(
      { error: "invalid_or_expired_token" },
      { status: 401, headers: MOBILE_CORS_HEADERS }
    );
  }
  return Response.json(sessionBody(token), { headers: MOBILE_CORS_HEADERS });
}
