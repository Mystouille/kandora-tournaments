import type { ReplaySource } from "~/game/replay/types";

export type MyReplayContextKind = "friendly" | "tournament" | "external";

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
  lastModified: number | null;
  commentCount: number;
  replayUrl: string;
  reviewUrl: string;
}

export interface MyReplayGroup {
  key: string;
  source: ReplaySource;
  sourceGameId: string;
  gameDate: number | null;
  context: MyReplayContext;
  ruleset: MyReplayRuleset;
  replayUrl: string;
  commentCount: number;
  reviews: MyReplayReview[];
}
