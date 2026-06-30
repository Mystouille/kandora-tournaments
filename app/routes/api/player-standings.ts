import { connectToDatabase } from "../../utils/dbConnection.server";
import { getLeagueUserPictureMapForLeagues } from "../../services/leagueUserPictures.server";
import type { Route } from "./+types/player-standings";
import mongoose from "mongoose";
import { GameModel, type Game } from "../../db/Game";
import { LeagueModel, type League } from "../../db/League";
import { TeamModel, type Team } from "../../db/Team";
import { UserModel, type User } from "../../db/User";
import { GameRecordModel, type GameRecord } from "../../db/GameRecord";
import { resolveLeagueTypeConfig } from "~/services/league-configs";
import {
  buildUserToTeamMap,
  computeNonTeamRankingData,
} from "~/services/league-strategies/regularRankingStrategies";

import { getLeagueApiCache } from "~/services/leagueApiCache.server";

// ---------- In-memory cache ----------
function getCached(key: string): any | null {
  return getLeagueApiCache<any>("player-standings").get(key);
}

function setCache(key: string, data: any): void {
  getLeagueApiCache<any>("player-standings").set(key, data);
}

/** Han codes that count as yakuman */
const YAKUMAN_HAN_CODES = new Set([
  35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 59,
]);

interface PlayerStanding {
  id: string;
  label: string;
  avatarUrl: string | null;
  leaguePicture: import("../../types/pictures").PicturePair | null;
  majsoulName: string | null;
  teamId: string | null;
  teamName: string | null;
  totalScore: number;
  rawPoints: number;
  bonusPoints: number;
  gameCount: number;
  avgPlacement: number;
  placements: [number, number, number, number];
  yakumanCount: number;
}

/**
 * GET /api/player-standings
 *
 * Query params:
 *   leagueIds   – comma-separated league ObjectId strings (required)
 *   entityType  – "player" or "team"
 *   entityIds   – comma-separated ObjectId strings (optional)
 *   startDate   – ISO date string (optional)
 *   endDate     – ISO date string (optional)
 *
 * Returns { standings: PlayerStanding[] }
 * In team mode, each team entry also includes a `members` array of PlayerStanding[].
 */
export async function loader({ request }: Route.LoaderArgs) {
  try {
    const url = new URL(request.url);
    const cacheKey = `player-standings:${url.search}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return Response.json(cached);
    }

    const leagueIds =
      url.searchParams.get("leagueIds")?.split(",").filter(Boolean) ?? [];
    const entityType =
      (url.searchParams.get("entityType") as "player" | "team") ?? "team";
    const entityIds =
      url.searchParams.get("entityIds")?.split(",").filter(Boolean) ?? [];
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");

    if (leagueIds.length === 0) {
      return Response.json({ error: "leagueIds is required" }, { status: 400 });
    }

    await connectToDatabase();
    const Game = GameModel;
    const Team = TeamModel;
    const User = UserModel;
    const GameRecord = GameRecordModel;

    // ---------- Resolve player IDs ----------
    let resolvedPlayerIds: string[] = [];
    const teamMemberMap = new Map<string, string[]>();
    const useTeamMode = entityType === "team";
    let effectiveTeamIds: string[] = [];

    // Collect official substitute IDs to exclude from standings
    const leagues = await LeagueModel.find({
      _id: { $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select("officialSubstitutes")
      .lean<Pick<League, "_id" | "officialSubstitutes">[]>();
    const officialSubIdSet = new Set<string>();
    for (const lg of leagues) {
      for (const id of lg.officialSubstitutes ?? []) {
        officialSubIdSet.add(id.toString());
      }
    }

    if (useTeamMode) {
      effectiveTeamIds = entityIds.length > 0 ? entityIds : [];
      if (effectiveTeamIds.length === 0) {
        const allTeams = await Team.find({
          leagueId: {
            $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .select("_id")
          .lean<Team[]>();
        effectiveTeamIds = allTeams.map((t) => t._id.toString());
      }

      const teamsData = await Team.find({
        _id: {
          $in: effectiveTeamIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
        .select("_id displayName roster pictures")
        .lean<Team[]>();

      for (const team of teamsData) {
        const memberIds = [
          ...(team.roster.members ?? []).map((m) => m.toString()),
          ...(team.roster.substitutes ?? []).map((m) => m.toString()),
        ];
        teamMemberMap.set(team._id.toString(), memberIds);
        resolvedPlayerIds.push(...memberIds);
      }
      resolvedPlayerIds = [...new Set(resolvedPlayerIds)];
    } else {
      if (entityIds.length > 0) {
        resolvedPlayerIds = entityIds;
      } else {
        // All players in the selected leagues via teams
        const allTeams = await Team.find({
          leagueId: {
            $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .select("_id roster")
          .lean<Team[]>();
        for (const team of allTeams) {
          for (const memberId of team.roster.members ?? []) {
            resolvedPlayerIds.push(memberId.toString());
          }
          for (const memberId of team.roster.substitutes ?? []) {
            resolvedPlayerIds.push(memberId.toString());
          }
        }
        resolvedPlayerIds = [...new Set(resolvedPlayerIds)];
      }
    }

    // Exclude official substitutes from all standings
    resolvedPlayerIds = resolvedPlayerIds.filter(
      (id) => !officialSubIdSet.has(id)
    );
    for (const [teamId, memberIds] of teamMemberMap) {
      teamMemberMap.set(
        teamId,
        memberIds.filter((id) => !officialSubIdSet.has(id))
      );
    }

    // ---------- Find matching games ----------
    const gameMatchFilter: any = {
      league: {
        $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
      "results.userId": {
        $in: resolvedPlayerIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    };
    if (startDate) {
      gameMatchFilter.startTime = {
        ...(gameMatchFilter.startTime ?? {}),
        $gte: new Date(startDate),
      };
    }
    if (endDate) {
      gameMatchFilter.startTime = {
        ...(gameMatchFilter.startTime ?? {}),
        $lte: new Date(endDate),
      };
    }

    const matchingGames = await Game.find(gameMatchFilter)
      .select("_id gameId")
      .lean<Game[]>();

    if (matchingGames.length === 0) {
      const result = { standings: [] };
      setCache(cacheKey, result);
      return Response.json(result);
    }

    const gameIdSet = new Set(
      matchingGames.map((g) => g.gameId).filter((id): id is string => !!id)
    );
    const resolvedPlayerSet = new Set(resolvedPlayerIds);

    // ---------- Aggregate from GameRecords ----------
    const gameRecords = await GameRecord.find({
      gameId: { $in: [...gameIdSet] },
    })
      .select(
        "gameId byUserData.userDbId byUserData.teamDbId byUserData.teamName byUserData.score byUserData.place byUserData.deltaPoints byUserData.roundEvents.yakus"
      )
      .lean<GameRecord[]>();

    const playerStats = new Map<
      string,
      {
        totalScore: number;
        rawPoints: number;
        gameCount: number;
        placements: [number, number, number, number];
        yakumanCount: number;
        teamId: string | null;
        teamName: string | null;
      }
    >();

    for (const record of gameRecords) {
      for (const userData of record.byUserData ?? []) {
        const pid = userData.userDbId?.toString();
        if (!pid || !resolvedPlayerSet.has(pid)) {
          continue;
        }

        const deltaPoints = userData.deltaPoints ?? 0;
        const score = userData.score ?? 25000;
        const place = userData.place ?? 4;
        const rawPts = (score - 25000) / 1000;

        // Count yakuman
        let yakumanCount = 0;
        for (const round of userData.roundEvents ?? []) {
          for (const yaku of round.yakus ?? []) {
            if (YAKUMAN_HAN_CODES.has(yaku)) {
              yakumanCount++;
            }
          }
        }

        if (!playerStats.has(pid)) {
          playerStats.set(pid, {
            totalScore: 0,
            rawPoints: 0,
            gameCount: 0,
            placements: [0, 0, 0, 0],
            yakumanCount: 0,
            teamId: userData.teamDbId?.toString() ?? null,
            teamName: userData.teamName ?? null,
          });
        }
        const entry = playerStats.get(pid)!;
        entry.totalScore += deltaPoints;
        entry.rawPoints += rawPts;
        entry.gameCount++;
        if (place >= 1 && place <= 4) {
          entry.placements[place - 1]++;
        }
        entry.yakumanCount += yakumanCount;
        // Update team info if not set
        if (!entry.teamId && userData.teamDbId) {
          entry.teamId = userData.teamDbId.toString();
          entry.teamName = userData.teamName ?? null;
        }
      }
    }

    // ---------- Fetch user info ----------
    const usersData = await User.find({
      _id: {
        $in: resolvedPlayerIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    })
      .select("_id name discordIdentity avatarUrl majsoulIdentity")
      .lean<User[]>();

    const userMap = new Map<
      string,
      { name: string; avatarUrl: string | null; majsoulName: string | null }
    >();
    for (const u of usersData) {
      userMap.set(u._id.toString(), {
        name: u.discordIdentity?.displayName ?? u.name ?? "Unknown",
        avatarUrl: u.avatarUrl ?? null,
        majsoulName: u.majsoulIdentity?.name ?? null,
      });
    }

    const leagueUserPictures =
      await getLeagueUserPictureMapForLeagues(leagueIds);

    // ---------- Apply ranking strategy if applicable ----------
    let rankingLabel: string | null = null;
    let useFactionMode = false;

    if (leagueIds.length === 1) {
      const league = await LeagueModel.findById(leagueIds[0])
        .select("rulesConfig leagueTypeConfig")
        .populate("leagueTypeConfig")
        .lean<League | null>();

      if (league) {
        const leagueType = resolveLeagueTypeConfig(league.leagueTypeConfig);
        const isTeamMode =
          league.rulesConfig?.isTeamMode ?? leagueType?.isTeamMode ?? true;
        const scoring = leagueType?.regularPhase?.scoring;

        if (!isTeamMode && scoring) {
          // Fetch valid games with scores for the ranking computation
          const validGames = await Game.find({
            league: new mongoose.Types.ObjectId(leagueIds[0]),
            isValid: true,
          })
            .select("startTime results")
            .lean<Game[]>();

          const teams = await Team.find({
            leagueId: new mongoose.Types.ObjectId(leagueIds[0]),
          }).lean<Team[]>();
          const userToTeamMap = buildUserToTeamMap(teams);

          const { sortedPlayers } = computeNonTeamRankingData(
            validGames.map((game) => ({
              startTime: game.startTime,
              results: (game.results ?? []).map((r) => ({
                userId: r.userId.toString(),
                score: r.score,
              })),
            })),
            league.rulesConfig?.gameRules,
            scoring,
            userToTeamMap
          );

          // Override totalScore with the strategy-computed ranking score
          for (const player of sortedPlayers) {
            const stats = playerStats.get(player.userId);
            if (stats) {
              stats.totalScore = player.rankingScore;
            }
          }

          rankingLabel = scoring.type;
          useFactionMode = true;
        }
      }
    }

    // ---------- Build player standings ----------
    const buildPlayerStanding = (pid: string): PlayerStanding => {
      const stats = playerStats.get(pid);
      const user = userMap.get(pid);
      const totalScore = stats?.totalScore ?? 0;
      const rawPoints = stats?.rawPoints ?? 0;
      const bonusPoints = Math.round((totalScore - rawPoints) * 10) / 10;
      const gameCount = stats?.gameCount ?? 0;
      const placements =
        stats?.placements ?? ([0, 0, 0, 0] as [number, number, number, number]);
      const totalPlacements = placements.reduce((a, b) => a + b, 0);
      const avgPlacement =
        totalPlacements > 0
          ? Math.round(
              ((placements[0] * 1 +
                placements[1] * 2 +
                placements[2] * 3 +
                placements[3] * 4) /
                totalPlacements) *
                100
            ) / 100
          : 0;
      return {
        id: pid,
        label: user?.name ?? pid,
        avatarUrl: user?.avatarUrl ?? null,
        leaguePicture: leagueUserPictures.get(pid) ?? null,
        majsoulName: user?.majsoulName ?? null,
        teamId: stats?.teamId ?? null,
        teamName: stats?.teamName ?? null,
        totalScore: Math.round(totalScore * 10) / 10,
        rawPoints: Math.round(rawPoints * 10) / 10,
        bonusPoints,
        gameCount,
        avgPlacement,
        placements,
        yakumanCount: stats?.yakumanCount ?? 0,
      };
    };

    if (useTeamMode) {
      // Build team-level standings with member breakdown
      const teamsData = await Team.find({
        _id: {
          $in: effectiveTeamIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
        .select("_id displayName roster pictures")
        .lean<Team[]>();

      const standings = teamsData.map((team) => {
        const memberIds = [
          ...(team.roster.members ?? []).map((m) => m.toString()),
          ...(team.roster.substitutes ?? []).map((m) => m.toString()),
        ];
        const members = memberIds
          .map(buildPlayerStanding)
          .filter((m: PlayerStanding) => m.gameCount > 0)
          .sort(
            (a: PlayerStanding, b: PlayerStanding) =>
              b.totalScore - a.totalScore
          );

        // Aggregate team totals
        // In faction mode, use the best-ranked player's values instead of summing
        const bestMember = members.length > 0 ? members[0] : null;
        const totalScore = useFactionMode
          ? (bestMember?.totalScore ?? 0)
          : members.reduce(
              (sum: number, m: PlayerStanding) => sum + m.totalScore,
              0
            );
        const rawPoints = useFactionMode
          ? (bestMember?.rawPoints ?? 0)
          : members.reduce(
              (sum: number, m: PlayerStanding) => sum + m.rawPoints,
              0
            );
        const bonusPoints = Math.round((totalScore - rawPoints) * 10) / 10;
        const gameCount = members.reduce(
          (sum: number, m: PlayerStanding) => sum + m.gameCount,
          0
        );
        const placements: [number, number, number, number] = [0, 0, 0, 0];
        for (const m of members) {
          for (let i = 0; i < 4; i++) {
            placements[i] += m.placements[i];
          }
        }
        const totalPlacements = placements.reduce((a, b) => a + b, 0);
        const avgPlacement =
          totalPlacements > 0
            ? Math.round(
                ((placements[0] * 1 +
                  placements[1] * 2 +
                  placements[2] * 3 +
                  placements[3] * 4) /
                  totalPlacements) *
                  100
              ) / 100
            : 0;
        const yakumanCount = members.reduce(
          (sum: number, m: PlayerStanding) => sum + m.yakumanCount,
          0
        );

        return {
          id: team._id.toString(),
          label: team.displayName,
          avatarUrl: (team as any).pictures?.croppedPicture ?? null,
          leaguePicture: null as
            | import("../../types/pictures").PicturePair
            | null,
          teamId: null as string | null,
          teamName: null as string | null,
          totalScore: Math.round(totalScore * 10) / 10,
          rawPoints: Math.round(rawPoints * 10) / 10,
          bonusPoints,
          gameCount,
          avgPlacement,
          placements,
          yakumanCount,
          members,
        };
      });

      // Sort by total score descending
      standings.sort((a, b) => b.totalScore - a.totalScore);

      const result = { standings, rankingLabel };
      setCache(cacheKey, result);
      return Response.json(result);
    } else {
      // Player mode
      const standings = resolvedPlayerIds
        .map(buildPlayerStanding)
        .filter((s) => s.gameCount > 0)
        .sort((a, b) => b.totalScore - a.totalScore);

      const result = { standings, rankingLabel };
      setCache(cacheKey, result);
      return Response.json(result);
    }
  } catch (error) {
    console.error("Error fetching player standings:", error);
    return Response.json(
      { error: "Failed to fetch player standings" },
      { status: 500 }
    );
  }
}
