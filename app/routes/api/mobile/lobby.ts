import { isGameEnabled } from "~/game/feature-gate";
import { listSelectablePresets } from "~/game/rules/presets";
import { getGameServerHttpUrl } from "~/services/gameServer.server";
import { getLobbyTenhouLiveGames } from "~/services/lobbyLiveGames.server";
import { connectToDatabase } from "~/utils/dbConnection.server";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

export async function loader(): Promise<Response> {
  if (!isGameEnabled()) {
    return json({ error: "game_disabled" }, 404);
  }
  const gameServerUrl = getGameServerHttpUrl();
  if (!gameServerUrl) {
    return json({ error: "game_server_not_configured" }, 503);
  }

  let rooms: unknown[];
  try {
    const response = await fetch(`${gameServerUrl}/rooms`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return json({ error: "rooms_unavailable" }, response.status);
    }
    const body = (await response.json()) as { rooms?: unknown };
    rooms = Array.isArray(body.rooms) ? body.rooms : [];
  } catch (error) {
    console.error("Failed to load mobile lobby:", error);
    return json({ error: "game_server_unreachable" }, 502);
  }

  try {
    await connectToDatabase();
    const tenhouLiveGames = await getLobbyTenhouLiveGames();
    return json({
      presets: listSelectablePresets().map(
        ({ id, rulesFamily, displayName, description }) => ({
          id,
          rulesFamily,
          displayName,
          description,
        })
      ),
      rooms,
      tenhouLiveGames,
    });
  } catch (error) {
    console.error("Failed to load mobile lobby tournament games:", error);
    return json({ error: "tournament_games_unavailable" }, 503);
  }
}

export async function action({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return json({ error: "method_not_allowed" }, 405);
}
