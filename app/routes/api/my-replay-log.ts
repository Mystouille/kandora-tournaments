import type { ReplaySource } from "~/game/replay/types";
import { getMyReplayLogApiResponse } from "~/services/myReplaysApi.server";
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

const REPLAY_SOURCES = new Set<ReplaySource>([
  "ingame",
  "majsoul",
  "tenhou",
  "riichicity",
]);

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function replayIdentity(
  sourceValue: FormDataEntryValue | string | null,
  sourceGameIdValue: FormDataEntryValue | string | null
): { source: ReplaySource; sourceGameId: string } | null {
  if (
    typeof sourceValue !== "string" ||
    !REPLAY_SOURCES.has(sourceValue as ReplaySource) ||
    typeof sourceGameIdValue !== "string" ||
    sourceGameIdValue.trim() === ""
  ) {
    return null;
  }
  return {
    source: sourceValue as ReplaySource,
    sourceGameId: sourceGameIdValue,
  };
}

async function replayLogResponse(
  principal: AuthenticatedPrincipal | null,
  identity: ReturnType<typeof replayIdentity>
): Promise<Response> {
  if (principal === null) {
    return json({ error: "authentication_required" }, 401);
  }
  if (identity === null) {
    return json({ error: "invalid_replay_identity" }, 400);
  }
  try {
    const result = await getMyReplayLogApiResponse(
      principal.userId,
      identity.source,
      identity.sourceGameId
    );
    if (result.status === "user_missing") {
      return json({ error: "invalid_or_expired_session" }, 401);
    }
    if (result.status === "not_found") {
      return json({ error: "replay_not_found" }, 404);
    }
    return json(result.response);
  } catch (error) {
    console.error("Failed to load My Replay log:", error);
    return json({ error: "replay_unavailable" }, 500);
  }
}

export async function loader({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const url = new URL(request.url);
  return replayLogResponse(
    await getAuthenticatedPrincipal(request, { transport: "web-cookie" }),
    replayIdentity(
      url.searchParams.get("source"),
      url.searchParams.get("sourceGameId")
    )
  );
}

export async function action({
  request,
}: {
  request: Request;
}): Promise<Response> {
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
  return replayLogResponse(
    await getAuthenticatedPrincipal(request, {
      transport: "game-token",
      token: form.get("token"),
    }),
    replayIdentity(form.get("source"), form.get("sourceGameId"))
  );
}
