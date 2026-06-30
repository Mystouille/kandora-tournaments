import { clearAuthCookie } from "../../../utils/jwt.server";
import { trackEvent } from "../../../services/telemetry.server";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  trackEvent({
    type: "auth",
    path: "/api/auth/logout",
    method: "POST",
    statusCode: 200,
    meta: { event: "logout" },
  });

  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearAuthCookie(),
    },
  });
}
