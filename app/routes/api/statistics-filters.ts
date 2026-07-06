import type { Route } from "./+types/statistics-filters";
import { connectToDatabase } from "../../utils/dbConnection.server";
import { getAllGuildMembers } from "../../utils/discord-guilds.server";
import { LeagueModel, type League } from "../../db/League";
import { TeamModel, type Team } from "../../db/Team";
import { UserModel, type User } from "../../db/User";
import { GameModel, type Game } from "../../db/Game";
import {
  BracketModel,
  type Bracket,
  getSeedingParticipantId,
} from "../../db/Bracket";
import {
  isMultiPhaseLeague,
  resolveLeagueTypeConfig,
} from "~/services/league-configs";
import { computeMultiPhaseStandings } from "~/services/league-strategies/multiPhaseStrategies";
import { slugify } from "~/utils/slugify";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await connectToDatabase();

    const url = new URL(request.url);
    const leagueSlug = url.searchParams.get("leagueSlug");

    // Find the target league by slug
    let league: League | null = null;
    if (leagueSlug) {
      const allLeagues = await LeagueModel.find({})
        .select(
          "_id name rulesConfig phaseCutoffTimes leagueTypeConfig officialSubstitutes"
        )
        .populate("leagueTypeConfig")
        .lean<League[]>();
      league =
        allLeagues.find((l) => slugify(l.name) === leagueSlug.toLowerCase()) ??
        null;
    }

    if (!league) {
      return Response.json({ error: "League not found" }, { status: 404 });
    }

    const leagueId = league._id.toString();
    const leagueObjId = league._id;

    const [teams, gameDateRange, leagueGamePlayers, brackets] =
      await Promise.all([
        TeamModel.find({ leagueId: leagueObjId })
          .select("_id simpleName displayName leagueId roster pictures")
          .lean<Team[]>(),
        GameModel.aggregate([
          { $match: { league: leagueObjId } },
          {
            $group: {
              _id: "$league",
              minStartTime: { $min: "$startTime" },
              maxStartTime: { $max: "$startTime" },
            },
          },
        ]),
        GameModel.aggregate([
          { $match: { league: leagueObjId } },
          { $unwind: "$results" },
          {
            $group: {
              _id: "$league",
              userIds: { $addToSet: "$results.userId" },
            },
          },
        ]),
        BracketModel.find({ league: leagueObjId })
          .select("_id league seedings")
          .lean<Bracket[]>(),
      ]);

    // Collect all user IDs involved in this league
    const leaguePlayerIdSet = new Set<string>();
    for (const team of teams) {
      for (const memberId of team.roster.members ?? []) {
        leaguePlayerIdSet.add(memberId.toString());
      }
      for (const subId of team.roster.substitutes ?? []) {
        leaguePlayerIdSet.add(subId.toString());
      }
    }
    for (const row of leagueGamePlayers as any[]) {
      for (const userId of row.userIds ?? []) {
        leaguePlayerIdSet.add(userId.toString());
      }
    }

    // Exclude official substitutes from the statistics player list
    for (const id of league.officialSubstitutes ?? []) {
      leaguePlayerIdSet.delete(id.toString());
    }

    // Only fetch users who are part of this league
    const users = await UserModel.find({
      _id: { $in: [...leaguePlayerIdSet] },
      isDeleted: { $ne: true },
    })
      .select(
        "_id name discordIdentity avatarUrl majsoulIdentity riichiCityIdentity tenhouIdentity"
      )
      .sort({ name: 1 })
      .lean<User[]>();

    // Build game date range
    const dateRange = gameDateRange[0]
      ? {
          min: gameDateRange[0].minStartTime.toISOString(),
          max: gameDateRange[0].maxStartTime.toISOString(),
        }
      : null;

    // Only fetch Discord members if any user is missing cached info
    const needsDiscordFetch = users.some(
      (u) =>
        u.discordIdentity?.id &&
        (!u.avatarUrl || !u.discordIdentity?.displayName)
    );

    const discordMap = new Map<
      string,
      {
        nick: string | null;
        displayName: string;
        avatar: string | null;
        userId: string;
      }
    >();

    if (needsDiscordFetch) {
      const discordMembers = await getAllGuildMembers().catch((err) => {
        console.error("Failed to fetch Discord members:", err);
        return [] as any[];
      });

      for (const member of discordMembers) {
        const userId = member.user?.id;
        if (userId) {
          discordMap.set(userId, {
            nick: member.nick ?? null,
            displayName: member.user.global_name ?? member.user.username,
            avatar: member.avatar
              ? `https://cdn.discordapp.com/guilds/${member.guild_id ?? ""}/users/${userId}/avatars/${member.avatar}.png?size=64`
              : member.user.avatar
                ? `https://cdn.discordapp.com/avatars/${userId}/${member.user.avatar}.png?size=64`
                : null,
            userId,
          });
        }
      }

      // Hydrate only users missing Discord info
      const bulkOps = users
        .filter(
          (u) =>
            u.discordIdentity?.id &&
            (!u.avatarUrl || !(u as any).lastKnownDiscordName) &&
            discordMap.has(u.discordIdentity!.id)
        )
        .map((u) => {
          const discord = discordMap.get(u.discordIdentity!.id)!;
          const resolvedName = discord.nick ?? discord.displayName;
          return {
            updateOne: {
              filter: { _id: u._id },
              update: {
                $set: {
                  avatarUrl: discord.avatar,
                  "discordIdentity.displayName": resolvedName,
                },
              },
            },
          };
        });
      if (bulkOps.length > 0) {
        UserModel.bulkWrite(bulkOps).catch((err: any) =>
          console.error("Failed to hydrate user Discord data:", err)
        );
      }
    }

    // ---------- Compute eliminated teams ----------
    const eliminatedTeams: string[] = [];
    const leagueType = resolveLeagueTypeConfig(league.leagueTypeConfig);

    if (isMultiPhaseLeague(leagueType) && leagueType) {
      const cutoffs = (league.phaseCutoffTimes ?? []).map((d) => new Date(d));
      const now = new Date();
      if (cutoffs.length > 0 && now >= cutoffs[0]) {
        const multiPhaseGames = await GameModel.find({
          league: leagueObjId,
          isValid: true,
        })
          .select("league startTime results phaseId")
          .lean<Game[]>();

        const games = multiPhaseGames.map((g) => ({
          startTime: g.startTime,
          phaseId: g.phaseId,
          results: (g.results ?? []).map((r) => ({
            userId: r.userId.toString(),
            score: r.score,
          })),
        }));

        const allTeamIds = new Set(teams.map((t) => t._id.toString()));
        let currentPhase = 0;
        for (const c of cutoffs) {
          if (now >= c) {
            currentPhase++;
          }
        }
        for (let targetPhase = 0; targetPhase < currentPhase; targetPhase++) {
          const result = computeMultiPhaseStandings(
            leagueType,
            games,
            league.rulesConfig?.gameRules,
            teams,
            cutoffs,
            targetPhase
          );
          const phaseDef = leagueType.regularPhases?.[targetPhase];
          if (phaseDef?.progression) {
            const advancingIds = new Set(
              result.standings
                .slice(0, phaseDef.progression.advancingCount)
                .map((s) => s.teamId)
            );
            for (const teamId of allTeamIds) {
              if (!advancingIds.has(teamId)) {
                eliminatedTeams.push(teamId);
              }
            }
          }
        }
      }
    } else {
      // Bracket-based: teams NOT in bracket seedings are eliminated
      const bracket = brackets[0] ?? null;
      if (bracket) {
        const allTeamIds = new Set(teams.map((t) => t._id.toString()));
        const seededTeamIds = new Set<string>();

        for (const s of bracket.seedings ?? []) {
          seededTeamIds.add(
            getSeedingParticipantId(
              s,
              leagueType?.isTeamMode !== false
            ).toString()
          );
        }
        for (const teamId of allTeamIds) {
          if (!seededTeamIds.has(teamId)) {
            eliminatedTeams.push(teamId);
          }
        }
      }
    }

    // ---------- Build bracket seedings for response ----------
    const bracketData = brackets.map((b) => {
      const rawSeedings = new Map<number, string>();
      for (const s of b.seedings ?? []) {
        rawSeedings.set(
          s.seed,
          getSeedingParticipantId(
            s,
            leagueType?.isTeamMode !== false
          ).toString()
        );
      }

      return {
        leagueId,
        seedings: Array.from(rawSeedings.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([seed, participantId]) => ({
            seed,
            teamId: participantId,
          })),
      };
    });

    return Response.json({
      league: {
        _id: leagueId,
        name: league.name,
        hasTeams: league.rulesConfig?.isTeamMode,
        phaseCutoffTimes: (league.phaseCutoffTimes ?? []).map((d) =>
          new Date(d).toISOString()
        ),
        hasFinalPhase: !!leagueType?.finalPhase,
        hasRegularPhase:
          !!leagueType?.regularPhase ||
          (leagueType?.regularPhases?.length ?? 0) > 0,
        configuration: (league.leagueTypeConfig as any)?.displayName ?? null,
        earliestGameDate: dateRange?.min ?? null,
        latestGameDate: dateRange?.max ?? null,
      },
      teams: teams.map((t) => ({
        _id: t._id.toString(),
        displayName: t.displayName,
        simpleName: t.simpleName,
        leagueId: t.leagueId.toString(),
        pictures: (t as any).pictures ?? null,
        roster: {
          members: (t.roster.members ?? []).map((m) => m.toString()),
          substitutes: (t.roster.substitutes ?? []).map((m) => m.toString()),
        },
      })),
      brackets: bracketData,
      users: users.map((u) => {
        const discord = u.discordIdentity?.id
          ? discordMap.get(u.discordIdentity.id)
          : null;
        return {
          _id: u._id.toString(),
          name:
            discord?.nick ??
            discord?.displayName ??
            u.discordIdentity?.displayName ??
            u.name,
          avatarUrl: discord?.avatar ?? u.avatarUrl ?? null,
          majsoulName:
            u.majsoulIdentity?.name ??
            u.riichiCityIdentity?.name ??
            u.tenhouIdentity?.name ??
            null,
        };
      }),
      playerIds: Array.from(leaguePlayerIdSet),
      eliminatedTeams,
    });
  } catch (error) {
    console.error("Error fetching statistics filters:", error);
    return Response.json(
      { error: "Failed to load filter data" },
      { status: 500 }
    );
  }
}
