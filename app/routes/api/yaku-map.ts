import { connectToDatabase } from "../../utils/dbConnection.server";
import type { Route } from "./+types/yaku-map";
import mongoose from "mongoose";
import { Han } from "~/types/Han";
import { GameModel, type Game } from "../../db/Game";
import { TeamModel, type Team } from "../../db/Team";
import { UserModel, type User } from "../../db/User";
import {
  GameRecordModel,
  type GameRecord,
  type UserGameRecordData,
} from "../../db/GameRecord";

const DORA_YAKU = Han.Dora; // 31
const URA_DORA_YAKU = Han.Ura_Dora; // 33
const RED_FIVE_YAKU = Han.Red_Five; // 32

/**
 * Count yakus for a winning round.
 * Dora: 1 if the round has Dora or Red Five yaku
 * Ura Dora: 1 if the round has the Ura Dora yaku
 * Red Five is folded into Dora (not shown separately)
 * All others: count = 1
 */
function getYakuCounts(
  round: UserGameRecordData["roundEvents"][number]
): { yakuId: number; count: number }[] {
  const yakus = new Set<number>(round.yakus ?? []);
  const results: { yakuId: number; count: number }[] = [];

  // Dora: count 1 if Dora or Red Five is present
  const hasDora = yakus.has(DORA_YAKU) || yakus.has(RED_FIVE_YAKU);
  if (hasDora) {
    results.push({ yakuId: DORA_YAKU, count: 1 });
  }

  // Ura Dora: count 1 if present
  if (yakus.has(URA_DORA_YAKU)) {
    results.push({ yakuId: URA_DORA_YAKU, count: 1 });
  }

  // All other yakus (skip Dora, Ura Dora, Red Five — already handled)
  for (const yaku of yakus) {
    if (
      yaku === DORA_YAKU ||
      yaku === URA_DORA_YAKU ||
      yaku === RED_FIVE_YAKU
    ) {
      continue;
    }
    results.push({ yakuId: yaku, count: 1 });
  }

  return results;
}

import { getLeagueApiCache } from "~/services/leagueApiCache.server";

// ---------- In-memory cache ----------
function getCached(key: string): unknown {
  return getLeagueApiCache<unknown>("yaku-map").get(key);
}

function setCache(key: string, data: unknown): void {
  getLeagueApiCache<unknown>("yaku-map").set(key, data);
}

/**
 * GET /api/yaku-map
 *
 * Query params:
 *   leagueIds   – comma-separated league ObjectId strings (required)
 *   entityType  – "player" or "team"
 *   entityIds   – comma-separated ObjectId strings (optional)
 *   startDate   – ISO date string (optional)
 *   endDate     – ISO date string (optional)
 *
 * Returns { columns: Column[], yakuCounts: Record<yakuId, Record<columnId, count>>, totalRounds: Record<columnId, number> }
 */
export async function loader({ request }: Route.LoaderArgs) {
  try {
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("forceRefresh") === "true";
    // Build cache key without forceRefresh param
    const keyParams = new URLSearchParams(url.search);
    keyParams.delete("forceRefresh");
    const cacheKey = `yaku-map:${keyParams.toString()}`;
    if (!forceRefresh) {
      const cached = getCached(cacheKey);
      if (cached) {
        return Response.json(cached);
      }
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

    // Resolve entities
    let resolvedPlayerIds: string[] = [];
    const teamMemberMap = new Map<string, string[]>();
    const useTeamMode = entityType === "team";
    let effectiveTeamIds: string[] = [];

    if (useTeamMode) {
      effectiveTeamIds = entityIds.length > 0 ? entityIds : [];
      if (effectiveTeamIds.length === 0) {
        const allTeams = await Team.find({
          leagueId: {
            $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)),
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
        .select("_id displayName roster")
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
        // Individual (non-team) leagues have no teams — include everyone who
        // has actually played games so their stats are not dropped.
        const gamePlayerRows = await Game.aggregate([
          {
            $match: {
              league: {
                $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)),
              },
            },
          },
          { $unwind: "$results" },
          { $group: { _id: null, userIds: { $addToSet: "$results.userId" } } },
        ]);
        for (const uid of gamePlayerRows[0]?.userIds ?? []) {
          resolvedPlayerIds.push(uid.toString());
        }
        resolvedPlayerIds = [...new Set(resolvedPlayerIds)];
      }
    }

    // Build game match filter
    const matchFilter: {
      league: { $in: mongoose.Types.ObjectId[] };
      "results.userId": { $in: mongoose.Types.ObjectId[] };
      startTime?: { $gte?: Date; $lte?: Date };
    } = {
      league: { $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)) },
      "results.userId": {
        $in: resolvedPlayerIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    };
    if (startDate) {
      matchFilter.startTime = {
        ...(matchFilter.startTime ?? {}),
        $gte: new Date(startDate),
      };
    }
    if (endDate) {
      matchFilter.startTime = {
        ...(matchFilter.startTime ?? {}),
        $lte: new Date(endDate),
      };
    }

    // Fetch game IDs
    const games = await Game.find(matchFilter).select("gameId").lean<Game[]>();

    if (games.length === 0) {
      const result = {
        columns: [],
        yakuCounts: {},
        totalRounds: {},
        totalGames: {},
      };
      setCache(cacheKey, result);
      return Response.json(result);
    }

    const gameIdSet = games.map((g) => g.gameId as string).filter(Boolean);

    // Fetch GameRecords
    const gameRecords = await GameRecord.find({
      gameId: { $in: gameIdSet },
    })
      .select("byUserData.userDbId byUserData.teamDbId byUserData.roundEvents")
      .lean<GameRecord[]>();

    // Build columns & aggregate yakus
    // yakuCounts: { [yakuId]: { [columnId]: count } }
    // totalRounds: { [columnId]: totalWinningRounds }
    // totalGames: { [columnId]: totalGamesPlayed }
    const yakuCounts: Record<number, Record<string, number>> = {};
    const totalRounds: Record<string, number> = {};
    const totalGames: Record<string, number> = {};

    // We need column info
    type ColumnInfo = {
      id: string;
      name: string;
      teamName?: string;
      avatarUrl?: string;
    };
    const columnsMap = new Map<string, ColumnInfo>();

    if (useTeamMode) {
      // Columns are teams
      const teamsData = await Team.find({
        _id: {
          $in: effectiveTeamIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
        .select("_id displayName pictures")
        .lean<Team[]>();
      for (const team of teamsData) {
        columnsMap.set(team._id.toString(), {
          id: team._id.toString(),
          name: team.displayName,
          avatarUrl: team.pictures?.croppedPicture ?? undefined,
        });
      }

      // Build reverse map: playerId -> teamId
      const playerToTeam = new Map<string, string>();
      for (const [teamId, memberIds] of teamMemberMap) {
        for (const memberId of memberIds) {
          playerToTeam.set(memberId, teamId);
        }
      }

      for (const rec of gameRecords) {
        // Track games played per team
        const teamsInGame = new Set<string>();
        for (const userData of rec.byUserData ?? []) {
          const playerId = userData.userDbId?.toString();
          const teamId =
            playerToTeam.get(playerId ?? "") ?? userData.teamDbId?.toString();
          if (teamId && columnsMap.has(teamId)) {
            teamsInGame.add(teamId);
          }

          if (!teamId || !columnsMap.has(teamId)) {
            continue;
          }

          for (const round of userData.roundEvents ?? []) {
            if (!round.isWinner) {
              continue;
            }
            totalRounds[teamId] = (totalRounds[teamId] ?? 0) + 1;
            for (const { yakuId, count } of getYakuCounts(round)) {
              if (!yakuCounts[yakuId]) {
                yakuCounts[yakuId] = {};
              }
              yakuCounts[yakuId][teamId] =
                (yakuCounts[yakuId][teamId] ?? 0) + count;
            }
          }
        }
        for (const teamId of teamsInGame) {
          totalGames[teamId] = (totalGames[teamId] ?? 0) + 1;
        }
      }
    } else {
      // Columns are players
      const usersData = await User.find({
        _id: {
          $in: resolvedPlayerIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
        .select("_id name discordIdentity avatarUrl")
        .lean<User[]>();

      // Build player -> team name map
      const allTeamsInLeagues = await Team.find({
        leagueId: {
          $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
        .select("_id displayName roster")
        .lean<Team[]>();
      const playerTeamNameMap = new Map<string, string>();
      for (const team of allTeamsInLeagues) {
        for (const memberId of team.roster.members ?? []) {
          playerTeamNameMap.set(memberId.toString(), team.displayName);
        }
        for (const memberId of team.roster.substitutes ?? []) {
          playerTeamNameMap.set(memberId.toString(), team.displayName);
        }
      }

      for (const user of usersData) {
        const uid = user._id.toString();
        columnsMap.set(uid, {
          id: uid,
          name: user.discordIdentity?.displayName || user.name,
          teamName: playerTeamNameMap.get(uid) ?? "",
          avatarUrl: user.avatarUrl ?? undefined,
        });
      }

      for (const rec of gameRecords) {
        // Track games played per player
        const playersInGame = new Set<string>();
        for (const userData of rec.byUserData ?? []) {
          const playerId = userData.userDbId?.toString();
          if (playerId && columnsMap.has(playerId)) {
            playersInGame.add(playerId);
          }
          if (!playerId || !columnsMap.has(playerId)) {
            continue;
          }

          for (const round of userData.roundEvents ?? []) {
            if (!round.isWinner) {
              continue;
            }
            totalRounds[playerId] = (totalRounds[playerId] ?? 0) + 1;
            for (const { yakuId, count } of getYakuCounts(round)) {
              if (!yakuCounts[yakuId]) {
                yakuCounts[yakuId] = {};
              }
              yakuCounts[yakuId][playerId] =
                (yakuCounts[yakuId][playerId] ?? 0) + count;
            }
          }
        }
        for (const playerId of playersInGame) {
          totalGames[playerId] = (totalGames[playerId] ?? 0) + 1;
        }
      }
    }

    // Easter egg: arrcival from Bordeaux gets +1 Hand of Man
    const EASTER_EGG_PLAYER = "6985483f550ff3312d08f0cc";
    const EASTER_EGG_LEAGUE = "69854a02e1db9e44fc2fcea7";
    const HAND_OF_MAN = 59;
    if (
      leagueIds.includes(EASTER_EGG_LEAGUE) &&
      columnsMap.has(EASTER_EGG_PLAYER)
    ) {
      if (!yakuCounts[HAND_OF_MAN]) {
        yakuCounts[HAND_OF_MAN] = {};
      }
      yakuCounts[HAND_OF_MAN][EASTER_EGG_PLAYER] =
        (yakuCounts[HAND_OF_MAN][EASTER_EGG_PLAYER] ?? 0) + 1;
    }

    // Build columns array sorted by team name then player name
    const columns = [...columnsMap.values()].sort((a, b) => {
      const teamCmp = (a.teamName ?? "").localeCompare(b.teamName ?? "");
      if (teamCmp !== 0) {
        return teamCmp;
      }
      return a.name.localeCompare(b.name);
    });

    const result = { columns, yakuCounts, totalRounds, totalGames };
    setCache(cacheKey, result);
    return Response.json(result);
  } catch (err) {
    console.error("yaku-map loader error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
