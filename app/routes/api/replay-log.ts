import type { DirectReplayLogApiResponse } from "~/types/myReplaysApi";
import { resolveReplayViewerData } from "~/services/replayViewerData.server";
import {
  getAuthenticatedPrincipal,
  type AuthenticatedPrincipal,
} from "~/utils/requestAuth.server";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

// Wildcard CORS makes anonymous GETs available cross-origin. Cookie identity is
// meaningful only for same-origin GETs; native authenticated requests use the
// form-encoded POST token below.

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function replayIdentity(
  gameIdValue: FormDataEntryValue | string | null,
  reviewShortIdValue: FormDataEntryValue | string | null
): { gameId: string; reviewShortId: string | null } | null {
  if (typeof gameIdValue !== "string") {
    return null;
  }
  const gameId = gameIdValue.trim();
  if (gameId === "" || gameId.length > 256) {
    return null;
  }
  if (
    reviewShortIdValue !== null &&
    (typeof reviewShortIdValue !== "string" ||
      reviewShortIdValue.trim() === "" ||
      reviewShortIdValue.length > 128)
  ) {
    return null;
  }
  return {
    gameId,
    reviewShortId: reviewShortIdValue?.trim() ?? null,
  };
}

function responseBody(
  result: Extract<
    Awaited<ReturnType<typeof resolveReplayViewerData>>,
    { status: "found" }
  >
): DirectReplayLogApiResponse {
  return {
    canonicalGameId: result.canonicalGameId,
    resolvedSeat: result.resolvedSeat,
    log: result.log,
    seatEnrichment: result.seatEnrichment.map((entry) =>
      entry === null
        ? null
        : {
            teamName: entry.teamName ?? null,
            teamLogoUrl: entry.teamLogoUrl ?? null,
          }
    ),
    review:
      result.review === null
        ? null
        : {
            shortId: result.review.shortId,
            seat: result.review.seat,
            targetName: result.review.target?.name ?? null,
            edits: result.review.edits.map((edit) => ({
              eventIndex: edit.eventIndex,
              authorName: edit.authorName,
              colorIndex: edit.colorIndex,
              text: edit.text,
              drawingBase64: edit.drawingBase64,
              updatedAt: edit.updatedAt,
            })),
          },
  };
}

async function replayResponse(
  principal: AuthenticatedPrincipal | null,
  identity: ReturnType<typeof replayIdentity>
): Promise<Response> {
  if (identity === null) {
    return json({ error: "invalid_replay_identity" }, 400);
  }
  try {
    const result = await resolveReplayViewerData({
      gameId: identity.gameId,
      reviewShortId: identity.reviewShortId,
      userId: principal?.userId ?? null,
    });
    if (result.status === "authentication_required") {
      return json({ error: "authentication_required" }, 401);
    }
    if (result.status === "not_found") {
      return json({ error: "replay_not_found" }, 404);
    }
    return json(responseBody(result));
  } catch (error) {
    console.error("Failed to load direct replay:", error);
    return json({ error: "replay_unavailable" }, 500);
  }
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  return replayResponse(
    await getAuthenticatedPrincipal(request, { transport: "web-cookie" }),
    replayIdentity(
      url.searchParams.get("gameId"),
      url.searchParams.get("reviewShortId")
    )
  );
}

export async function action({ request }: { request: Request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const token = form.get("token");
  let principal: AuthenticatedPrincipal | null = null;
  if (typeof token === "string" && token !== "") {
    principal = await getAuthenticatedPrincipal(request, {
      transport: "game-token",
      token,
    });
    if (principal === null) {
      return json({ error: "invalid_or_expired_session" }, 401);
    }
  }
  return replayResponse(
    principal,
    replayIdentity(form.get("gameId"), form.get("reviewShortId"))
  );
}
