import { ReplayLogModel, type DbReplayLog } from "~/core/models/game/ReplayLog";
import { ReplayReviewModel } from "~/core/models/game/ReplayReview";
import type { GameEvent, Seat } from "~/game/protocol/messages";
import { annotateWallSchedule } from "~/game/replay/annotateWallSchedule";
import { inferReplaySource } from "~/game/replay/inferSource";
import type { ReplayLog, ReplaySource } from "~/game/replay/types";
import type { SeatEnrichment } from "~/game/client/pixi/TableRenderer";
import type { SerializedReview } from "~/types/replayReview";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { normalizeLegacyReplayEvent } from "~/utils/replayLogCompatibility";
import { fetchOrphanReplayLog } from "./fetchOrphanReplayLog.server";
import { resolveSeatEnrichmentForReplay } from "./replayEnrichment.server";
import { resolveReviewersForDoc, serializeReview } from "./replayReview.server";

export type ReplayViewerDataResult =
  | { status: "authentication_required"; canonicalGameId: string }
  | { status: "not_found"; canonicalGameId: string }
  | {
      status: "found";
      canonicalGameId: string;
      resolvedSeat: Seat | null;
      log: ReplayLog;
      review: SerializedReview | null;
      seatEnrichment: Array<SeatEnrichment | null>;
    };

interface ParsedReplayRouteId {
  gameId: string;
  riichiCityWind: Seat | null;
}

export function parseReplayRouteId(rawGameId: string): ParsedReplayRouteId {
  const majsoulSuffix = /_a\d+$/.exec(rawGameId);
  const withoutMajsoulSuffix = majsoulSuffix
    ? rawGameId.slice(0, majsoulSuffix.index)
    : rawGameId;
  const riichiCitySuffix = /@([0-3])$/.exec(withoutMajsoulSuffix);
  return {
    gameId: riichiCitySuffix
      ? withoutMajsoulSuffix.slice(0, riichiCitySuffix.index)
      : withoutMajsoulSuffix,
    riichiCityWind: riichiCitySuffix
      ? (Number(riichiCitySuffix[1]) as Seat)
      : null,
  };
}

function replayLogFromDocument(doc: DbReplayLog): ReplayLog {
  return {
    source: doc.source as ReplaySource,
    sourceGameId: doc.sourceGameId,
    ruleSet: doc.ruleSet,
    ...(doc.mode ? { mode: doc.mode as ReplayLog["mode"] } : {}),
    ...(doc.ruleSetDetails
      ? { ruleSetDetails: doc.ruleSetDetails as Record<string, unknown> }
      : {}),
    startedAt: doc.startedAt,
    endedAt: doc.endedAt,
    seats: doc.seats.map((seat) => ({
      seat: seat.seat as Seat,
      displayName: seat.displayName,
      finalScore: seat.finalScore,
      place: seat.place as 1 | 2 | 3 | 4,
    })),
    events: annotateWallSchedule(
      doc.events.map(normalizeLegacyReplayEvent) as GameEvent[]
    ),
    schemaVersion: doc.schemaVersion,
  };
}

function riichiCitySeat(
  events: readonly GameEvent[],
  wind: Seat | null
): Seat | null {
  if (wind === null) {
    return null;
  }
  const handStart = events.find((event) => event.type === "hand_start");
  if (handStart?.type !== "hand_start") {
    return wind;
  }
  return ((handStart.dealer + wind) % 4) as Seat;
}

async function loadReview(
  reviewShortId: string | null,
  source: ReplaySource,
  sourceGameId: string
): Promise<SerializedReview | null> {
  if (reviewShortId === null || reviewShortId === "") {
    return null;
  }
  // Published reviews are deliberately link-public and read-only here. Bind
  // the short id to both replay identity fields so it cannot expose a review
  // from another game through a crafted query string.
  const reviewDoc = await ReplayReviewModel.findOne({
    shortId: reviewShortId,
    source,
    sourceGameId,
  })
    .lean()
    .exec();
  if (reviewDoc === null) {
    return null;
  }
  const reviewers = await resolveReviewersForDoc(reviewDoc);
  return serializeReview(reviewDoc, reviewers);
}

async function foundResult(
  log: ReplayLog,
  riichiCityWind: Seat | null,
  reviewShortId: string | null
): Promise<Extract<ReplayViewerDataResult, { status: "found" }>> {
  return {
    status: "found",
    canonicalGameId: log.sourceGameId,
    resolvedSeat: riichiCitySeat(log.events, riichiCityWind),
    log,
    review: await loadReview(reviewShortId, log.source, log.sourceGameId),
    seatEnrichment: await resolveSeatEnrichmentForReplay(
      log.sourceGameId,
      log.seats
    ),
  };
}

export async function resolveReplayViewerData(options: {
  gameId: string;
  reviewShortId?: string | null;
  userId?: string | null;
}): Promise<ReplayViewerDataResult> {
  const parsed = parseReplayRouteId(options.gameId.trim());
  const source = inferReplaySource(parsed.gameId);
  await connectToDatabase();

  const replayIdCandidates = /^[0-9a-f]{8}$/i.test(parsed.gameId)
    ? [
        ...new Set([
          parsed.gameId,
          parsed.gameId.toLowerCase(),
          parsed.gameId.toUpperCase(),
        ]),
      ]
    : [parsed.gameId];
  const query: Record<string, unknown> = {
    $or: [
      { sourceGameId: parsed.gameId },
      { sourceGameIdAliases: { $in: replayIdCandidates } },
    ],
  };
  if (source !== null) {
    query.source = source;
  }
  const doc = await ReplayLogModel.findOne(query)
    .lean<DbReplayLog | null>()
    .exec();
  if (doc !== null) {
    return foundResult(
      replayLogFromDocument(doc),
      parsed.riichiCityWind,
      options.reviewShortId ?? null
    );
  }

  if (source === null) {
    return { status: "not_found", canonicalGameId: parsed.gameId };
  }
  if (options.userId === null || options.userId === undefined) {
    return {
      status: "authentication_required",
      canonicalGameId: parsed.gameId,
    };
  }
  const fetched = await fetchOrphanReplayLog(
    source,
    parsed.gameId,
    options.userId
  ).catch((error) => {
    console.error(
      `[replay viewer] connector fetch failed for ${source}/${parsed.gameId}`,
      error
    );
    return null;
  });
  if (fetched === null) {
    return { status: "not_found", canonicalGameId: parsed.gameId };
  }
  const log: ReplayLog = {
    ...fetched,
    events: annotateWallSchedule(
      fetched.events.map(normalizeLegacyReplayEvent) as GameEvent[]
    ),
  };
  return foundResult(log, parsed.riichiCityWind, options.reviewShortId ?? null);
}
