export type GameSummaryPlayer = {
  platformUserId: string;
  nickname: string;
  score: number;
  place: number;
  seat: number;
};

export type GameSummary = {
  gameId: string;
  platform: "majsoul" | "riichiCity" | "tenhou" | "IRL";
  startTime: Date;
  endTime?: Date;
  /** URL to the game log replay, if available. */
  log?: string;
  players: GameSummaryPlayer[];
};
