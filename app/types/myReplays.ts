import type { ReplaySource } from "~/game/replay/types";

export type MyReplayContextKind = "friendly" | "tournament" | "external";
export type MyReplayReason = "created" | "played" | "commented";

export interface MyReplayContext {
  kind: MyReplayContextKind;
  tournamentName?: string;
  tournamentUrl?: string;
}

export interface MyReplayRuleset {
  id: string;
  label: string;
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
  context: MyReplayContext;
  ruleset: MyReplayRuleset;
  replayUrl: string;
  commentCount: number;
  reviews: MyReplayReview[];
}
