import { ActiveMatchResponseSchema } from "~/game/protocol/activeMatch";
import { isGameEnabled } from "~/game/feature-gate";
import { getGameServerHttpUrl } from "~/services/gameServer.server";
import { requireGameApiAccess } from "~/utils/gameAuth.server";
import { signGameToken, verifyGameToken } from "~/utils/jwt.server";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

async function forwardActiveMatch(token: string): Promise<Response> {
  const gameServerUrl = getGameServerHttpUrl();
  if (!gameServerUrl) {
    return json({ error: "game_server_not_configured" }, 503);
  }
  let response: Response;
  try {
    response = await fetch(`${gameServerUrl}/active-match`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch (error) {
    console.error("Failed to reach game server active-match endpoint:", error);
    return json({ error: "game_server_unreachable" }, 502);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    console.error("Game server active-match response was not JSON:", error);
    return json({ error: "invalid_upstream_response" }, 502);
  }
  if (!response.ok) {
    return json(body, response.status);
  }
  const parsed = ActiveMatchResponseSchema.safeParse(body);
  if (!parsed.success) {
    console.error(
      "Game server active-match response failed validation:",
      parsed.error
    );
    return json({ error: "invalid_upstream_response" }, 502);
  }
  return json(parsed.data);
}

export async function loader({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (!isGameEnabled()) {
    return json({ error: "game_disabled" }, 404);
  }
  const access = await requireGameApiAccess(request);
  if (!access.authorized) {
    return access.response;
  }
  return forwardActiveMatch(await signGameToken(access.user.sub));
}

export async function action({
  request,
}: {
  request: Request;
}): Promise<Response> {
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
  if (typeof token !== "string" || (await verifyGameToken(token)) === null) {
    return json({ error: "invalid_or_expired_token" }, 401);
  }
  return forwardActiveMatch(token);
}
