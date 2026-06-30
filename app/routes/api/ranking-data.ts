import { connectToDatabase } from "../../utils/dbConnection.server";
import { getLeagueUserPictureMapForLeagues } from "../../services/leagueUserPictures.server";
import type { Route } from "./+types/ranking-data";
import mongoose from "mongoose";
import { GameModel, type Game } from "../../db/Game";
import { TeamModel, type Team } from "../../db/Team";
import { UserModel, type User } from "../../db/User";
import { GameRecordModel, type GameRecord } from "../../db/GameRecord";
import { LeagueModel } from "../../db/League";

import { getLeagueApiCache } from "~/services/leagueApiCache.server";

// ---------- In-memory cache (survives across requests in the same process) ----------
function getCached(key: string): unknown {
  return getLeagueApiCache<unknown>("ranking-data").get(key);
}

function setCache(key: string, data: unknown): void {
  getLeagueApiCache<unknown>("ranking-data").set(key, data);
}

/**
 * GET /api/ranking-data
 *
 * Query params:
 *   leagueIds   – comma-separated league ObjectId strings (optional, defaults to all)
 *   entityType  – "player" or "team" (required)
 *   entityIds   – comma-separated ObjectId strings (optional, defaults to all of that type)
 *   startDate   – ISO date string (optional)
 *   endDate     – ISO date string (optional)
 *
 * Returns the top 6 entities (players or teams) ranked by total dora count,
 * along with average per round won. Also returns ura dora stats.
 *
 * Response: { rankings: [{ id, label, avatarUrl?, totalDora, totalUraDora, gameCount, roundsWon, avgDoraPerRoundWon, avgUraDoraPerRoundWon }] }
 */
export async function loader({ request }: Route.LoaderArgs) {
  try {
    const url = new URL(request.url);
    const cacheKey = `ranking-data:${url.search}`;
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
    const phaseFilter = url.searchParams.get("phaseFilter") ?? "both";
    const finalsCutoffTimeParam = url.searchParams.get("finalsCutoffTime");

    await connectToDatabase();
    const Game = GameModel;
    const Team = TeamModel;
    const User = UserModel;
    const GameRecord = GameRecordModel;
    const League = LeagueModel;

    // When no leagues specified, use all leagues
    let effectiveLeagueIds = leagueIds;
    if (effectiveLeagueIds.length === 0) {
      const allLeagues = await League.find({})
        .select("_id")
        .lean<{ _id: mongoose.Types.ObjectId }[]>();
      effectiveLeagueIds = allLeagues.map((l) => l._id.toString());
    }

    // ---------- Resolve which player IDs to consider ----------
    let resolvedPlayerIds: string[] = [];
    const teamMemberMap = new Map<string, string[]>();

    const useTeamMode = entityType === "team";
    let effectiveTeamIds: string[] = [];

    if (useTeamMode) {
      // Resolve effective team IDs: use provided entityIds, or all teams in selected leagues
      effectiveTeamIds = entityIds.length > 0 ? entityIds : [];
      if (effectiveTeamIds.length === 0) {
        const allTeams = await Team.find({
          leagueId: {
            $in: effectiveLeagueIds.map(
              (id) => new mongoose.Types.ObjectId(id)
            ),
          },
        })
          .select("_id")
          .lean<{ _id: mongoose.Types.ObjectId }[]>();
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
      // Player mode: use provided entityIds, or all players from league teams
      if (entityIds.length > 0) {
        resolvedPlayerIds = entityIds;
      } else {
        const leagueTeams = await Team.find({
          leagueId: {
            $in: effectiveLeagueIds.map(
              (id) => new mongoose.Types.ObjectId(id)
            ),
          },
        })
          .select("roster")
          .lean<Team[]>();
        const playerIdSet = new Set<string>();
        for (const team of leagueTeams) {
          for (const m of team.roster.members ?? []) {
            playerIdSet.add(m.toString());
          }
          for (const s of team.roster.substitutes ?? []) {
            playerIdSet.add(s.toString());
          }
        }
        resolvedPlayerIds = [...playerIdSet];
      }
    }

    // ---------- Find matching games ----------
    const gameMatchFilter: {
      league: { $in: mongoose.Types.ObjectId[] };
      "results.userId": { $in: mongoose.Types.ObjectId[] };
      startTime?: { $gte?: Date; $lte?: Date; $lt?: Date };
    } = {
      league: {
        $in: effectiveLeagueIds.map((id) => new mongoose.Types.ObjectId(id)),
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
    if (finalsCutoffTimeParam) {
      const cutoff = new Date(finalsCutoffTimeParam);
      if (phaseFilter === "regular") {
        gameMatchFilter.startTime = {
          ...(gameMatchFilter.startTime ?? {}),
          $lt: cutoff,
        };
      } else if (phaseFilter === "finals") {
        gameMatchFilter.startTime = {
          ...(gameMatchFilter.startTime ?? {}),
          $gte: cutoff,
        };
      }
    }

    // Get matching game IDs
    const matchingGames = await Game.find(gameMatchFilter)
      .select("_id gameId startTime")
      .lean<Game[]>();

    if (matchingGames.length === 0) {
      const result = { rankings: [] };
      setCache(cacheKey, result);
      return Response.json(result);
    }

    // Build a set of gameIds for GameRecord lookup
    const gameIdSet = new Set(matchingGames.map((g) => g.gameId as string));
    const resolvedPlayerSet = new Set(resolvedPlayerIds);

    // ---------- Aggregate dora from GameRecords ----------
    // Fetch GameRecords matching these games
    const gameRecords = await GameRecord.find({
      gameId: { $in: [...gameIdSet] },
    })
      .select(
        "gameId byUserData.userDbId byUserData.teamDbId byUserData.roundEvents.totalDoraValue byUserData.roundEvents.uraDoraValue byUserData.roundEvents.hanValue byUserData.roundEvents.fuValue byUserData.roundEvents.isWinner byUserData.roundEvents.isTsumo byUserData.roundEvents.hasRiichi byUserData.roundEvents.ryuukyoku byUserData.roundEvents.ryuukyokuValue byUserData.roundEvents.wasOpened byUserData.roundEvents.numberOfCalls byUserData.roundEvents.firstTenpaiTurn byUserData.roundEvents.gotRonned byUserData.roundEvents.pointsDiff"
      )
      .lean<GameRecord[]>();

    const playerDora = new Map<
      string,
      {
        total: number;
        totalUra: number;
        totalHan: number;
        totalFu: number;
        totalRyuukyoku: number;
        totalOpened: number;
        totalCalls: number;
        totalRounds: number;
        totalTenpaiTurn: number;
        roundsWithTenpai: number;
        gameIds: Set<string>;
        roundsWon: number;
        roundsWonWithRiichi: number;
        roundsDrawn: number;
        roundsTsumo: number;
        totalDealIn: number;
        totalDealInValue: number;
        totalWinValue: number;
      }
    >();

    for (const record of gameRecords) {
      const gid = record.gameId as string;
      for (const userData of record.byUserData ?? []) {
        const pid = userData.userDbId?.toString();
        if (!pid || !resolvedPlayerSet.has(pid)) {
          continue;
        }

        let doraSum = 0;
        let uraDoraSum = 0;
        let hanSum = 0;
        let fuSum = 0;
        let ryuukyokuSum = 0;
        let openedCount = 0;
        let callsSum = 0;
        let roundCount = 0;
        let roundsWon = 0;
        let roundsWonWithRiichi = 0;
        let roundsDrawn = 0;
        let roundsTsumo = 0;
        let dealInCount = 0;
        let dealInValueSum = 0;
        let winValueSum = 0;
        let tenpaiTurnSum = 0;
        let roundsWithTenpai = 0;
        for (const round of userData.roundEvents ?? []) {
          roundCount++;
          doraSum += round.totalDoraValue ?? 0;
          if (round.isWinner && round.hasRiichi) {
            uraDoraSum += round.uraDoraValue ?? 0;
            roundsWonWithRiichi++;
          }
          const tenpaiTurn = round.firstTenpaiTurn ?? 0;
          if (tenpaiTurn > 0) {
            tenpaiTurnSum += tenpaiTurn;
            roundsWithTenpai++;
          }
          if ((round.numberOfCalls ?? 0) > 0) {
            openedCount++;
          }
          callsSum += round.numberOfCalls ?? 0;
          if (round.isWinner) {
            roundsWon++;
            hanSum += round.hanValue ?? 0;
            fuSum += round.fuValue ?? 0;
            winValueSum += round.pointsDiff ?? 0;
            if (round.isTsumo) {
              roundsTsumo++;
            }
          }
          if (round.ryuukyoku) {
            roundsDrawn++;
            ryuukyokuSum += round.ryuukyokuValue ?? 0;
          }
          if (round.gotRonned) {
            dealInCount++;
            dealInValueSum += Math.abs(round.pointsDiff ?? 0);
          }
        }

        if (!playerDora.has(pid)) {
          playerDora.set(pid, {
            total: 0,
            totalUra: 0,
            totalHan: 0,
            totalFu: 0,
            totalRyuukyoku: 0,
            totalOpened: 0,
            totalCalls: 0,
            totalRounds: 0,
            totalTenpaiTurn: 0,
            roundsWithTenpai: 0,
            gameIds: new Set(),
            roundsWon: 0,
            roundsWonWithRiichi: 0,
            roundsDrawn: 0,
            roundsTsumo: 0,
            totalDealIn: 0,
            totalDealInValue: 0,
            totalWinValue: 0,
          });
        }
        const entry = playerDora.get(pid)!;
        entry.total += doraSum;
        entry.totalUra += uraDoraSum;
        entry.totalHan += hanSum;
        entry.totalFu += fuSum;
        entry.totalRyuukyoku += ryuukyokuSum;
        entry.totalOpened += openedCount;
        entry.totalCalls += callsSum;
        entry.totalRounds += roundCount;
        entry.totalTenpaiTurn += tenpaiTurnSum;
        entry.roundsWithTenpai += roundsWithTenpai;
        entry.gameIds.add(gid);
        entry.roundsWon += roundsWon;
        entry.roundsWonWithRiichi += roundsWonWithRiichi;
        entry.roundsDrawn += roundsDrawn;
        entry.roundsTsumo += roundsTsumo;
        entry.totalDealIn += dealInCount;
        entry.totalDealInValue += dealInValueSum;
        entry.totalWinValue += winValueSum;
      }
    }

    // ---------- Build rankings (team or player mode) ----------
    if (useTeamMode) {
      const teamsData = await Team.find({
        _id: {
          $in: effectiveTeamIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
        .select("_id displayName roster pictures")
        .lean<Team[]>();

      const rankings = teamsData
        .map((team) => {
          const memberIds = [
            ...(team.roster.members ?? []).map((m) => m.toString()),
            ...(team.roster.substitutes ?? []).map((m) => m.toString()),
          ];
          let totalDora = 0;
          let totalUraDora = 0;
          let totalHan = 0;
          let totalFu = 0;
          let totalRyuukyoku = 0;
          let totalOpened = 0;
          let totalCalls = 0;
          let totalRounds = 0;
          let totalTenpaiTurn = 0;
          let totalRoundsWithTenpai = 0;
          let totalRoundsWon = 0;
          let totalRoundsWonWithRiichi = 0;
          let totalRoundsDrawn = 0;
          let totalRoundsTsumo = 0;
          let totalDealIn = 0;
          let totalDealInValue = 0;
          let totalWinValue = 0;
          const teamGameIds = new Set<string>();
          for (const memberId of memberIds) {
            const data = playerDora.get(memberId);
            if (data) {
              totalDora += data.total;
              totalUraDora += data.totalUra;
              totalHan += data.totalHan;
              totalFu += data.totalFu;
              totalRyuukyoku += data.totalRyuukyoku;
              totalOpened += data.totalOpened;
              totalCalls += data.totalCalls;
              totalRounds += data.totalRounds;
              totalTenpaiTurn += data.totalTenpaiTurn;
              totalRoundsWithTenpai += data.roundsWithTenpai;
              totalRoundsWon += data.roundsWon;
              totalRoundsWonWithRiichi += data.roundsWonWithRiichi;
              totalRoundsDrawn += data.roundsDrawn;
              totalRoundsTsumo += data.roundsTsumo;
              totalDealIn += data.totalDealIn;
              totalDealInValue += data.totalDealInValue;
              totalWinValue += data.totalWinValue;
              for (const gid of data.gameIds) {
                teamGameIds.add(gid);
              }
            }
          }
          const gameCount = teamGameIds.size;
          return {
            id: team._id.toString(),
            label: team.displayName,
            ...(team.pictures?.croppedPicture
              ? { avatarUrl: team.pictures.croppedPicture }
              : {}),
            totalDora,
            totalUraDora,
            totalHan,
            totalFu,
            totalRyuukyoku,
            totalOpened,
            totalCalls,
            totalRounds,
            gameCount,
            roundsWon: totalRoundsWon,
            roundsDrawn: totalRoundsDrawn,
            avgDoraPerRoundWon:
              totalRoundsWon > 0
                ? Math.round((totalDora / totalRoundsWon) * 100) / 100
                : 0,
            avgUraDoraPerRoundWon:
              totalRoundsWonWithRiichi > 0
                ? Math.round((totalUraDora / totalRoundsWonWithRiichi) * 100) /
                  100
                : 0,
            avgHanPerRoundWon:
              totalRoundsWon > 0
                ? Math.round((totalHan / totalRoundsWon) * 100) / 100
                : 0,
            avgFuPerRoundWon:
              totalRoundsWon > 0
                ? Math.round((totalFu / totalRoundsWon) * 100) / 100
                : 0,
            avgRyuukyokuPerDraw:
              totalRoundsDrawn > 0
                ? Math.round((totalRyuukyoku / totalRoundsDrawn) * 100) / 100
                : 0,
            callRate:
              totalRounds > 0
                ? Math.round((totalOpened / totalRounds) * 10000) / 100
                : 0,
            avgCallsPerRound:
              totalRounds > 0
                ? Math.round((totalCalls / totalRounds) * 100) / 100
                : 0,
            avgTenpaiTurn:
              totalRoundsWithTenpai > 0
                ? Math.round((totalTenpaiTurn / totalRoundsWithTenpai) * 100) /
                  100
                : 0,
            winRate:
              totalRounds > 0
                ? Math.round((totalRoundsWon / totalRounds) * 10000) / 100
                : 0,
            tsumoRate:
              totalRounds > 0
                ? Math.round((totalRoundsTsumo / totalRounds) * 10000) / 100
                : 0,
            totalTsumo: totalRoundsTsumo,
            totalDealIn,
            dealInRate:
              totalRounds > 0
                ? Math.round((totalDealIn / totalRounds) * 10000) / 100
                : 0,
            avgDealInValue:
              totalDealIn > 0
                ? Math.round((totalDealInValue / totalDealIn) * 100) / 100
                : 0,
            avgWinValue:
              totalRoundsWon > 0
                ? Math.round((totalWinValue / totalRoundsWon) * 100) / 100
                : 0,
          };
        })
        .sort((a, b) => b.totalDora - a.totalDora);

      const result = { rankings };
      setCache(cacheKey, result);
      return Response.json(result);
    } else {
      // Player mode
      const usersData = await User.find({
        _id: {
          $in: resolvedPlayerIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
        .select("_id name discordIdentity avatarUrl")
        .lean<User[]>();

      const userMap = new Map<
        string,
        { name: string; avatarUrl: string | null }
      >();
      for (const u of usersData) {
        userMap.set(u._id.toString(), {
          name: u.discordIdentity?.displayName ?? u.name ?? "Unknown",
          avatarUrl: u.avatarUrl ?? null,
        });
      }

      const leagueUserPictures =
        await getLeagueUserPictureMapForLeagues(effectiveLeagueIds);

      const rankings = resolvedPlayerIds
        .map((pid) => {
          const data = playerDora.get(pid);
          if (!data) {
            return null;
          }
          const totalDora = data.total ?? 0;
          const totalUraDora = data.totalUra ?? 0;
          const roundsWonWithRiichi = data.roundsWonWithRiichi ?? 0;
          const totalHan = data.totalHan ?? 0;
          const totalFu = data.totalFu ?? 0;
          const totalRyuukyoku = data.totalRyuukyoku ?? 0;
          const totalOpened = data.totalOpened ?? 0;
          const totalCalls = data.totalCalls ?? 0;
          const totalRounds = data.totalRounds ?? 0;
          const totalTenpaiTurn = data.totalTenpaiTurn ?? 0;
          const roundsWithTenpai = data.roundsWithTenpai ?? 0;
          const gameCount = data.gameIds.size ?? 0;
          const roundsWon = data.roundsWon ?? 0;
          const roundsDrawn = data.roundsDrawn ?? 0;
          const roundsTsumo = data.roundsTsumo ?? 0;
          const totalDealIn = data.totalDealIn ?? 0;
          const totalDealInValue = data.totalDealInValue ?? 0;
          const totalWinValue = data.totalWinValue ?? 0;
          const user = userMap.get(pid);
          return {
            id: pid,
            label: user?.name ?? pid,
            avatarUrl: user?.avatarUrl ?? null,
            leaguePicture: leagueUserPictures.get(pid) ?? null,
            totalDora,
            totalUraDora,
            totalHan,
            totalFu,
            totalRyuukyoku,
            totalOpened,
            totalCalls,
            totalRounds,
            gameCount,
            roundsWon,
            roundsDrawn,
            avgDoraPerRoundWon:
              roundsWon > 0
                ? Math.round((totalDora / roundsWon) * 100) / 100
                : 0,
            avgUraDoraPerRoundWon:
              roundsWonWithRiichi > 0
                ? Math.round((totalUraDora / roundsWonWithRiichi) * 100) / 100
                : 0,
            avgHanPerRoundWon:
              roundsWon > 0
                ? Math.round((totalHan / roundsWon) * 100) / 100
                : 0,
            avgFuPerRoundWon:
              roundsWon > 0 ? Math.round((totalFu / roundsWon) * 100) / 100 : 0,
            avgRyuukyokuPerDraw:
              roundsDrawn > 0
                ? Math.round((totalRyuukyoku / roundsDrawn) * 100) / 100
                : 0,
            callRate:
              totalRounds > 0
                ? Math.round((totalOpened / totalRounds) * 10000) / 100
                : 0,
            avgCallsPerRound:
              totalRounds > 0
                ? Math.round((totalCalls / totalRounds) * 100) / 100
                : 0,
            avgTenpaiTurn:
              roundsWithTenpai > 0
                ? Math.round((totalTenpaiTurn / roundsWithTenpai) * 100) / 100
                : 0,
            winRate:
              totalRounds > 0
                ? Math.round((roundsWon / totalRounds) * 10000) / 100
                : 0,
            tsumoRate:
              totalRounds > 0
                ? Math.round((roundsTsumo / totalRounds) * 10000) / 100
                : 0,
            totalTsumo: roundsTsumo,
            totalDealIn,
            dealInRate:
              totalRounds > 0
                ? Math.round((totalDealIn / totalRounds) * 10000) / 100
                : 0,
            avgDealInValue:
              totalDealIn > 0
                ? Math.round((totalDealInValue / totalDealIn) * 100) / 100
                : 0,
            avgWinValue:
              roundsWon > 0
                ? Math.round((totalWinValue / roundsWon) * 100) / 100
                : 0,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((a, b) => b.totalDora - a.totalDora);

      const result = { rankings };
      setCache(cacheKey, result);
      return Response.json(result);
    }
  } catch (error) {
    console.error("Error in ranking-data API:", error);
    return Response.json(
      { error: "Failed to compute dora rankings" },
      { status: 500 }
    );
  }
}
