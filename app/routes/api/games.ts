import { createHash } from "node:crypto";
import { connectToDatabase } from "../../utils/dbConnection.server";
import { getLeagueUserPictureMapForLeagues } from "../../services/leagueUserPictures.server";
import type { Route } from "./+types/games";
import mongoose from "mongoose";
import { GameModel, type Game, type GameResult } from "../../db/Game";
import { LeagueModel } from "../../db/League";
import { TeamModel, type Team } from "../../db/Team";
import { UserModel, type User } from "../../db/User";
import {
  GameRecordModel,
  type GameRecord,
  type UserGameRecordData,
} from "../../db/GameRecord";

import { getLeagueApiCache } from "~/services/leagueApiCache.server";

// ---------- In-memory cache ----------
type GamesCacheEntry = { data: unknown; etag: string };

function getCached(key: string): GamesCacheEntry | null {
  return getLeagueApiCache<GamesCacheEntry>("games").get(key);
}

function setCache(key: string, data: unknown): string {
  const json = JSON.stringify(data);
  const etag = `"${createHash("md5").update(json).digest("hex")}"`;
  getLeagueApiCache<GamesCacheEntry>("games").set(key, { data, etag });
  return etag;
}

function jsonWithEtag(data: unknown, etag: string): Response {
  return Response.json(data, {
    headers: {
      "Cache-Control": "no-cache",
      ETag: etag,
    },
  });
}

/**
 * GET /api/games
 *
 * Query params:
 *   leagueIds   – comma-separated league ObjectId strings (required)
 *   entityType  – "player" or "team"
 *   entityIds   – comma-separated ObjectId strings (optional)
 *   startDate   – ISO date string (optional)
 *   endDate     – ISO date string (optional)
 *   skip        – number of games to skip (default 0)
 *   limit       – max games to return (default 100, max 100)
 *
 * Returns { games: GameEntry[], total: number }
 */
export async function loader({ request }: Route.LoaderArgs) {
  try {
    const url = new URL(request.url);
    const cacheKey = `games:${url.search}`;
    const clientEtag = request.headers.get("If-None-Match");
    const cached = getCached(cacheKey);
    if (cached) {
      if (clientEtag === cached.etag) {
        return new Response(null, {
          status: 304,
          headers: { ETag: cached.etag },
        });
      }
      return jsonWithEtag(cached.data, cached.etag);
    }

    const leagueIds =
      url.searchParams.get("leagueIds")?.split(",").filter(Boolean) ?? [];
    const entityType =
      (url.searchParams.get("entityType") as "player" | "team") ?? "team";
    const entityIds =
      url.searchParams.get("entityIds")?.split(",").filter(Boolean) ?? [];
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const skip = Math.max(
      0,
      parseInt(url.searchParams.get("skip") ?? "0", 10) || 0
    );
    const limit = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100)
    );

    if (leagueIds.length === 0) {
      return Response.json({ error: "leagueIds is required" }, { status: 400 });
    }

    await connectToDatabase();
    const Game = GameModel;
    const Team = TeamModel;
    const User = UserModel;
    const GameRecord = GameRecordModel;

    // Resolve player IDs from teams or players
    let resolvedPlayerIds: string[] = [];
    const teamMemberMap = new Map<string, string[]>();
    let useTeamMode = entityType === "team";
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
        // No players selected – load all players in selected leagues via teams
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

    // Count total matching games
    const total = await Game.countDocuments(matchFilter);

    if (total === 0) {
      const result = { games: [], total: 0 };
      const etag = setCache(cacheKey, result);
      return jsonWithEtag(result, etag);
    }

    // Fetch games with pagination
    const games = await Game.find(matchFilter)
      .select("gameId startTime endTime results log platform")
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(limit)
      .lean<Game[]>();

    // Fetch GameRecords for delta points
    const gameIdSet = new Set(
      games.map((g) => g.gameId as string).filter(Boolean)
    );
    const gameRecords = await GameRecord.find({
      gameId: { $in: [...gameIdSet] },
    })
      .select(
        "gameId byUserData.userDbId byUserData.teamDbId byUserData.teamName byUserData.score byUserData.place byUserData.deltaPoints byUserData.nickname"
      )
      .lean<GameRecord[]>();

    // Map gameId -> GameRecord byUserData
    const recordMap = new Map<string, UserGameRecordData[]>();
    for (const rec of gameRecords) {
      recordMap.set(rec.gameId, rec.byUserData ?? []);
    }

    // Fetch all involved user details
    const allUserIds = new Set<string>();
    for (const game of games) {
      for (const r of game.results ?? []) {
        allUserIds.add(r.userId.toString());
      }
    }
    const usersData = await User.find({
      _id: {
        $in: [...allUserIds].map((id) => new mongoose.Types.ObjectId(id)),
      },
    })
      .select("_id name avatarUrl discordIdentity")
      .lean<User[]>();
    const userMap = new Map<
      string,
      { name: string; avatarUrl: string | null }
    >();
    for (const u of usersData) {
      userMap.set(u._id.toString(), {
        name: u.discordIdentity?.displayName ?? u.name,
        avatarUrl: u.avatarUrl ?? null,
      });
    }

    // Fetch team names for each player
    const allTeamsInLeagues = await Team.find({
      leagueId: {
        $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    })
      .select("_id displayName roster pictures")
      .lean<Team[]>();

    // Map userId -> teamName and track regular substitutes
    const playerTeamMap = new Map<string, string>();
    const playerTeamPictureMap = new Map<
      string,
      import("../../types/pictures").PicturePair | null
    >();
    const regularSubIdSet = new Set<string>();
    for (const team of allTeamsInLeagues) {
      for (const memberId of team.roster.members ?? []) {
        playerTeamMap.set(memberId.toString(), team.displayName);
        playerTeamPictureMap.set(memberId.toString(), team.pictures ?? null);
      }
      for (const memberId of team.roster.substitutes ?? []) {
        playerTeamMap.set(memberId.toString(), team.displayName);
        playerTeamPictureMap.set(memberId.toString(), team.pictures ?? null);
        regularSubIdSet.add(memberId.toString());
      }
    }

    // Collect official substitute IDs
    const leagues = await LeagueModel.find({
      _id: { $in: leagueIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select("officialSubstitutes")
      .lean();
    const officialSubIdSet = new Set<string>();
    for (const lg of leagues) {
      for (const id of (lg as any).officialSubstitutes ?? []) {
        officialSubIdSet.add(id.toString());
      }
    }

    const leagueUserPictures =
      await getLeagueUserPictureMapForLeagues(leagueIds);

    // Build response
    const result = {
      games: games.map((game) => {
        const gameId = game.gameId as string | undefined;
        const recordData = gameId ? recordMap.get(gameId) : undefined;

        // Build replay link
        let replayUrl: string | null = null;
        if (game.log) {
          replayUrl = game.log;
        } else if (gameId && game.platform === "majsoul") {
          replayUrl = `https://game.mahjongsoul.com/?paipu=${gameId}`;
        }

        // Build player entries from game results, enriched with GameRecord data
        const players = (game.results ?? []).map((r: GameResult) => {
          const pid = r.userId.toString();
          const user = userMap.get(pid);
          const teamName = playerTeamMap.get(pid) ?? null;

          // Try to find matching record data for delta
          let deltaPoints: number | null = null;
          let finalScore = r.score;
          if (recordData) {
            const rec = recordData.find(
              (rd) => rd.userDbId?.toString() === pid
            );
            if (rec) {
              deltaPoints = rec.deltaPoints ?? null;
              finalScore = rec.score ?? r.score;
            }
          }

          return {
            userId: pid,
            name: user?.name ?? "Unknown",
            avatarUrl: user?.avatarUrl ?? null,
            leaguePicture: leagueUserPictures.get(pid) ?? null,
            teamName,
            teamPicture: playerTeamPictureMap.get(pid) ?? null,
            score: finalScore,
            place: r.place,
            deltaPoints,
            isSub: regularSubIdSet.has(pid),
            isOfficialSub: officialSubIdSet.has(pid),
          };
        });

        // Sort by score descending
        players.sort((a, b) => b.score - a.score);

        return {
          gameId: gameId ?? game._id.toString(),
          platform: game.platform ?? null,
          startTime: game.startTime,
          endTime: game.endTime ?? null,
          replayUrl,
          players,
        };
      }),
      total,
    };

    const etag = setCache(cacheKey, result);
    return jsonWithEtag(result, etag);
  } catch (error) {
    console.error("Error fetching games:", error);
    return Response.json({ error: "Failed to fetch games" }, { status: 500 });
  }
}
