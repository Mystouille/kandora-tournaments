import { isGameEnabled } from "~/game/feature-gate";
import { getGameServerHttpUrl } from "~/services/gameServer.server";
import { signGameToken } from "~/utils/jwt.server";
import { requireGameApiAccess } from "~/utils/gameAuth.server";

function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

async function forwardToGameServer(init?: RequestInit): Promise<Response> {
  const gameServerUrl = getGameServerHttpUrl();
  if (!gameServerUrl) {
    return errorResponse("game_server_not_configured", 503);
  }

  try {
    const upstream = await fetch(`${gameServerUrl}/rooms`, init);
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    console.error("Failed to reach game server rooms endpoint:", error);
    return errorResponse("game_server_unreachable", 502);
  }
}

export async function loader({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (!isGameEnabled()) {
    return errorResponse("game_disabled", 404);
  }
  const access = await requireGameApiAccess(request);
  if (!access.authorized) {
    return access.response;
  }
  return forwardToGameServer({
    method: "GET",
    headers: { accept: "application/json" },
  });
}

export async function action({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (!isGameEnabled()) {
    return errorResponse("game_disabled", 404);
  }
  if (request.method !== "POST") {
    return errorResponse("method_not_allowed", 405);
  }

  const access = await requireGameApiAccess(request);
  if (!access.authorized) {
    return access.response;
  }

  const token = await signGameToken(access.user.sub);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse("invalid_body", 400);
  }

  return forwardToGameServer({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, token }),
  });
}
