import GameLobby, { type LobbyLoaderData } from "~/game/routes/lobby";
import { requireGameEnabled, getClientGameFlag } from "~/game/feature-gate";
import { listSelectablePresets } from "~/game/rules/presets";
import { ReplayLogModel } from "~/core/models/game/ReplayLog";
import {
  LiveGameModel,
  type LiveGame,
} from "~/core/models/tournament/LiveGame";
import {
  LeagueModel,
  ongoingLeagueFilter,
  Platform,
} from "~/core/models/tournament/League";
import { OngoingGameStatus } from "~/core/types/ongoing-game-status";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { requireGameUser } from "~/utils/gameAuth.server";

const RECENT_GAME_LOG_LIMIT = 100;

export async function loader({
  request,
}: {
  request: Request;
}): Promise<LobbyLoaderData> {
  requireGameEnabled();
  await requireGameUser(request);
  await connectToDatabase();
  const [logs, ongoingTenhouLeagues] = await Promise.all([
    ReplayLogModel.find(
      { source: "ingame" },
      {
        sourceGameId: 1,
        ruleSet: 1,
        startedAt: 1,
        endedAt: 1,
        seats: 1,
      }
    )
      .sort({ endedAt: -1 })
      .limit(RECENT_GAME_LOG_LIMIT)
      .lean()
      .exec(),
    LeagueModel.find(
      {
        ...ongoingLeagueFilter(),
        isIgnored: false,
        "platformConfig.platformName": Platform.TENHOU,
      },
      { name: 1 }
    )
      .lean()
      .exec(),
  ]);
  const tenhouLiveGames =
    ongoingTenhouLeagues.length === 0
      ? []
      : await LiveGameModel.find({
          league: { $in: ongoingTenhouLeagues.map((league) => league._id) },
          platform: "tenhou",
          status: OngoingGameStatus.Playing,
          watchId: { $exists: true, $ne: "" },
        })
          .sort({ startTime: -1, lastSeenAt: -1 })
          .lean<LiveGame[]>()
          .exec();
  const leagueNameById = new Map(
    ongoingTenhouLeagues.map((league) => [league._id.toString(), league.name])
  );
  return {
    flag: getClientGameFlag(),
    presets: listSelectablePresets().map(
      ({ id, displayName, description }) => ({
        id,
        displayName,
        description,
      })
    ),
    tenhouLiveGames: tenhouLiveGames.flatMap((game) => {
      const watchId = game.watchId?.trim();
      const leagueName = leagueNameById.get(game.league.toString());
      if (!watchId || !leagueName) {
        return [];
      }
      return [
        {
          watchId,
          leagueName,
          startTime: game.startTime?.getTime() ?? null,
          players: [...(game.players ?? [])]
            .sort((left, right) => left.seat - right.seat)
            .map((player) => ({
              seat: player.seat,
              displayName: player.nickname,
            })),
        },
      ];
    }),
    gameLogs: logs.map((log) => ({
      gameId: log.sourceGameId,
      ruleSet: log.ruleSet,
      startedAt: log.startedAt,
      endedAt: log.endedAt,
      seats: log.seats.map(
        (seat: LobbyLoaderData["gameLogs"][number]["seats"][number]) => ({
          seat: seat.seat,
          displayName: seat.displayName,
          finalScore: seat.finalScore,
          place: seat.place,
        })
      ),
    })),
  };
}

export default GameLobby;
