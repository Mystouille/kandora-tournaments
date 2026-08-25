import { consumeMobileAuthCode } from "~/services/mobileAuthCode.server";
import {
  GAME_JWT_EXPIRATION_SECONDS,
  signGameToken,
} from "~/utils/jwt.server";

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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const code = form.get("code");
  const verifier = form.get("verifier");
  if (typeof code !== "string" || typeof verifier !== "string") {
    return json({ error: "invalid_body" }, 400);
  }

  let redeemed;
  try {
    redeemed = await consumeMobileAuthCode(code, verifier);
  } catch (error) {
    console.error("Failed to exchange mobile authentication code:", error);
    return json({ error: "temporarily_unavailable" }, 503);
  }
  if (redeemed === null) {
    return json({ error: "invalid_or_expired_code" }, 401);
  }

  const token = await signGameToken(redeemed.userId);
  return json({
    token,
    username: redeemed.username,
    expiresAt: Date.now() + GAME_JWT_EXPIRATION_SECONDS * 1000,
  });
}