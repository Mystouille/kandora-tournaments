import { getAuthenticatedUser, type JwtPayload } from "./jwt.server";
import { connectToDatabase } from "./dbConnection.server";
import { UserModel } from "../core/models/shared/User";
import { LeagueModel } from "../core/models/tournament/League";
import { isDiscordGuildAdmin } from "./discord-guilds.server";
import { slugify } from "./slugify";

export interface ManageableTournamentSummary {
  id: string;
  name: string;
  slug: string;
  startTime: string;
  endTime: string;
  isDisplayed: boolean;
  isTeamMode: boolean;
  platformName: string;
}

export interface TournamentAdminAccess {
  isGlobalAdmin: boolean;
  tournaments: ManageableTournamentSummary[];
}

export interface TournamentAdminUser {
  isAdmin?: boolean | null;
  discordIdentity?: { id?: string | null } | null;
}

interface AdminLeagueRecord {
  _id: { toString(): string } | string;
  name: string;
  startTime: Date;
  endTime: Date;
  isDisplayed?: boolean;
  rulesConfig?: { isTeamMode?: boolean };
  platformConfig?: { platformName?: string };
  discordConfig?: { serverId?: string };
}

interface AuthResult {
  authorized: true;
  jwtPayload: JwtPayload;
}

interface AuthFailure {
  authorized: false;
  response: Response;
}

function summarizeLeague(
  league: AdminLeagueRecord
): ManageableTournamentSummary {
  return {
    id: league._id.toString(),
    name: league.name,
    slug: slugify(league.name),
    startTime: league.startTime.toISOString(),
    endTime: league.endTime.toISOString(),
    isDisplayed: league.isDisplayed ?? true,
    isTeamMode: league.rulesConfig?.isTeamMode ?? false,
    platformName: league.platformConfig?.platformName ?? "",
  };
}

/** Return the tournaments the current global or Discord league admin manages. */
export async function getTournamentAdminAccess(
  request: Request
): Promise<TournamentAdminAccess | null> {
  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return null;
  }

  await connectToDatabase();
  const user = await UserModel.findById(jwtPayload.sub).select(
    "isAdmin discordIdentity"
  );
  if (!user) {
    return null;
  }

  return getTournamentAdminAccessForUser(user);
}

export async function getTournamentAdminAccessForUser(
  user: TournamentAdminUser
): Promise<TournamentAdminAccess> {
  const isGlobalAdmin = Boolean(user.isAdmin);
  const discordId = user.discordIdentity?.id;
  if (!isGlobalAdmin && !discordId) {
    return { isGlobalAdmin: false, tournaments: [] };
  }

  const leagues = await LeagueModel.find({ isDisplayed: true })
    .select(
      "name startTime endTime isDisplayed rulesConfig.isTeamMode platformConfig.platformName discordConfig.serverId"
    )
    .sort({ startTime: -1 })
    .lean<AdminLeagueRecord[]>();

  if (isGlobalAdmin) {
    return {
      isGlobalAdmin: true,
      tournaments: leagues.map(summarizeLeague),
    };
  }

  const serverIds = [
    ...new Set(
      leagues
        .map((league) => league.discordConfig?.serverId)
        .filter((serverId): serverId is string => Boolean(serverId))
    ),
  ];
  const guildAccess = new Map(
    await Promise.all(
      serverIds.map(async (serverId) => {
        try {
          return [
            serverId,
            await isDiscordGuildAdmin(serverId, discordId!),
          ] as const;
        } catch {
          return [serverId, false] as const;
        }
      })
    )
  );

  return {
    isGlobalAdmin: false,
    tournaments: leagues
      .filter((league) => {
        const serverId = league.discordConfig?.serverId;
        return Boolean(serverId && guildAccess.get(serverId));
      })
      .map(summarizeLeague),
  };
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
