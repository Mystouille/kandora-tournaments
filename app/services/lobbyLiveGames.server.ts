import {
  LeagueModel,
  ongoingLeagueFilter,
  Platform,
} from "~/core/models/tournament/League";
import {
  LiveGameModel,
  type LiveGame,
} from "~/core/models/tournament/LiveGame";
import { OngoingGameStatus } from "~/core/types/ongoing-game-status";

/** Reads the monitored-game projection using the caller's database connection. */
export async function getLobbyTenhouLiveGames() {
  const leagues = await LeagueModel.find(
    {
      ...ongoingLeagueFilter(),
      isIgnored: false,
      "platformConfig.platformName": Platform.TENHOU,
    },
    { name: 1 }
  )
    .lean()
    .exec();
  if (leagues.length === 0) {
    return [];
  }

  const games = await LiveGameModel.find({
    league: { $in: leagues.map((league) => league._id) },
    platform: "tenhou",
    status: OngoingGameStatus.Playing,
    watchId: { $exists: true, $ne: "" },
  })
    .sort({ startTime: -1, lastSeenAt: -1 })
    .lean<LiveGame[]>()
    .exec();
  const leagueNameById = new Map(
    leagues.map((league) => [league._id.toString(), league.name])
  );
  return games.flatMap((game) => {
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
  });
}
