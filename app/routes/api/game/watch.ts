import { isGameEnabled } from "~/game/feature-gate";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { LiveGameModel } from "~/db/LiveGame";
import { RelayError, startRelay } from "~/services/gameServer.server";

/**
 * POST /api/game/watch  (form field `watchId`)
 *
 * Starts or reuses a live spectator relay as a preflight for
 * `/watch/live/:watchId`. The internal `matchId` is returned for diagnostics;
 * it is not part of the public viewer URL.
 *
 * Guarded: only games we currently track as live (a `LiveGame` row) can be
 * relayed, so arbitrary watch-ids can't spin up upstream connections. The relay
 * itself is de-duplicated by the game-server, so repeated clicks are cheap.
 */
export async function action({ request }: { request: Request }) {
  if (!isGameEnabled()) {
    return Response.json({ ok: false, error: "game_disabled" }, { status: 404 });
  }
  const form = await request.formData();
  const watchId = String(form.get("watchId") ?? "").trim();
  if (!watchId) {
    return Response.json(
      { ok: false, error: "missing_watchId" },
      { status: 400 }
    );
  }

  await connectToDatabase();
  const live = await LiveGameModel.findOne({
    $or: [{ watchId }, { gameId: watchId }],
  }).lean();
  if (!live) {
    return Response.json({ ok: false, error: "not_live" }, { status: 404 });
  }

  try {
    const { matchId } = await startRelay(watchId);
    await LiveGameModel.updateOne(
      { _id: live._id },
      { $set: { relayMatchId: matchId } }
    ).exec();
    return Response.json({ ok: true, matchId });
  } catch (error) {
    console.error("Failed to start live relay:", error);
    return Response.json(
      {
        ok: false,
        error: error instanceof RelayError ? error.code : "relay_failed",
      },
      { status: 502 }
    );
  }
}
