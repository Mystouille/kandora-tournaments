import mongoose from "mongoose";
import { type League, Platform } from "~/core/models/tournament/League";
import { LiveGameModel } from "~/core/models/tournament/LiveGame";
import { UserModel } from "~/core/models/shared/User";
import { OngoingGameStatus } from "~/core/types/ongoing-game-status";
import { TenhouService } from "~/api/tenhou/TenhouService.server";
import { type ILeagueTournamentConnector } from "./connectors/ILeagueTournamentConnector.server";

/**
 * DB projection of live (in-progress) games. Runs inside the league poll loop
 * so the UI reads ongoing games from the DB only (never the platform live).
 *
 * For Tenhou we call `cmd_get_wg.cgi` directly (authoritative watch-id + seat
 * order); for Majsoul / Riichi City we use the connector's `getOngoingGames`
 * (which already carry real game ids). Player identities are resolved to a
 * Kandora `userId` here at poll time — team + logo are resolved at read time
 * from `userId`, mirroring finished games.
 */
interface NormalizedLiveGame {
  gameId: string;
  watchId?: string;
  tableId?: string;
  status: OngoingGameStatus;
  startTime?: Date;
  players: Array<{ seat: number; nickname: string; accountId?: string }>;
}

const DB_PLATFORM: Partial<Record<Platform, "majsoul" | "tenhou" | "riichiCity">> =
  {
    [Platform.MAJSOUL]: "majsoul",
    [Platform.TENHOU]: "tenhou",
    [Platform.RIICHICITY]: "riichiCity",
  };

const PLATFORM_ID_FIELD: Partial<Record<Platform, string>> = {
  [Platform.MAJSOUL]: "majsoulIdentity.userId",
  [Platform.RIICHICITY]: "riichiCityIdentity.id",
  [Platform.TENHOU]: "tenhouIdentity.name",
};

interface UserIdentities {
  _id: mongoose.Types.ObjectId;
  majsoulIdentity?: { userId?: string };
  riichiCityIdentity?: { id?: string };
  tenhouIdentity?: { name?: string };
}

function accountIdOf(platform: Platform, user: UserIdentities): string | undefined {
  switch (platform) {
    case Platform.MAJSOUL:
      return user.majsoulIdentity?.userId;
    case Platform.RIICHICITY:
      return user.riichiCityIdentity?.id;
    case Platform.TENHOU:
      return user.tenhouIdentity?.name;
    default:
      return undefined;
  }
}

async function gatherLiveGames(
  platform: Platform,
  tournamentId: string | number,
  connector: ILeagueTournamentConnector
): Promise<NormalizedLiveGame[]> {
  if (platform === Platform.TENHOU) {
    let watchGames;
    try {
      watchGames = await TenhouService.instance.fetchLobbyWatchGames(
        String(tournamentId)
      );
    } catch {
      return [];
    }
    return watchGames.map((g) => ({
      gameId: g.watchId,
      watchId: g.watchId,
      status: OngoingGameStatus.Playing,
      players: g.players.map((name, seat) => ({
        seat,
        nickname: name,
        accountId: name,
      })),
    }));
  }

  if (typeof connector.getOngoingGames !== "function") {
    return [];
  }
  const ongoing = (await connector.getOngoingGames(tournamentId)) ?? [];
  return ongoing.map((g) => ({
    gameId: g.gameId,
    tableId: g.tableId != null ? String(g.tableId) : undefined,
    status: g.status,
    startTime: g.startTime,
    players: g.players.map((p, i) => ({
      seat: p.seat ?? i,
      nickname: p.nickname ?? String(p.accountId),
      accountId: String(p.accountId),
    })),
  }));
}

async function buildAccountUserIdMap(
  platform: Platform,
  accountIds: string[]
): Promise<Map<string, mongoose.Types.ObjectId>> {
  const field = PLATFORM_ID_FIELD[platform];
  const map = new Map<string, mongoose.Types.ObjectId>();
  if (!field || accountIds.length === 0) {
    return map;
  }
  const users = await UserModel.find({ [field]: { $in: accountIds } })
    .select({
      _id: 1,
      majsoulIdentity: 1,
      riichiCityIdentity: 1,
      tenhouIdentity: 1,
    })
    .lean<UserIdentities[]>()
    .exec();
  for (const user of users) {
    const accId = accountIdOf(platform, user);
    if (accId) {
      map.set(accId, user._id);
    }
  }
  return map;
}

/**
 * Refreshes the `LiveGame` projection for a league: upserts a row per ongoing
 * game and removes rows for games that are no longer live. Best-effort; the
 * caller wraps this so a platform hiccup never breaks the poll cycle.
 */
export async function syncLiveGames(
  league: League,
  connector: ILeagueTournamentConnector
): Promise<void> {
  const platform = league.platformConfig.platformName as Platform;
  const dbPlatform = DB_PLATFORM[platform];
  const tournamentId = league.platformConfig.tournamentId;
  if (!dbPlatform || !tournamentId) {
    return;
  }

  const games = await gatherLiveGames(platform, tournamentId, connector);

  const accountIds = [
    ...new Set(
      games.flatMap((g) =>
        g.players
          .map((p) => p.accountId)
          .filter((id): id is string => Boolean(id))
      )
    ),
  ];
  const accountToUser = await buildAccountUserIdMap(platform, accountIds);

  const now = new Date();
  const seenGameIds: string[] = [];
  for (const g of games) {
    seenGameIds.push(g.gameId);
    await LiveGameModel.updateOne(
      { league: league._id, gameId: g.gameId },
      {
        $set: {
          platform: dbPlatform,
          watchId: g.watchId,
          tableId: g.tableId,
          status: g.status,
          startTime: g.startTime,
          lastSeenAt: now,
          players: g.players.map((p) => ({
            seat: p.seat,
            nickname: p.nickname,
            accountId: p.accountId,
            userId: p.accountId ? accountToUser.get(p.accountId) : undefined,
          })),
        },
      },
      { upsert: true }
    ).exec();
  }

  // Drop games that are no longer live for this league.
  await LiveGameModel.deleteMany({
    league: league._id,
    ...(seenGameIds.length > 0 ? { gameId: { $nin: seenGameIds } } : {}),
  }).exec();
}
