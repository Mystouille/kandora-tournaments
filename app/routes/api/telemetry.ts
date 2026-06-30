import { getAuthenticatedUser } from "../../utils/jwt.server";
import { connectToDatabase } from "../../utils/dbConnection.server";
import { UserModel } from "../../db/User";
import { TelemetryEventModel } from "../../db/TelemetryEvent";
import {
  trackEvent,
  queryErrors,
  querySlowest,
  queryByPath,
  queryErrorRate,
  queryUserActivity,
  queryClientEvents,
  querySession,
} from "../../services/telemetry.server";
import type { Route } from "./+types/telemetry";

async function requireAdminJson(request: Request) {
  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectToDatabase();
  const user = await UserModel.findById(jwtPayload.sub).select("isAdmin");
  if (!user?.isAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

// POST: ingest client-side events (batched from TelemetryProvider)
// GET:  admin query endpoint with ?query= param
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const events: Array<Record<string, unknown>> = body?.events;
  if (!Array.isArray(events) || events.length === 0) {
    return Response.json({ error: "No events" }, { status: 400 });
  }

  // Session ID sent alongside the batch
  const sessionId =
    typeof body?.sessionId === "string" ? body.sessionId : undefined;

  // Cap batch size to prevent abuse
  const batch = events.slice(0, 50);
  for (const evt of batch) {
    // Preserve the client-supplied event name. The client buffer uses
    // `event: "page_view" | "stats_…" | …` (see TelemetryContext.tsx);
    // merge it into `meta.event` so it isn't dropped on ingest.
    const incomingMeta =
      evt.meta && typeof evt.meta === "object"
        ? (evt.meta as Record<string, unknown>)
        : undefined;
    const eventName = typeof evt.event === "string" ? evt.event : undefined;
    const mergedMeta: Record<string, unknown> | undefined =
      eventName || incomingMeta
        ? {
            ...(incomingMeta ?? {}),
            ...(eventName ? { event: eventName } : {}),
          }
        : undefined;

    trackEvent({
      type: String(evt.type ?? "client"),
      method:
        typeof evt.method === "string" ? evt.method : (eventName ?? undefined),
      path: typeof evt.path === "string" ? evt.path : undefined,
      error: typeof evt.error === "string" ? evt.error : undefined,
      stack: typeof evt.stack === "string" ? evt.stack : undefined,
      sessionId,
      meta: mergedMeta,
    });
  }

  return Response.json({ ok: true });
}

export async function loader({ request }: Route.LoaderArgs) {
  const denied = await requireAdminJson(request);
  if (denied) {
    return denied;
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("query") ?? "errors";
  const sinceParam = url.searchParams.get("since");
  const limitParam = url.searchParams.get("limit");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const limit = limitParam ? Math.min(Number(limitParam), 500) : undefined;

  const opts = { since, limit };

  switch (query) {
    case "errors":
      return Response.json(await queryErrors(opts));
    case "slowest":
      return Response.json(
        await querySlowest({
          ...opts,
          minMs: Number(url.searchParams.get("minMs")) || undefined,
        })
      );
    case "by-path":
      return Response.json(await queryByPath(opts));
    case "error-rate":
      return Response.json(await queryErrorRate(opts));
    case "user": {
      const userId = url.searchParams.get("userId");
      if (!userId) {
        return Response.json(
          { error: "userId param required" },
          { status: 400 }
        );
      }
      return Response.json(await queryUserActivity(userId, opts));
    }
    case "client":
      return Response.json(await queryClientEvents(opts));
    case "session": {
      const sid = url.searchParams.get("sessionId");
      if (!sid) {
        return Response.json(
          { error: "sessionId param required" },
          { status: 400 }
        );
      }
      return Response.json(await querySession(sid, opts));
    }
    case "raw": {
      await connectToDatabase();
      const filter: Record<string, unknown> = {};
      const type = url.searchParams.get("type");
      const path = url.searchParams.get("path");
      if (type) {
        filter.type = type;
      }
      if (path) {
        filter.path = path;
      }
      if (since) {
        filter.createdAt = { $gte: since };
      }
      const data = await TelemetryEventModel.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit ?? 100)
        .lean();
      return Response.json(data);
    }
    default:
      return Response.json(
        {
          error: `Unknown query: ${query}. Available: errors, slowest, by-path, error-rate, user, client, raw`,
        },
        { status: 400 }
      );
  }
}
