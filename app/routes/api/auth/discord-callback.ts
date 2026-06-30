import { discordOAuthConfig, coreConfig } from "config";
import { AuthService } from "../../../utils/auth.server";
import { signToken, createAuthCookie } from "../../../utils/jwt.server";
import { getGuildMember } from "../../../utils/discord-guilds.server";
import { getMainServer } from "../../../config/servers";

// Prevent GET requests - this endpoint only accepts POST
export async function loader() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const oauth = discordOAuthConfig();
  if (!oauth) {
    return Response.json(
      { error: "Discord login is not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { code, state, redirectUri } = body;

    if (!code || !state) {
      return Response.json(
        { error: "Missing code or state parameter" },
        { status: 400 }
      );
    }

    // Exchange code for access token using Discord OAuth
    // Use the redirect URI from the client to ensure it matches what Discord used
    const effectiveRedirectUri =
      redirectUri || coreConfig.APP_BASE_URL + oauth.DISCORD_REDIRECT_URI;

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: oauth.DISCORD_CLIENT_ID,
        client_secret: oauth.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: effectiveRedirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("Discord token exchange failed:", errorData);
      console.error("Redirect URI used:", effectiveRedirectUri);
      return Response.json(
        { error: "Failed to exchange authorization code with Discord" },
        { status: 500 }
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Get user information from Discord
    const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userResponse.ok) {
      console.error("Failed to fetch Discord user info");
      return Response.json(
        { error: "Failed to retrieve user information" },
        { status: 500 }
      );
    }

    const userInfo = await userResponse.json();

    // Build Discord avatar URL
    const avatarUrl = userInfo.avatar
      ? `https://cdn.discordapp.com/avatars/${userInfo.id}/${userInfo.avatar}.png?size=64`
      : undefined;

    // Check admin role on the main server
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

    // Find or create user in our database
    const dbResult = await AuthService.findOrCreateDiscordUser({
      id: userInfo.id,
      username: userInfo.username,
      displayName: userInfo.global_name ?? userInfo.username,
      avatarUrl,
      isAdmin,
      isEditor,
    });

    if (!dbResult.success || !dbResult.user) {
      return Response.json(
        { error: dbResult.error || "Failed to create user account" },
        { status: 500 }
      );
    }

    // Sign a JWT for the authenticated user
    const jwt = await signToken({
      sub: dbResult.user._id?.toString() || userInfo.id,
      username: dbResult.user.name,
      loginMethod: "discord",
      avatarUrl,
    });

    // Return user info (JWT is set as httpOnly cookie)
    return new Response(
      JSON.stringify({
        success: true,
        isNewUser: dbResult.isNewUser || false,
        user: {
          id: userInfo.id,
          username: userInfo.username,
          discriminator: userInfo.discriminator,
          avatar: userInfo.avatar,
        },
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": createAuthCookie(jwt),
        },
      }
    );
  } catch (error) {
    console.error("Discord OAuth callback error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
