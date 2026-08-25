import { isGameEnabled } from "~/game/feature-gate";
import { listPresetIds } from "~/game/rules/presets";
import { getGameServerHttpUrl } from "~/services/gameServer.server";
import { signGameToken, verifyGameToken } from "~/utils/jwt.server";
import { requireGameApiAccess } from "~/utils/gameAuth.server";

const MOBILE_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

function errorResponse(
  error: string,
  status: number,
  mobile = false
): Response {
  return Response.json(
    { error },
    { status, headers: mobile ? MOBILE_CORS_HEADERS : undefined }
  );
}

async function forwardToGameServer(
  init?: RequestInit,
  mobile = false
): Promise<Response> {
  const gameServerUrl = getGameServerHttpUrl();
  if (!gameServerUrl) {
    return errorResponse("game_server_not_configured", 503, mobile);
  }

  try {
    const upstream = await fetch(`${gameServerUrl}/rooms`, init);
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...(mobile ? MOBILE_CORS_HEADERS : {}),
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    console.error("Failed to reach game server rooms endpoint:", error);
    return errorResponse("game_server_unreachable", 502, mobile);
  }
}

export async function loader({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: MOBILE_CORS_HEADERS });
  }
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

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse("invalid_body", 400, true);
    }
    const token = form.get("token");
    const preset = form.get("preset");
    if (
      typeof token !== "string" ||
      typeof preset !== "string" ||
      !listPresetIds().includes(preset)
    ) {
      return errorResponse("invalid_body", 400, true);
    }
    if ((await verifyGameToken(token)) === null) {
      return errorResponse("invalid_or_expired_token", 401, true);
    }
    return forwardToGameServer(
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preset, token }),
      },
      true
    );
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
