import GameLobby, { type LobbyLoaderData } from "~/game/routes/lobby";
import { requireGameEnabled, getClientGameFlag } from "~/game/feature-gate";
import { listSelectablePresets } from "~/game/rules/presets";
import { GameVariantSchema } from "~/game/protocol/seat";
import { ReplayLogModel } from "~/core/models/game/ReplayLog";
import { getLobbyTenhouLiveGames } from "~/services/lobbyLiveGames.server";
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
  const [logs, tenhouLiveGames] = await Promise.all([
    ReplayLogModel.find(
      { source: "ingame" },
      {
        sourceGameId: 1,
        ruleSet: 1,
        ruleSetDetails: 1,
        mode: 1,
        startedAt: 1,
        endedAt: 1,
        seats: 1,
      }
    )
      .sort({ endedAt: -1 })
      .limit(RECENT_GAME_LOG_LIMIT)
      .lean()
      .exec(),
    getLobbyTenhouLiveGames(),
  ]);
  return {
    flag: getClientGameFlag(),
    presets: listSelectablePresets().map(
      ({ id, displayName, description }) => ({
        id,
        displayName,
        description,
      })
    ),
    tenhouLiveGames,
    gameLogs: logs.map((log) => ({
      gameId: log.sourceGameId,
      ruleSet: log.ruleSet,
      ...GameVariantSchema.parse({
        playerCount: log.ruleSetDetails?.playerCount,
        sanmaType: log.ruleSetDetails?.sanmaType,
      }),
      mode: log.mode,
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
