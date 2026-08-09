import mongoose from "mongoose";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { LiveGameModel, type LiveGame } from "~/db/LiveGame";
import { UserModel, type User } from "~/db/User";
import { TeamModel, type Team } from "~/db/Team";
import { getLeagueUserPictureMapForLeagues } from "~/services/leagueUserPictures.server";
import type { PicturePair } from "~/types/pictures";
import { isGameEnabled } from "~/game/feature-gate";

/**
 * GET /api/ongoing-games?leagueIds=a,b,c
 *
 * Returns in-progress games projected into the DB by the league poll loop
 * (`syncLiveGames`). DB-only: never touches the game platform. The entry shape
 * mirrors `/api/games` (finished games) plus `status:"ongoing"`, `endTime:null`,
 * `watchId`, `matchId`, and per-player `seat` — so the Games tab can render an
 * "Ongoing" section with the same card. Score/place are absent (game in play).
 */
export async function loader({ request }: { request: Request }) {
  const liveSpectatingEnabled = isGameEnabled();
  const url = new URL(request.url);
  const leagueIdsParam = url.searchParams.get("leagueIds");
  if (!leagueIdsParam) {
    return Response.json({ error: "leagueIds is required" }, { status: 400 });
  }
  const leagueIds = leagueIdsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (leagueIds.length === 0) {
    return Response.json({ games: [], liveSpectatingEnabled });
  }

  try {
    await connectToDatabase();
    const leagueObjectIds = leagueIds.map(
      (id) => new mongoose.Types.ObjectId(id)
    );

    const liveGames = await LiveGameModel.find({
      league: { $in: leagueObjectIds },
    })
      .sort({ startTime: -1, lastSeenAt: -1 })
      .lean<LiveGame[]>();

    if (liveGames.length === 0) {
      return Response.json({ games: [], liveSpectatingEnabled });
    }

    // Resolve player identities at read time (team + logo from `userId`),
    // exactly like `/api/games` does for finished games.
    const userIds = new Set<string>();
    for (const g of liveGames) {
      for (const p of g.players ?? []) {
        if (p.userId) {
          userIds.add(p.userId.toString());
        }
      }
    }

    const usersData = await UserModel.find({
      _id: { $in: [...userIds].map((id) => new mongoose.Types.ObjectId(id)) },
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

    const teams = await TeamModel.find({ leagueId: { $in: leagueObjectIds } })
      .select("_id displayName roster pictures")
      .lean<Team[]>();
    const playerTeamMap = new Map<string, string>();
    const playerTeamPictureMap = new Map<string, PicturePair | null>();
    for (const team of teams) {
      const roster = team.roster ?? { members: [], substitutes: [] };
      for (const memberId of [
        ...(roster.members ?? []),
        ...(roster.substitutes ?? []),
      ]) {
        playerTeamMap.set(memberId.toString(), team.displayName);
        playerTeamPictureMap.set(memberId.toString(), team.pictures ?? null);
      }
    }

    const leagueUserPictures =
      await getLeagueUserPictureMapForLeagues(leagueIds);

    const games = liveGames.map((g) => {
      const players = (g.players ?? [])
        .slice()
        .sort((a, b) => a.seat - b.seat)
        .map((p) => {
          const pid = p.userId ? p.userId.toString() : null;
          const user = pid ? userMap.get(pid) : undefined;
          return {
            userId: pid,
            seat: p.seat,
            name: user?.name ?? p.nickname,
            nickname: p.nickname,
            avatarUrl: user?.avatarUrl ?? null,
            leaguePicture: pid ? (leagueUserPictures.get(pid) ?? null) : null,
            teamName: pid ? (playerTeamMap.get(pid) ?? null) : null,
            teamPicture: pid ? (playerTeamPictureMap.get(pid) ?? null) : null,
          };
        });

      return {
        gameId: g.gameId,
        platform: g.platform ?? null,
        status: "ongoing" as const,
        startTime: g.startTime ?? null,
        endTime: null,
        watchId: g.watchId ?? null,
        matchId: g.relayMatchId ?? null,
        players,
      };
    });

    return Response.json({ games, liveSpectatingEnabled });
  } catch (error) {
    console.error("Error fetching ongoing games:", error);
    return Response.json(
      { error: "Failed to fetch ongoing games" },
      { status: 500 }
    );
  }
}
