/**
 * Public endpoint: `GET /api/replay-tenhou-log?gameId=<id>`.
 *
 * Returns a minimal tenhou.net/5 viewer JSON
 * (`{ title, name, rule: { aka }, log }`) suitable for embedding
 * into a `https://tenhou.net/5/#json=…` URL or feeding to Naga.
 *
 * Sources:
 *   - `majsoul`     — converted directly from the protobuf `GameRecord`
 *                     via the vendored tensoul port (no DB roundtrip).
 *   - `riichicity`  — converted from the cross-platform `ReplayLog`
 *                     via `replayLogToTenhou5Json`. The `ReplayLog`
 *                     is fetched on-demand (and cached in Mongo) by
 *                     `fetchOrphanReplayLog`.
 *
 * Tenhou ids are rejected because the user already has native log
 * access on tenhou.net for those.
 */
import type { LoaderFunctionArgs } from "react-router";
import { inferReplaySource } from "~/game/replay/inferSource";
import { normalizeReplayId } from "~/game/replay/normalizeReplayId";
import { trackEvent } from "~/services/telemetry.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const startedAt = Date.now();
  const sessionId = request.headers.get("X-Telemetry-Session") ?? undefined;
  const url = new URL(request.url);
  const rawParam = (url.searchParams.get("gameId") ?? "").trim();
  if (!rawParam) {
    trackEvent({
      type: "replay_download",
      statusCode: 400,
      sessionId,
      meta: { format: "tenhou5", outcome: "missing-id" },
    });
    return new Response("Missing gameId query parameter", { status: 400 });
  }

  const gameId = normalizeReplayId(rawParam);
  const source = inferReplaySource(gameId);
  if (source !== "majsoul" && source !== "riichicity") {
    trackEvent({
      type: "replay_download",
      statusCode: 400,
      sessionId,
      meta: {
        format: "tenhou5",
        outcome: "unsupported-source",
        source: source ?? "unknown",
        gameId,
      },
    });
    return new Response(
      "Only Mahjong Soul and Riichi City replays can be converted to tenhou format.",
      { status: 400 }
    );
  }

  try {
    let payload: unknown;

    if (source === "majsoul") {
      const { MahjongSoulConnector } =
        await import("~/api/majsoul/data/MajsoulConnector");
      const { toTenhou5Json } =
        await import("~/api/majsoul/tensoul/toTenhouLog");

      const connector = MahjongSoulConnector.instance;
      await connector.ensureInitialized();
      let game;
      try {
        game = await connector.getContestGameRecord(gameId);
      } catch (firstError) {
        console.warn(
          `[api/replay-tenhou-log] majsoul fetch failed for ${gameId}, reinit + retry once:`,
          firstError instanceof Error ? firstError.message : firstError
        );
        await connector.init();
        game = await connector.getContestGameRecord(gameId);
      }
      if (!game) {
        trackEvent({
          type: "replay_download",
          statusCode: 404,
          sessionId,
          meta: {
            format: "tenhou5",
            outcome: "not-found",
            source,
            gameId,
          },
        });
        return new Response("Not found", { status: 404 });
      }
      payload = toTenhou5Json(game);
    } else {
      // riichicity — go through the unified ReplayLog pipeline.
      const [
        { ReplayLogModel },
        { connectToDatabase },
        { fetchOrphanReplayLog },
        { replayLogToTenhou5Json },
      ] = await Promise.all([
        import("~/db/models/ReplayLog"),
        import("~/utils/dbConnection.server"),
        import("~/services/fetchOrphanReplayLog.server"),
        import("~/game/replay/replayLogToTenhou5Json"),
      ]);
      await connectToDatabase();

      // Cache hit first; on miss go through the orphan-fetch pipeline
      // (network → parser → Mongo upsert).
      const cached = await ReplayLogModel.findOne({
        source,
        sourceGameId: gameId,
      })
        .lean()
        .exec();
      let replay: unknown = cached;
      if (!replay) {
        replay = await fetchOrphanReplayLog(source, gameId);
      }
      if (!replay) {
        trackEvent({
          type: "replay_download",
          statusCode: 404,
          sessionId,
          meta: {
            format: "tenhou5",
            outcome: "not-found",
            source,
            gameId,
            cacheHit: Boolean(cached),
          },
        });
        return new Response("Not found", { status: 404 });
      }
      payload = replayLogToTenhou5Json(
        replay as Parameters<typeof replayLogToTenhou5Json>[0]
      );
      trackEvent({
        type: "replay_download",
        statusCode: 200,
        durationMs: Date.now() - startedAt,
        sessionId,
        meta: {
          format: "tenhou5",
          outcome: "success",
          source,
          gameId,
          cacheHit: Boolean(cached),
        },
      });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${gameId}.tenhou5.json"`,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    trackEvent({
      type: "replay_download",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      sessionId,
      meta: {
        format: "tenhou5",
        outcome: "success",
        source,
        gameId,
      },
    });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${gameId}.tenhou5.json"`,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error(
      `[api/replay-tenhou-log] failed for ${source}/${gameId}`,
      error
    );
    const message = error instanceof Error ? error.message : String(error);
    trackEvent({
      type: "replay_download",
      statusCode: 502,
      durationMs: Date.now() - startedAt,
      sessionId,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
      meta: {
        format: "tenhou5",
        outcome: "error",
        source,
        gameId,
      },
    });
    return new Response(`Failed to convert log: ${message}`, { status: 502 });
  }
}
