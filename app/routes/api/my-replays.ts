import { getMyReplaysApiResponse } from "~/services/myReplaysApi.server";
import {
  getAuthenticatedPrincipal,
  type AuthenticatedPrincipal,
} from "~/utils/requestAuth.server";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

async function replayResponse(
  principal: AuthenticatedPrincipal | null
): Promise<Response> {
  if (principal === null) {
    return json({ error: "authentication_required" }, 401);
  }
  try {
    const response = await getMyReplaysApiResponse(principal.userId);
    return response === null
      ? json({ error: "invalid_or_expired_session" }, 401)
      : json(response);
  } catch (error) {
    console.error("Failed to load My Replays:", error);
    return json({ error: "replays_unavailable" }, 500);
  }
}

export async function loader({
  request,
}: {
  request: Request;
}): Promise<Response> {
  return replayResponse(
    await getAuthenticatedPrincipal(request, { transport: "web-cookie" })
  );
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  return replayResponse(
    await getAuthenticatedPrincipal(request, {
      transport: "game-token",
      token: form.get("token"),
    })
  );
}
