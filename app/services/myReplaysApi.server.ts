import { ReplayLogModel, type DbReplayLog } from "~/core/models/game/ReplayLog";
import { ReplayReviewModel } from "~/core/models/game/ReplayReview";
import type { GameEvent, Seat } from "~/game/protocol/messages";
import { annotateWallSchedule } from "~/game/replay/annotateWallSchedule";
import type { ReplaySource } from "~/game/replay/types";
import type {
  MyReplayLogApiResponse,
  MyReplaySeatEnrichment,
  MyReplaysApiResponse,
} from "~/types/myReplaysApi";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { normalizeLegacyReplayEvent } from "~/utils/replayLogCompatibility";
import { getMyReplays } from "./myReplays.server";
import { resolveSeatEnrichmentForReplay } from "./replayEnrichment.server";
import { resolveReviewersForDoc, serializeReview } from "./replayReview.server";

export type MyReplayLogApiResult =
  | { status: "found"; response: MyReplayLogApiResponse }
  | { status: "not_found" }
  | { status: "review_not_found" }
  | { status: "user_missing" };

export async function getMyReplaysApiResponse(
  userId: string
): Promise<MyReplaysApiResponse | null> {
  await connectToDatabase();
  const replays = await getMyReplays(userId);
  return replays === null ? null : { replays };
}

export async function getMyReplayLogApiResponse(
  userId: string,
  source: ReplaySource,
  sourceGameId: string,
  reviewShortId: string | null = null
): Promise<MyReplayLogApiResult> {
  await connectToDatabase();
  const relatedReplays = await getMyReplays(userId);
  if (relatedReplays === null) {
    return { status: "user_missing" };
  }
  const related = relatedReplays.find(
    (replay) => replay.source === source && replay.sourceGameId === sourceGameId
  );
  if (!related) {
    return { status: "not_found" };
  }
  if (
    reviewShortId !== null &&
    !related.reviews.some((review) => review.shortId === reviewShortId)
  ) {
    return { status: "review_not_found" };
  }

  const doc = await ReplayLogModel.findOne(
    {
      source,
      $or: [{ sourceGameId }, { sourceGameIdAliases: sourceGameId }],
    },
    {
      source: 1,
      sourceGameId: 1,
      ruleSet: 1,
      ruleSetDetails: 1,
      startedAt: 1,
      endedAt: 1,
      "seats.seat": 1,
      "seats.displayName": 1,
      "seats.finalScore": 1,
      "seats.place": 1,
      events: 1,
      schemaVersion: 1,
    }
  )
    .lean<DbReplayLog | null>()
    .exec();
  if (doc === null) {
    return { status: "not_found" };
  }

  const log: MyReplayLogApiResponse["log"] = {
    source: doc.source as ReplaySource,
    sourceGameId,
    ruleSet: doc.ruleSet,
    ...(doc.ruleSetDetails
      ? {
          ruleSetDetails: doc.ruleSetDetails as Record<string, unknown>,
        }
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
  const resolvedEnrichment = await resolveSeatEnrichmentForReplay(
    doc.sourceGameId,
    log.seats
  );
  const seatEnrichment = [0, 1, 2, 3].map((seat) => {
    const enrichment = resolvedEnrichment[seat];
    return enrichment === null || enrichment === undefined
      ? null
      : ({
          teamName: enrichment.teamName ?? null,
          teamLogoUrl: enrichment.teamLogoUrl ?? null,
        } satisfies MyReplaySeatEnrichment);
  });
  let review: MyReplayLogApiResponse["review"] = null;
  if (reviewShortId !== null) {
    const reviewDoc = await ReplayReviewModel.findOne({
      shortId: reviewShortId,
      source,
      sourceGameId: related.sourceGameId,
    })
      .lean()
      .exec();
    if (reviewDoc === null) {
      return { status: "review_not_found" };
    }
    const reviewers = await resolveReviewersForDoc(reviewDoc);
    const serialized = serializeReview(reviewDoc, reviewers);
    review = {
      shortId: serialized.shortId,
      seat: serialized.seat,
      targetName: serialized.target?.name ?? null,
      edits: serialized.edits.map((edit) => ({
        eventIndex: edit.eventIndex,
        authorName: edit.authorName,
        colorIndex: edit.colorIndex,
        text: edit.text,
        drawingBase64: edit.drawingBase64,
        updatedAt: edit.updatedAt,
      })),
    };
  }

  return {
    status: "found",
    response: {
      log,
      seatEnrichment,
      review,
    },
  };
}
