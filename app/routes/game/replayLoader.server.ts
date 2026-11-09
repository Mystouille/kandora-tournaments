import { redirect } from "react-router";

import type { GameEvent } from "~/game/protocol/messages";
import { resolveReplayViewerData } from "~/services/replayViewerData.server";
import { getAuthenticatedUser } from "~/utils/jwt.server";
import { basePath } from "~/utils/basePath";
import {
  authSignInPath,
  localReturnPathFromRequest,
} from "~/utils/gameReturnPath";
import type { Route } from "./+types/replay";

export async function loader({ params, request }: Route.LoaderArgs) {
  const gameId = params.gameId ?? "";
  if (!gameId) {
    throw new Response("Missing replay id.", { status: 404 });
  }
  const url = new URL(request.url);
  const majsoulSuffix = /_a\d+$/.exec(gameId);
  if (majsoulSuffix) {
    // The encoded sharer ID is not a replay seat. Preserve explicit seat parameters.
    const cleanId = gameId.slice(0, majsoulSuffix.index);
    const qs = url.searchParams.toString();
    throw redirect(`/watch/replay/${cleanId}${qs ? `?${qs}` : ""}`);
  }
  const rcSuffix = /@([0-3])$/.exec(gameId);
  const rcWind = rcSuffix ? Number(rcSuffix[1]) : null;
  const cleanGameId = rcSuffix ? gameId.slice(0, rcSuffix.index) : gameId;

  const redirectToCanonicalRcUrl = (events: GameEvent[]): never => {
    const search = new URLSearchParams(url.searchParams);
    if (rcWind !== null && !search.has("seat")) {
      let seat = rcWind;
      const handStart = events.find((event) => event.type === "hand_start");
      if (handStart && "dealer" in handStart) {
        seat = (handStart.dealer + rcWind) % 4;
      }
      search.set("seat", String(seat));
    }
    const qs = search.toString();
    throw redirect(`/watch/replay/${cleanGameId}${qs ? `?${qs}` : ""}`);
  };

  let currentUserId: string | null = null;
  let currentUserName: string | null = null;
  const payload = await getAuthenticatedUser(request);
  if (payload?.sub) {
    currentUserId = String(payload.sub);
    currentUserName =
      typeof payload.username === "string" ? payload.username : null;
  }
  const resolved = await resolveReplayViewerData({
    gameId: cleanGameId,
    reviewShortId: url.searchParams.get("review"),
    userId: currentUserId,
  });
  if (resolved.status === "found") {
    if (resolved.canonicalGameId !== cleanGameId) {
      const qs = url.searchParams.toString();
      throw redirect(
        `/watch/replay/${encodeURIComponent(resolved.canonicalGameId)}${qs ? `?${qs}` : ""}`
      );
    }
    if (rcWind !== null) {
      redirectToCanonicalRcUrl(resolved.log.events);
    }
    return {
      log: resolved.log,
      review: resolved.review,
      currentUserId,
      currentUserName,
      seatEnrichment: resolved.seatEnrichment,
    };
  }
  if (resolved.status === "authentication_required") {
    throw redirect(
      authSignInPath(localReturnPathFromRequest(request, basePath))
    );
  }
  throw new Response(
    "Replay not yet available; it will appear after the next hydration cycle.",
    { status: 404 }
  );
}
