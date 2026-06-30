import { discordOAuthConfig } from "config";
import { AuthService } from "../../../utils/auth.server";
import {
  signToken,
  createAuthCookie,
  getAuthenticatedUser,
} from "../../../utils/jwt.server";
import { getGuildMember } from "../../../utils/discord-guilds.server";
import { getMainServer } from "../../../config/servers";

/**
 * Parse a specific cookie value from a Cookie header string.
 */
function getCookieValue(cookieHeader: string, name: string): string | null {
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.split("=")[1] : null;
}

/**
 * Server-side loader: handles the entire Discord OAuth code exchange.
 * Discord redirects here with ?code=xxx&state=yyy.
 * The loader exchanges the code, sets the auth cookie, and redirects to home.
 */
export async function loader({ request }: { request: Request }) {
  const oauth = discordOAuthConfig();
  if (!oauth) {
    return { error: "Discord login is not configured on this server" };
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // If Discord returned an error, show it on the client
  if (errorParam) {
    return { error: `Discord authentication error: ${errorParam}` };
  }

  if (!code || !state) {
    return { error: "Missing authorization code or state parameter" };
  }

  // Verify state from cookie
  const cookieHeader = request.headers.get("Cookie") || "";
  const storedState = getCookieValue(cookieHeader, "discord_oauth_state");
  if (!storedState || storedState !== state) {
    return { error: "Invalid state parameter. Please try logging in again." };
  }

  // Build the redirect URI from the original request origin.
  // Behind a reverse proxy, request.url has the internal origin, so we
  // reconstruct the public origin from forwarded headers.
  const forwardedProto = request.headers.get("X-Forwarded-Proto");
  const forwardedHost =
    request.headers.get("X-Forwarded-Host") || request.headers.get("Host");
  let origin: string;
  if (forwardedProto && forwardedHost) {
    origin = `${forwardedProto}://${forwardedHost}`;
  } else {
    origin = new URL(request.url).origin;
  }
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const redirectUri = origin + basePath + "/auth/discord/callback";

  // Exchange code for access token
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauth.DISCORD_CLIENT_ID,
      client_secret: oauth.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const errorData = await tokenResponse.text();
    console.error("Discord token exchange failed:", errorData);
    return { error: "Failed to exchange authorization code with Discord" };
  }

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;

  // Get user information from Discord
  const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userResponse.ok) {
    return { error: "Failed to retrieve user information from Discord" };
  }

  const userInfo = await userResponse.json();

  const avatarUrl = userInfo.avatar
    ? `https://cdn.discordapp.com/avatars/${userInfo.id}/${userInfo.avatar}.png?size=64`
    : undefined;

  // ── Link-mode: user is already logged in and wants to link Discord ──
  const isLinkMode =
    getCookieValue(cookieHeader, "discord_link_mode") === "true";
  if (isLinkMode) {
    const jwtPayload = await getAuthenticatedUser(request);
    const clearLinkCookie =
      "discord_link_mode=; Path=/; Max-Age=0; SameSite=Lax";
    const clearStateCookie =
      "discord_oauth_state=; Path=/; Max-Age=0; SameSite=Lax";
    const clearReturnToCookie =
      "discord_return_to=; Path=/; Max-Age=0; SameSite=Lax";

    if (!jwtPayload) {
      const headers = new Headers();
      headers.append("Set-Cookie", clearLinkCookie);
      headers.append("Set-Cookie", clearStateCookie);
      headers.append("Set-Cookie", clearReturnToCookie);
      headers.set(
        "Location",
        "/account?discord_link=error&discord_link_error=" +
          encodeURIComponent("You must be logged in to link a Discord account.")
      );
      return new Response(null, { status: 302, headers });
    }

    const linkResult = await AuthService.linkDiscordToUser(jwtPayload.sub, {
      id: userInfo.id,
      username: userInfo.username,
      displayName: userInfo.global_name ?? userInfo.username,
      avatarUrl,
    });

    const headers = new Headers();
    headers.append("Set-Cookie", clearLinkCookie);
    headers.append("Set-Cookie", clearStateCookie);
    headers.append("Set-Cookie", clearReturnToCookie);

    if (!linkResult.success) {
      headers.set(
        "Location",
        "/account?discord_link=error&discord_link_error=" +
          encodeURIComponent(
            linkResult.error || "Failed to link Discord account."
          )
      );
      return new Response(null, { status: 302, headers });
    }

    // Re-issue JWT with updated avatar
    const newJwt = await signToken({
      sub: jwtPayload.sub,
      username: jwtPayload.username,
      loginMethod: jwtPayload.loginMethod,
      avatarUrl: avatarUrl ?? jwtPayload.avatarUrl,
    });
    headers.append("Set-Cookie", createAuthCookie(newJwt));

    const params = new URLSearchParams({ discord_link: "success" });
    if (linkResult.merged) {
      params.set("merged", "true");
    }
    headers.set("Location", `/account?${params.toString()}`);
    return new Response(null, { status: 302, headers });
  }

  // ── Normal login/register flow ──

  // Check admin role on the main server (best-effort).
  const mainServer = getMainServer();
  let isAdmin = false;
  let isEditor = false;
  try {
    const mainMember = await getGuildMember(mainServer.id, userInfo.id);
    if (mainMember && mainServer.adminRoleId) {
      isAdmin = mainMember.roles?.includes(mainServer.adminRoleId) ?? false;
    }
    if (mainMember && mainServer.editorRoleId) {
      isEditor = mainMember.roles?.includes(mainServer.editorRoleId) ?? false;
    }
  } catch (err) {
    console.error("Failed to check Discord guild membership:", err);
  }

  // Find or create user in database
  const dbResult = await AuthService.findOrCreateDiscordUser({
    id: userInfo.id,
    username: userInfo.username,
    displayName: userInfo.global_name ?? userInfo.username,
    avatarUrl,
    isAdmin,
    isEditor,
  });

  if (!dbResult.success || !dbResult.user) {
    return { error: dbResult.error || "Failed to create user account" };
  }

  // Sign JWT
  const jwt = await signToken({
    sub: dbResult.user._id?.toString() || userInfo.id,
    username: dbResult.user.name,
    loginMethod: "discord",
    avatarUrl,
  });

  // Clear the OAuth state cookie and set the auth cookie, then redirect
  const clearStateCookie =
    "discord_oauth_state=; Path=/; Max-Age=0; SameSite=Lax";
  const clearReturnToCookie =
    "discord_return_to=; Path=/; Max-Age=0; SameSite=Lax";
  const headers = new Headers();
  headers.append("Set-Cookie", createAuthCookie(jwt));
  headers.append("Set-Cookie", clearStateCookie);
  headers.append("Set-Cookie", clearReturnToCookie);

  // Redirect new users to account setup; otherwise back to the page they were on
  const returnToCookie = getCookieValue(cookieHeader, "discord_return_to");
  let returnTo = returnToCookie ? decodeURIComponent(returnToCookie) : "/";
  // Strip the basename prefix if present, since React Router automatically prepends it
  if (basePath && returnTo.startsWith(basePath)) {
    returnTo = returnTo.slice(basePath.length) || "/";
  }
  // Note: React Router automatically prepends the basename to redirect Location headers
  const redirectTo = dbResult.isNewUser ? "/account?setup=true" : returnTo;
  const resultParams = new URLSearchParams();
  resultParams.set("username", userInfo.username);
  if (dbResult.isNewUser) {
    resultParams.set("newUser", "true");
  }

  const finalUrl =
    redirectTo +
    (redirectTo.includes("?") ? "&" : "?") +
    `discord_auth=success&${resultParams.toString()}`;

  headers.set("Location", finalUrl);
  return new Response(null, { status: 302, headers });
}
