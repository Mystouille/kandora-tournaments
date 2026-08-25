import { verifyGameToken } from "~/utils/jwt.server";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "cache-control": "no-store",
} as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function sessionBody(expiresAt: number) {
  return {
    authenticated: true as const,
    expiresAt,
    wsUrl: process.env.GAME_WS_URL?.trim() || null,
    wsPath: "/ws/game",
  };
}

export async function loader({ request }: { request: Request }): Promise<Response> {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  const token = match?.[1];
  if (token === undefined) {
    return json({ error: "authentication_required" }, 401);
  }

  const payload = await verifyGameToken(token);
  if (payload === null) {
    return json({ error: "invalid_or_expired_token" }, 401);
  }
  return json(sessionBody(payload.exp * 1000));
}

export async function action({ request }: { request: Request }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method === "POST") {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "invalid_body" }, 400);
    }
    const token = form.get("token");
    if (typeof token !== "string") {
      return json({ error: "invalid_body" }, 400);
    }
    const payload = await verifyGameToken(token);
    if (payload === null) {
      return json({ error: "invalid_or_expired_token" }, 401);
    }
    return json(sessionBody(payload.exp * 1000));
  }
  return json({ error: "method_not_allowed" }, 405);
}