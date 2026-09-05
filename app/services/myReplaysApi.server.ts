import { ReplayLogModel, type DbReplayLog } from "~/core/models/game/ReplayLog";
import type { GameEvent, Seat } from "~/game/protocol/messages";
import { annotateWallSchedule } from "~/game/replay/annotateWallSchedule";
import type { ReplaySource } from "~/game/replay/types";
import type {
  MyReplayLogApiResponse,
  MyReplaysApiResponse,
} from "~/types/myReplaysApi";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { getMyReplays } from "./myReplays.server";

export type MyReplayLogApiResult =
  | { status: "found"; response: MyReplayLogApiResponse }
  | { status: "not_found" }
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
  sourceGameId: string
): Promise<MyReplayLogApiResult> {
  await connectToDatabase();
  const relatedReplays = await getMyReplays(userId);
  if (relatedReplays === null) {
    return { status: "user_missing" };
  }
  const related = relatedReplays.some(
    (replay) => replay.source === source && replay.sourceGameId === sourceGameId
  );
  if (!related) {
    return { status: "not_found" };
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

  return {
    status: "found",
    response: {
      log: {
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
        events: annotateWallSchedule(doc.events as GameEvent[]),
        schemaVersion: doc.schemaVersion,
      },
    },
  };
}
