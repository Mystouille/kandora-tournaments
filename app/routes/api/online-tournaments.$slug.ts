import type { Route } from "./+types/online-tournaments.$slug";
import type mongoose from "mongoose";
import { connectToDatabase } from "../../utils/dbConnection.server";
import { LeagueModel, type League, Platform } from "../../db/League";
import { LeagueTypeConfigModel } from "../../db/LeagueTypeConfig";
import { TeamModel } from "../../db/Team";
import { UserModel } from "../../db/User";
import { GameModel } from "../../db/Game";
import { slugify } from "../../utils/slugify";
import { getLeagueUserPictureMap } from "../../services/leagueUserPictures.server";

export async function loader({ params }: Route.LoaderArgs) {
  const { slug } = params;
  if (!slug) {
    return Response.json({ error: "Missing slug" }, { status: 400 });
  }

  try {
    await connectToDatabase();

    // Fetch all displayed leagues in one round-trip and pick the slug match
    // in memory (the set is tiny). Saves a separate `findById` query.
    const allLeagues = await LeagueModel.find({ isDisplayed: true }).lean<
      (Omit<League, "leagueTypeConfig"> & {
        leagueTypeConfig?: mongoose.Types.ObjectId | null;
      })[]
    >();
    const leagueDoc = allLeagues.find((l) => slugify(l.name) === slug);
    if (!leagueDoc) {
      return Response.json({ error: "League not found" }, { status: 404 });
    }

    const officialSubIds = (leagueDoc.officialSubstitutes ?? []).map(
      (id: any) => id.toString()
    );

    // Tight projection used inside every $lookup / find below. Keeps the
    // payload small and avoids returning unbounded fields like `lastName`
    const userProjection = {
      _id: 1,
      name: 1,
      firstName: 1,
      avatarUrl: 1,
      "discordIdentity.displayName": 1,
      "discordIdentity.guildDisplayNames": 1,
      "majsoulIdentity.name": 1,
      "riichiCityIdentity.name": 1,
    } as const;

    const userSelect =
      "_id name firstName avatarUrl " +
      "discordIdentity.displayName discordIdentity.guildDisplayNames " +
      "majsoulIdentity.name riichiCityIdentity.name";

    // Fan out four parallel queries, all dependent only on `leagueDoc._id`.
    // Teams and the games aggregation each $lookup their referenced users
    // inline so we avoid a separate UserModel.find round-trip; official
    // substitutes are fetched in parallel as a small dedicated find.
    const [
      leagueTypeConfig,
      teamsAgg,
      gamesFacetResult,
      officialSubsUsers,
      leagueUserPictures,
    ] = await Promise.all([
      leagueDoc.leagueTypeConfig
        ? LeagueTypeConfigModel.findById(leagueDoc.leagueTypeConfig).lean()
        : Promise.resolve(null),

      TeamModel.aggregate([
        { $match: { leagueId: leagueDoc._id } },
        {
          $project: {
            _id: 1,
            simpleName: 1,
            displayName: 1,
            pictures: 1,
            roster: 1,
            finalsRoster: 1,
          },
        },
        {
          $lookup: {
            from: "users",
            let: {
              ids: {
                $setUnion: [
                  { $ifNull: ["$roster.members", []] },
                  { $ifNull: ["$roster.substitutes", []] },
                  {
                    $cond: {
                      if: "$roster.captain",
                      then: ["$roster.captain"],
                      else: [],
                    },
                  },
                  { $ifNull: ["$finalsRoster.members", []] },
                  { $ifNull: ["$finalsRoster.substitutes", []] },
                  {
                    $cond: {
                      if: "$finalsRoster.captain",
                      then: ["$finalsRoster.captain"],
                      else: [],
                    },
                  },
                ],
              },
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $in: ["$_id", "$$ids"] },
                      { $ne: ["$isDeleted", true] },
                    ],
                  },
                },
              },
              { $project: userProjection },
            ],
            as: "_users",
          },
        },
      ]),

      GameModel.aggregate([
        { $match: { league: leagueDoc._id } },
        {
          $facet: {
            count: [{ $count: "n" }],
            players: [
              { $unwind: "$results" },
              { $group: { _id: "$results.userId" } },
              {
                $lookup: {
                  from: "users",
                  localField: "_id",
                  foreignField: "_id",
                  pipeline: [
                    { $match: { isDeleted: { $ne: true } } },
                    { $project: userProjection },
                  ],
                  as: "user",
                },
              },
              { $unwind: "$user" },
              { $replaceRoot: { newRoot: "$user" } },
            ],
          },
        },
      ]),

      officialSubIds.length > 0
        ? UserModel.find({
            _id: { $in: officialSubIds },
            isDeleted: { $ne: true },
          })
            .select(userSelect)
            .lean()
        : Promise.resolve([] as any[]),

      getLeagueUserPictureMap(leagueDoc._id),
    ]);

    const gamesFacet = gamesFacetResult[0] ?? { count: [], players: [] };
    const gameCount: number = gamesFacet.count[0]?.n ?? 0;
    const gamePlayerUsers: any[] = gamesFacet.players ?? [];

    const league = {
      ...leagueDoc,
      leagueTypeConfig,
    } as League;

    const leagueId = league._id.toString();

    // Resolve Discord guild nicknames for the league's server.
    // Per-guild nicknames are pre-synced into `discordIdentity.guildDisplayNames`
    // by the daily Discord sync worker, so no live Discord API calls are needed.
    const leagueServerId = league.discordConfig?.serverId;

    // Build composite display name with priority:
    // 1. firstName + lastInitial (precomputed in `user.name`)
    // 2. Discord nickname on the league's Discord server (cached)
    // 3. Global Discord display name (cached, main-server-or-fallback)
    // 4. Raw Discord username (user.name)
    // 5. Platform name (riichi city / majsoul)
    const platformName = league.platformConfig?.platformName;

    const resolveDisplayName = (u: any): string => {
      // 1. First name + last initial — already encoded in `user.name`
      //    by the User pre-save hook when firstName is set.
      if (u.firstName) {
        return u.name;
      }

      // 2. League-server nickname from the cached per-guild map
      if (leagueServerId) {
        const guildMap = u.discordIdentity?.guildDisplayNames;
        let leagueNick: string | undefined;
        if (guildMap instanceof Map) {
          leagueNick = guildMap.get(leagueServerId);
        } else if (guildMap && typeof guildMap === "object") {
          leagueNick = guildMap[leagueServerId];
        }
        if (leagueNick) {
          return leagueNick;
        }
      }

      // 3. Global Discord display name (synced from main server / fallback)
      if (u.discordIdentity?.displayName) {
        return u.discordIdentity.displayName;
      }

      // 4. Raw Discord username
      if (u.name) {
        return u.name;
      }

      // 5. Platform-specific name
      if (platformName === Platform.RIICHICITY && u.riichiCityIdentity?.name) {
        return u.riichiCityIdentity.name;
      }
      if (platformName === Platform.MAJSOUL && u.majsoulIdentity?.name) {
        return u.majsoulIdentity.name;
      }

      return "Unknown";
    };

    const resolvePlatformName = (u: any): string | null => {
      if (platformName === Platform.RIICHICITY && u.riichiCityIdentity?.name) {
        return u.riichiCityIdentity.name;
      }
      if (platformName === Platform.MAJSOUL && u.majsoulIdentity?.name) {
        return u.majsoulIdentity.name;
      }
      return null;
    };

    type ResolvedUser = {
      _id: string;
      name: string;
      platformDisplayName: string | null;
      avatarUrl: string | null;
      leaguePicture: import("../../types/pictures").PicturePair | null;
    };

    const userMap = new Map<string, ResolvedUser>();
    const addUser = (u: any) => {
      if (!u?._id) {
        return;
      }
      const key = u._id.toString();
      if (userMap.has(key)) {
        return;
      }
      userMap.set(key, {
        _id: key,
        name: resolveDisplayName(u),
        platformDisplayName: resolvePlatformName(u),
        avatarUrl: (u as any).avatarUrl ?? null,
        leaguePicture: leagueUserPictures.get(key) ?? null,
      });
    };

    for (const team of teamsAgg as any[]) {
      for (const u of team._users ?? []) {
        addUser(u);
      }
    }
    for (const u of gamePlayerUsers) {
      addUser(u);
    }
    for (const u of officialSubsUsers as any[]) {
      addUser(u);
    }

    const resolveRoster = (r: any) => ({
      captain: r?.captain ? (userMap.get(r.captain.toString()) ?? null) : null,
      members: (r?.members ?? []).map(
        (m: any) =>
          userMap.get(m.toString()) ?? {
            _id: m.toString(),
            name: "Unknown",
            platformDisplayName: null,
            avatarUrl: null,
            leaguePicture: null,
          }
      ),
      substitutes: (r?.substitutes ?? []).map(
        (s: any) =>
          userMap.get(s.toString()) ?? {
            _id: s.toString(),
            name: "Unknown",
            platformDisplayName: null,
            avatarUrl: null,
            leaguePicture: null,
          }
      ),
    });

    const teamsWithNames = (teamsAgg as any[]).map((team) => ({
      _id: team._id.toString(),
      simpleName: team.simpleName,
      displayName: team.displayName,
      pictures: team.pictures ?? null,
      roster: resolveRoster(team.roster),
      finalsRoster: team.finalsRoster ? resolveRoster(team.finalsRoster) : null,
    }));

    // Resolve official substitutes
    const officialSubstitutes = officialSubIds
      .map((id: string) => userMap.get(id))
      .filter(Boolean);

    // For non-team leagues, build a flat player list from game participants
    // (excluding official subs – they get their own section)
    const withTeams =
      league.rulesConfig?.isTeamMode ?? teamsWithNames.length > 0;
    const officialSubIdSet = new Set(officialSubIds);
    const playerList = withTeams
      ? []
      : gamePlayerUsers
          .map((u) => userMap.get(u._id.toString()))
          .filter((u): u is ResolvedUser => !!u && !officialSubIdSet.has(u._id))
          .sort((a, b) => a.name.localeCompare(b.name));

    return Response.json({
      _id: leagueId,
      name: league.name,
      slug: slugify(league.name),
      startTime: league.startTime,
      endTime: league.endTime,
      rulesConfig: league.rulesConfig,
      leagueTypeConfigName:
        (league.leagueTypeConfig as any)?.displayName ?? null,
      leagueTypeConfig: leagueTypeConfig
        ? {
            displayName: (leagueTypeConfig as any).displayName,
            isTeamMode: (leagueTypeConfig as any).isTeamMode ?? false,
            regularPhase: (leagueTypeConfig as any).regularPhase ?? undefined,
            regularPhases: (leagueTypeConfig as any).regularPhases ?? undefined,
            finalPhase: (leagueTypeConfig as any).finalPhase ?? undefined,
          }
        : null,
      platformConfig: league.platformConfig,
      phaseCutoffTimes: league.phaseCutoffTimes,
      presentation: league.presentation ?? { fr: "", en: "" },
      summary: league.summary ?? { fr: "", en: "" },
      coverImageUrl: league.coverImageUrl ?? "",
      gameCount,
      playerCount: userMap.size,
      withTeams,
      teams: teamsWithNames,
      players: playerList,
      officialSubstitutes,
    });
  } catch (error) {
    console.error("Failed to load league detail:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
