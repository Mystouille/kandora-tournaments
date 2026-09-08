import { isGameEnabled } from "~/game/feature-gate";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { LiveGameModel } from "~/core/models/tournament/LiveGame";
import { RelayError, startRelay } from "~/services/gameServer.server";
import { requireGameApiAccess } from "~/utils/gameAuth.server";
import { verifyGameToken } from "~/utils/jwt.server";

const MOBILE_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

function json(body: unknown, status = 200, mobile = false): Response {
  return Response.json(body, {
    status,
    headers: mobile ? MOBILE_CORS_HEADERS : undefined,
  });
}

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
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: MOBILE_CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  const mobile = (request.headers.get("content-type") ?? "").startsWith(
    "application/x-www-form-urlencoded"
  );
  if (!isGameEnabled()) {
    return json({ ok: false, error: "game_disabled" }, 404, mobile);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400, mobile);
  }
  if (mobile) {
    const token = form.get("token");
    if (typeof token !== "string" || (await verifyGameToken(token)) === null) {
      return json({ ok: false, error: "invalid_or_expired_token" }, 401, true);
    }
  } else {
    const access = await requireGameApiAccess(request);
    if (!access.authorized) {
      return access.response;
    }
  }
  const watchId = String(form.get("watchId") ?? "").trim();
  if (!watchId) {
    return json({ ok: false, error: "missing_watchId" }, 400, mobile);
  }

  await connectToDatabase();
  const live = await LiveGameModel.findOne({
    $or: [{ watchId }, { gameId: watchId }],
  }).lean();
  if (!live) {
    return json({ ok: false, error: "not_live" }, 404, mobile);
  }

  try {
    const { matchId } = await startRelay(
      watchId,
      live.canonicalGameId ?? undefined
    );
    await LiveGameModel.updateOne(
      { _id: live._id },
      { $set: { relayMatchId: matchId } }
    ).exec();
    return json({ ok: true, matchId }, 200, mobile);
  } catch (error) {
    console.error("Failed to start live relay:", error);
    return json(
      {
        ok: false,
        error: error instanceof RelayError ? error.code : "relay_failed",
      },
      502,
      mobile
    );
  }
}
