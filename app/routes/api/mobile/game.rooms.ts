import { isGameEnabled } from "~/game/feature-gate";
import { listPresetIds } from "~/game/rules/presets";
import { getGameServerHttpUrl } from "~/services/gameServer.server";
import { verifyGameToken } from "~/utils/jwt.server";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

export async function action({ request }: { request: Request }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!isGameEnabled()) {
    return json({ error: "game_disabled" }, 404);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const token = form.get("token");
  const preset = form.get("preset");
  if (
    typeof token !== "string" ||
    typeof preset !== "string" ||
    !listPresetIds().includes(preset)
  ) {
    return json({ error: "invalid_body" }, 400);
  }
  if ((await verifyGameToken(token)) === null) {
    return json({ error: "invalid_or_expired_token" }, 401);
  }

  const gameServerUrl = getGameServerHttpUrl();
  if (!gameServerUrl) {
    return json({ error: "game_server_not_configured" }, 503);
  }
  try {
    const response = await fetch(`${gameServerUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preset, token }),
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        ...CORS_HEADERS,
        "content-type":
          response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    console.error("Failed to create mobile game room:", error);
    return json({ error: "game_server_unreachable" }, 502);
  }
}