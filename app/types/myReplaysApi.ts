import type { MyReplayGroup } from "./myReplays";
import type { ReplayLog } from "~/game/replay/types";

export interface MyReplaysApiResponse {
  replays: MyReplayGroup[];
}

export interface MyReplaySeatEnrichment {
  teamName: string | null;
  teamLogoUrl: string | null;
}

export interface MyReplayReviewEdit {
  eventIndex: number;
  authorName: string;
  colorIndex: number;
  text: string;
  drawingBase64: string | null;
  updatedAt: string;
}

export interface MyReplayReviewDetails {
  shortId: string;
  seat: number | null;
  targetName: string | null;
  edits: MyReplayReviewEdit[];
}

export interface MyReplayLogApiResponse {
  log: ReplayLog;
  seatEnrichment: Array<MyReplaySeatEnrichment | null>;
  review: MyReplayReviewDetails | null;
}
