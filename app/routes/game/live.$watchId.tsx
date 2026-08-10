import { redirect } from "react-router";
import { isGameEnabled } from "~/game/feature-gate";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { LiveGameModel } from "~/db/LiveGame";
import { RelayError, startRelay } from "~/services/gameServer.server";
import type { Route } from "./+types/live.$watchId";

/**
 * `GET /live/:watchId` — one-click live spectate for an ongoing game.
 *
 * Starts (or reuses) the game-server relay for `watchId` and redirects to the
 * canonical `/spectate/:matchId`, which shows a "connecting" state until the
 * relay's first events arrive — so a viewer who arrives before the relay is
 * ready simply waits on that screen. A shareable GET link (Discord, etc.):
 * `watchId` is the per-game spectator id, never the lobby admin password.
 */
export async function loader({ params }: Route.LoaderArgs) {
  if (!isGameEnabled()) {
    throw new Response("Live viewing is disabled.", { status: 404 });
  }
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
  throw redirect(`/spectate/${matchId}`);
}
