import type { ReplaySource } from "~/game/replay/types";

export type MyReplayContextKind = "friendly" | "tournament" | "external";
export type MyReplayReason = "created" | "played" | "commented" | "reviewed";

export interface MyReplayContext {
  kind: MyReplayContextKind;
  tournamentName?: string;
  tournamentUrl?: string;
}

export interface MyReplayRuleset {
  id: string;
  label: string;
}

export interface MyReplaySeat {
  seat: 0 | 1 | 2 | 3;
  displayName: string;
  finalScore: number;
  place: 1 | 2 | 3 | 4;
}

export interface MyReplayReview {
  key: string;
  shortId: string;
  reviewedPlayerName: string | null;
  reasons: MyReplayReason[];
  lastModified: number | null;
  commentCount: number;
  reviewUrl: string;
}

export interface MyReplayGroup {
  key: string;
  source: ReplaySource;
  sourceGameId: string;
  reasons: MyReplayReason[];
  gameDate: number | null;
  seats: MyReplaySeat[];
  context: MyReplayContext;
  ruleset: MyReplayRuleset;
  replayUrl: string;
  commentCount: number;
  reviews: MyReplayReview[];
}
