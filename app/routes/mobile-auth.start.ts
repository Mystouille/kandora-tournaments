import { randomBytes } from "node:crypto";
import { discordOAuthConfig } from "config";
import { isMobileAuthChallenge } from "~/services/mobileAuthCode.server";

function publicOrigin(request: Request): string {
  const forwardedProto = request.headers.get("X-Forwarded-Proto");
  const forwardedHost =
    request.headers.get("X-Forwarded-Host") || request.headers.get("Host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

function oauthCookie(name: string, value: string): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
  ];
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export async function loader({ request }: { request: Request }): Promise<Response> {
  const oauth = discordOAuthConfig();
  if (!oauth) {
    return Response.json(
      { error: "discord_login_not_configured" },
      { status: 503 }
    );
  }
  const challenge = new URL(request.url).searchParams.get("challenge");
  if (!isMobileAuthChallenge(challenge)) {
    return Response.json(
      { error: "invalid_mobile_auth_challenge" },
      { status: 400 }
    );
  }

  const state = randomBytes(24).toString("base64url");
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const redirectUri = `${publicOrigin(request)}${basePath}/auth/discord/callback`;
  const authUrl = new URL("https://discord.com/api/oauth2/authorize");
  authUrl.search = new URLSearchParams({
    client_id: oauth.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  }).toString();

  const headers = new Headers({ Location: authUrl.toString() });
  headers.append("Set-Cookie", oauthCookie("discord_oauth_state", state));
  headers.append(
    "Set-Cookie",
    oauthCookie(
      "discord_return_to",
      encodeURIComponent("/mobile-auth/complete")
    )
  );
  headers.append(
    "Set-Cookie",
    oauthCookie("mobile_auth_challenge", challenge)
  );
  return new Response(null, { status: 302, headers });
}