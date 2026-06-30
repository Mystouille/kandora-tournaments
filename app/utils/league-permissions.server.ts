import { getAuthenticatedUser, type JwtPayload } from "./jwt.server";
import { connectToDatabase } from "./dbConnection.server";
import { UserModel } from "../db/User";
import { LeagueModel } from "../db/League";
import { isDiscordGuildAdmin } from "./discord-guilds.server";

interface AuthResult {
  authorized: true;
  jwtPayload: JwtPayload;
}

interface AuthFailure {
  authorized: false;
  response: Response;
}

/**
 * Check if the authenticated user can administer a specific league.
 *
 * A user is authorized if:
 * 1. They are a global admin (user.isAdmin), OR
 * 2. They logged in via Discord AND are an ADMINISTRATOR of the Discord
 *    server linked to this league (league.discordConfig.serverId).
 *
 * Returns `{ authorized: true, jwtPayload }` on success, or
 * `{ authorized: false, response }` with a 401/403 Response on failure.
 */
export async function requireLeagueAdmin(
  request: Request,
  leagueId: string
): Promise<AuthResult | AuthFailure> {
  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return {
      authorized: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  await connectToDatabase();
  const user = await UserModel.findById(jwtPayload.sub).select(
    "isAdmin discordIdentity"
  );

  if (!user) {
    return {
      authorized: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // Global admins can always edit
  if (user.isAdmin) {
    return { authorized: true, jwtPayload };
  }

  // Check Discord server admin status
  const discordId = user.discordIdentity?.id;
  if (!discordId) {
    return {
      authorized: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const league = await LeagueModel.findById(leagueId)
    .select("discordConfig")
    .lean();
  const serverId = league?.discordConfig?.serverId;
  if (!serverId) {
    return {
      authorized: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const isGuildAdmin = await isDiscordGuildAdmin(serverId, discordId);
  if (isGuildAdmin) {
    return { authorized: true, jwtPayload };
  }

  return {
    authorized: false,
    response: Response.json({ error: "Forbidden" }, { status: 403 }),
  };
}

/**
 * Same check but for route loaders — throws a redirect instead of
 * returning a Response.
 */
export async function requireLeagueAdminOrRedirect(
  request: Request,
  leagueId: string
): Promise<void> {
  const { redirect } = await import("react-router");
  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    throw redirect("/");
  }

  await connectToDatabase();
  const user = await UserModel.findById(jwtPayload.sub).select(
    "isAdmin discordIdentity"
  );

  if (!user) {
    throw redirect("/");
  }

  if (user.isAdmin) {
    return;
  }

  const discordId = user.discordIdentity?.id;
  if (discordId) {
    const league = await LeagueModel.findById(leagueId)
      .select("discordConfig")
      .lean();
    const serverId = league?.discordConfig?.serverId;
    if (serverId) {
      const isGuildAdmin = await isDiscordGuildAdmin(serverId, discordId);
      if (isGuildAdmin) {
        return;
      }
    }
  }

  throw redirect("/");
}
