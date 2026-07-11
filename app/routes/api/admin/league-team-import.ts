import mongoose from "mongoose";
import { UserModel } from "../../../db/User";
import { TeamModel } from "../../../db/Team";
import { LeagueModel, Platform, type League } from "../../../db/League";
import { createConnectorForLeague } from "../../../services/connectors/createConnectorForLeague.server";
import type {
  TeamConfig,
  PlayerConfig,
} from "../../../services/connectors/ILeagueTournamentConnector.server";
import { fetchGuildMembers } from "../../../utils/discord-guilds.server";
import { requireLeagueAdmin } from "../../../utils/league-permissions.server";

type DiscordOverrideMap = Record<
  string,
  {
    discordId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  }
>;

/**
 * Finds an existing user by their platform identity, or creates a new one
 * from the roster member's nickname. Applies a Discord override (when
 * provided) to newly created users and to existing users that have no
 * Discord identity yet. Returns the user id and whether it was created.
 */
async function findOrCreateMemberUser(
  member: { accountId: number | string; nickname: string },
  platform: Platform,
  discordOverrides?: DiscordOverrideMap
): Promise<{ userId: string; created: boolean }> {
  const platformIdStr = member.accountId.toString();

  let user;
  if (platform === Platform.MAJSOUL) {
    user = await UserModel.findOne({
      "majsoulIdentity.userId": platformIdStr,
      isDeleted: { $ne: true },
    }).exec();
  } else if (platform === Platform.RIICHICITY) {
    user = await UserModel.findOne({
      "riichiCityIdentity.id": platformIdStr,
      isDeleted: { $ne: true },
    }).exec();
  } else if (platform === Platform.TENHOU) {
    user = await UserModel.findOne({
      "tenhouIdentity.name": platformIdStr,
      isDeleted: { $ne: true },
    }).exec();
  }

  if (user) {
    // Apply Discord override if provided and user has no Discord identity yet
    const discordInfo = discordOverrides?.[platformIdStr];
    if (discordInfo && !user.get("discordIdentity.id")) {
      user.set("discordIdentity", {
        id: discordInfo.discordId,
        displayName: discordInfo.displayName,
      });
      if (discordInfo.avatarUrl) {
        user.set("avatarUrl", discordInfo.avatarUrl);
      }
      await user.save();
    }
    return { userId: user._id.toString(), created: false };
  }

  // Create a new user with the platform identity
  const newUserData: Record<string, unknown> = {
    name: member.nickname,
  };
  if (platform === Platform.MAJSOUL) {
    newUserData.majsoulIdentity = {
      userId: platformIdStr,
      friendId: platformIdStr,
      name: member.nickname,
    };
  } else if (platform === Platform.RIICHICITY) {
    newUserData.riichiCityIdentity = {
      id: platformIdStr,
      name: member.nickname,
    };
  } else if (platform === Platform.TENHOU) {
    newUserData.tenhouIdentity = {
      name: platformIdStr,
    };
  }

  // Apply Discord override if provided
  const discordInfo = discordOverrides?.[platformIdStr];
  if (discordInfo) {
    newUserData.discordIdentity = {
      id: discordInfo.discordId,
      displayName: discordInfo.displayName,
    };
    if (discordInfo.avatarUrl) {
      newUserData.avatarUrl = discordInfo.avatarUrl;
    }
  }

  const newUser = await UserModel.create(newUserData);
  return { userId: newUser._id.toString(), created: true };
}

/**
 * GET /api/admin/league-team-import?leagueId=...
 *
 * Pulls the roster from the platform and cross-references with existing
 * users in the DB. Returns the preview data for the admin to review. For
 * team-mode leagues the roster is grouped into teams; for individual
 * leagues it is a flat list of players.
 */
export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const leagueId = url.searchParams.get("leagueId");

  if (!leagueId) {
    return Response.json(
      { error: "Missing query param: leagueId" },
      { status: 400 }
    );
  }

  const auth = await requireLeagueAdmin(request, leagueId);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const league = await LeagueModel.findById(leagueId).lean<League>();
    if (!league) {
      return Response.json({ error: "League not found" }, { status: 404 });
    }

    if (!league.platformConfig.tournamentId) {
      return Response.json(
        { error: "League has no tournament ID configured" },
        { status: 400 }
      );
    }

    const isTeamMode = league.rulesConfig.isTeamMode;
    const connector = createConnectorForLeague(league);

    // Team-mode leagues import a team configuration; individual leagues
    // import a flat list of players (there are no teams to fetch).
    let teamConfigs: TeamConfig[] = [];
    let playerConfigs: PlayerConfig[] = [];
    if (isTeamMode) {
      if (!connector.getTeamsConfig) {
        return Response.json(
          { error: "Platform does not support team config" },
          { status: 400 }
        );
      }
      teamConfigs = await connector.getTeamsConfig(
        league.platformConfig.tournamentId,
        { seasonId: league.platformConfig.seasonId ?? undefined }
      );
    } else {
      if (!connector.getPlayersConfig) {
        return Response.json(
          { error: "Platform does not support importing individual players" },
          { status: 400 }
        );
      }
      playerConfigs = await connector.getPlayersConfig(
        league.platformConfig.tournamentId,
        { seasonId: league.platformConfig.seasonId ?? undefined }
      );
    }

    // Cross-reference members with existing users
    const platform = league.platformConfig.platformName;
    const allAccountIds: Array<number | string> = isTeamMode
      ? teamConfigs.flatMap((t) => t.members.map((m) => m.accountId))
      : playerConfigs.map((p) => p.accountId);

    // Look up users by platform-specific ID
    let existingUsers: Array<{
      _id: any;
      name: string;
      firstName?: string;
      lastName?: string;
      avatarUrl?: string;
      platformId: string;
      discordId?: string;
    }> = [];

    if (platform === Platform.MAJSOUL) {
      const users = await UserModel.find({
        "majsoulIdentity.userId": {
          $in: allAccountIds.map((id) => id.toString()),
        },
        isDeleted: { $ne: true },
      })
        .select(
          "_id name firstName lastName avatarUrl majsoulIdentity discordIdentity"
        )
        .lean();

      existingUsers = users.map((u: any) => ({
        _id: u._id.toString(),
        name: u.name,
        firstName: u.firstName ?? undefined,
        lastName: u.lastName ?? undefined,
        avatarUrl: u.avatarUrl ?? undefined,
        platformId: u.majsoulIdentity?.userId ?? "",
        discordId: u.discordIdentity?.id ?? undefined,
      }));
    } else if (platform === Platform.RIICHICITY) {
      const users = await UserModel.find({
        "riichiCityIdentity.id": {
          $in: allAccountIds.map((id) => id.toString()),
        },
        isDeleted: { $ne: true },
      })
        .select(
          "_id name firstName lastName avatarUrl riichiCityIdentity discordIdentity"
        )
        .lean();

      existingUsers = users.map((u: any) => ({
        _id: u._id.toString(),
        name: u.name,
        firstName: u.firstName ?? undefined,
        lastName: u.lastName ?? undefined,
        avatarUrl: u.avatarUrl ?? undefined,
        platformId: u.riichiCityIdentity?.id ?? "",
        discordId: u.discordIdentity?.id ?? undefined,
      }));
    } else if (platform === Platform.TENHOU) {
      const users = await UserModel.find({
        "tenhouIdentity.name": {
          $in: allAccountIds.map((id) => id.toString()),
        },
        isDeleted: { $ne: true },
      })
        .select(
          "_id name firstName lastName avatarUrl tenhouIdentity discordIdentity"
        )
        .lean();

      existingUsers = users.map((u: any) => ({
        _id: u._id.toString(),
        name: u.name,
        firstName: u.firstName ?? undefined,
        lastName: u.lastName ?? undefined,
        avatarUrl: u.avatarUrl ?? undefined,
        platformId: u.tenhouIdentity?.name ?? "",
        discordId: u.discordIdentity?.id ?? undefined,
      }));
    }
    const userByPlatformId = new Map(
      existingUsers.map((u) => [u.platformId, u])
    );

    // Fetch Discord guild members if the league is linked to a Discord server
    const discordServerId = league.discordConfig?.serverId ?? null;
    const guildMemberMap = new Map<
      string,
      { avatarUrl: string | null; displayName: string }
    >();

    if (discordServerId) {
      try {
        const guildMembers = await fetchGuildMembers(discordServerId);
        for (const member of guildMembers) {
          const userId = member.user?.id;
          if (userId) {
            const avatarUrl = member.avatar
              ? `https://cdn.discordapp.com/guilds/${discordServerId}/users/${userId}/avatars/${member.avatar}.png?size=64`
              : member.user.avatar
                ? `https://cdn.discordapp.com/avatars/${userId}/${member.user.avatar}.png?size=64`
                : null;
            guildMemberMap.set(userId, {
              avatarUrl,
              displayName:
                member.nick ?? member.user.global_name ?? member.user.username,
            });
          }
        }
      } catch (err) {
        console.warn("Failed to fetch Discord guild members:", err);
      }
    }

    // Enrich a single roster member with its matched user + Discord status.
    const enrichMember = (m: {
      accountId: number | string;
      nickname: string;
    }) => {
      const existing = userByPlatformId.get(m.accountId.toString());
      const discordId = existing?.discordId ?? null;
      const guildMember = discordId
        ? (guildMemberMap.get(discordId) ?? null)
        : null;

      return {
        accountId: m.accountId,
        nickname: m.nickname,
        existingUser: existing
          ? {
              _id: existing._id,
              name: existing.name,
              firstName: existing.firstName ?? null,
              lastName: existing.lastName ?? null,
              avatarUrl: existing.avatarUrl ?? null,
              discordId: existing.discordId ?? null,
              discordAvatarUrl: guildMember?.avatarUrl ?? null,
              isOnServer: discordId ? guildMemberMap.has(discordId) : null,
            }
          : null,
      };
    };

    // Enrich team configs (team mode) or the flat player list (individual).
    const enrichedTeams = teamConfigs.map((team) => ({
      name: team.name,
      members: team.members.map(enrichMember),
    }));
    const enrichedPlayers = playerConfigs.map(enrichMember);

    return Response.json({
      leagueId: league._id.toString(),
      leagueName: league.name,
      platform,
      isTeamMode,
      discordServerId,
      teams: enrichedTeams,
      players: enrichedPlayers,
    });
  } catch (error) {
    console.error("Failed to fetch team import preview:", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch team data",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/league-team-import
 *
 * Confirms the roster import: creates missing users and, for team-mode
 * leagues, upserts Team documents. Individual leagues only create/link
 * users (no teams).
 * Body: {
 *   leagueId: string,
 *   discordOverrides?: Record<string, { discordId, username, displayName, avatarUrl }>
 *     — keyed by platform accountId, applied to the user document
 * }
 */
export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const { leagueId, discordOverrides } = body as {
    leagueId: string;
    discordOverrides?: Record<
      string,
      {
        discordId: string;
        username: string;
        displayName: string;
        avatarUrl: string | null;
      }
    >;
  };

  if (!leagueId) {
    return Response.json({ error: "Missing leagueId" }, { status: 400 });
  }

  const auth = await requireLeagueAdmin(request, leagueId);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const league = await LeagueModel.findById(leagueId).lean<League>();
    if (!league) {
      return Response.json({ error: "League not found" }, { status: 404 });
    }

    if (!league.platformConfig.tournamentId) {
      return Response.json(
        { error: "League has no tournament ID configured" },
        { status: 400 }
      );
    }

    const isTeamMode = league.rulesConfig.isTeamMode;
    const connector = createConnectorForLeague(league);
    const platform = league.platformConfig.platformName;
    let createdCount = 0;

    if (isTeamMode) {
      if (!connector.getTeamsConfig) {
        return Response.json(
          { error: "Platform does not support team config" },
          { status: 400 }
        );
      }

      const teamConfigs = await connector.getTeamsConfig(
        league.platformConfig.tournamentId,
        { seasonId: league.platformConfig.seasonId ?? undefined }
      );

      // Delete all existing teams for this league before creating fresh ones
      await TeamModel.deleteMany({ leagueId: league._id }).exec();

      for (const teamConfig of teamConfigs) {
        const memberUserIds: string[] = [];

        for (const member of teamConfig.members) {
          const { userId, created } = await findOrCreateMemberUser(
            member,
            platform,
            discordOverrides
          );
          memberUserIds.push(userId);
          if (created) {
            createdCount++;
          }
        }

        // Create new Team document
        await TeamModel.create({
          simpleName: teamConfig.name,
          displayName: teamConfig.name,
          leagueId: league._id,
          roster: {
            captain: new mongoose.Types.ObjectId(memberUserIds[0]),
            members: memberUserIds.map((id) => new mongoose.Types.ObjectId(id)),
            substitutes: [],
          },
        });
      }

      return Response.json({
        success: true,
        teamsProcessed: teamConfigs.length,
        usersCreated: createdCount,
        teamsUpdated: teamConfigs.length,
      });
    }

    // Individual (non-team) league: create or link a user for every player
    // registered on the platform. Individual leagues do not store a team
    // roster — players surface in the tournament once they play games — so
    // importing here simply guarantees each platform player maps to a real
    // user (with Discord linked) ahead of time.
    if (!connector.getPlayersConfig) {
      return Response.json(
        { error: "Platform does not support importing individual players" },
        { status: 400 }
      );
    }

    const playerConfigs = await connector.getPlayersConfig(
      league.platformConfig.tournamentId,
      { seasonId: league.platformConfig.seasonId ?? undefined }
    );

    for (const player of playerConfigs) {
      const { created } = await findOrCreateMemberUser(
        player,
        platform,
        discordOverrides
      );
      if (created) {
        createdCount++;
      }
    }

    return Response.json({
      success: true,
      teamsProcessed: 0,
      playersProcessed: playerConfigs.length,
      usersCreated: createdCount,
      teamsUpdated: 0,
    });
  } catch (error) {
    console.error("Failed to confirm team import:", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to import team data",
      },
      { status: 500 }
    );
  }
}
