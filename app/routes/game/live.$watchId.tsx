import { getClientGameFlag, isGameEnabled } from "~/game/feature-gate";
import GameSpectateRoute from "~/game/routes/spectate";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { LiveGameModel } from "~/core/models/tournament/LiveGame";
import { RelayError, startRelay } from "~/services/gameServer.server";
import type { Route } from "./+types/live.$watchId";
import { requireGameUser } from "~/utils/gameAuth.server";

/**
 * `GET /watch/live/:watchId` — watch an ongoing game.
 *
 * Starts or reuses the game-server relay, then supplies its internal match id
 * to the shared spectator component. The public URL stays keyed by `watchId`,
 * which is safe to share; the lobby id remains private.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  if (!isGameEnabled()) {
    throw new Response("Live viewing is disabled.", { status: 404 });
  }
  await requireGameUser(request);
  const watchId = (params.watchId ?? "").trim();
  if (!watchId) {
    throw new Response("Missing watch id.", { status: 404 });
  }

  await connectToDatabase();
  // Only relay games we already track as live, so arbitrary ids can't spin up
  // upstream connections.
  const live = await LiveGameModel.findOne({
    $or: [{ watchId }, { gameId: watchId }],
  }).lean();
  if (!live) {
    throw new Response("This game is not currently live.", { status: 404 });
  }

  let matchId: string;
  try {
    ({ matchId } = await startRelay(watchId));
  } catch (error) {
    console.error("Failed to start live relay:", error);
    const code = error instanceof RelayError ? error.code : "relay_failed";
    throw new Response(`Live viewing unavailable (${code}).`, { status: 502 });
  }
  await LiveGameModel.updateOne(
    { _id: live._id },
    { $set: { relayMatchId: matchId } }
  ).exec();
  return {
    matchId,
    flag: getClientGameFlag(),
  };
}

export default GameSpectateRoute;
