export type GameSummaryScreen = "stats" | "points" | "standings";

export type SummaryUnavailableReason =
  | "missingRecord"
  | "incompleteRecord"
  | "inconsistentScores"
  | "unknownChronology"
  | "missingQualification";

export type SummaryData<T> =
  | { status: "available"; data: T }
  | { status: "unavailable"; reason: SummaryUnavailableReason };

export interface SummaryIdentity {
  id: string;
  name: string;
  teamName: string | null;
  imageUrl: string | null;
  teamLogoUrl: string | null;
  color: string;
}

export interface SummaryPlayerStats {
  riichis: number;
  wins: number;
  dealIns: number;
}

export interface SummaryPlayer extends SummaryIdentity {
  seat: number | null;
  score: number;
  place: number;
  gamePoints: number;
}

export type SummaryHandLabel =
  | { kind: "start" }
  | { kind: "final" }
  | {
      kind: "hand";
      wind: "E" | "S" | "W" | "N" | null;
      number: number | null;
      honba: number;
    };

export interface SummaryPoints {
  labels: SummaryHandLabel[];
  series: { playerId: string; scores: number[] }[];
}

export interface SummaryStanding extends SummaryIdentity {
  rank: number;
  rankHighlight: "qualified" | "leader" | null;
  totalScore: number | null;
  pointsChange: number | null;
  pointsDifference: number | null;
  /** Played/scheduled appearances in this game's phase, unlike the league-wide points. */
  gamesPlayed: number;
  totalGames: number | null;
  eliminated: boolean;
  playedThisGame: boolean;
}

export interface LeagueGameSummary {
  id: string;
  platformGameId: string | null;
  league: {
    id: string;
    name: string;
    slug: string;
    isTeamMode: boolean;
  };
  startTime: string;
  endTime: string | null;
  phaseId: string | null;
  isCounted: boolean;
  players: SummaryPlayer[];
  handCount: number | null;
  drawCount: number | null;
  stats: SummaryData<Record<string, SummaryPlayerStats>>;
  points: SummaryData<SummaryPoints>;
  standings: SummaryData<SummaryStanding[]>;
}
